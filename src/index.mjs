#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync, mkdirSync, writeFileSync, lstatSync, unlinkSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

function scopedFile(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path)) throw new Error('Invalid relative path');
  const file = realpathSync(resolve(root, path));
  const rel = relative(realpathSync(root), file);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path outside checkout');
  return file;
}

function markdownFiles(root, folder) {
  const result = [];
  const walk = (path) => {
    for (const entry of readdirSync(scopedFile(root, path), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'build', 'dist'].includes(entry.name)) continue;
      const next = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile() && entry.name.endsWith('.md')) result.push(next);
    }
  };
  walk(folder);
  return result;
}

const percent = (count, total) => total ? Math.round(count / total * 10000) / 100 : null;

export const DEFAULT_BOUNDARY_RULES = [
  ['OWNER_ONLY_PROVIDER', /\bprovider\b/gi],
  ['SOURCE_PATH', /\bapp\/(?:api|Provider|Shared|Management|Kiosk|Facility|Guardian|Staff)\b/g],
  ['INTERNAL_API_PATH', /\/v1\//g],
  ['INTERNAL_SECRET_NAME', /\b(?:DOCS_ACCESS_SECRET|DOCS_API_ORIGIN|DOCS_DEPLOYMENT_ENV|AUTH_PEPPER|KV_AUTH|ENCRYPTION_KEY)\b/g],
  ['INTERNAL_TECHNOLOGY', /\b(?:D1|Hono|Drizzle|Wrangler|Cloudflare|HttpOnly|WinUI|Avalonia|ClosedXML)\b/gi],
  ['DEVELOPER_COMMAND', /\b(?:npm (?:run|ci|install)|dotnet (?:build|publish|test))\b/g],
];

// Narrow, reviewable heuristics supplement reader-focused manual review.
export function inspectUserDocumentationBoundary(documents, customRules = DEFAULT_BOUNDARY_RULES, userDocPrefix = 'docs/') {
  const rules = customRules.map(([name, expr]) => [
    name,
    expr instanceof RegExp ? new RegExp(expr.source, expr.flags) : new RegExp(expr.pattern, expr.flags || 'g'),
  ]);
  const issues = [];
  for (const { path, text } of documents) {
    if (!path.startsWith(userDocPrefix)) continue;
    for (const [rule, expression] of rules) {
      expression.lastIndex = 0;
      for (const match of text.matchAll(expression)) {
        issues.push({ file: path, rule, line: text.slice(0, match.index).split('\n').length });
      }
    }
  }
  return issues;
}

export function verifyUserSiteOutput(root, directory) {
  try {
    const output = scopedFile(root, directory);
    const files = readdirSync(output);
    if (!files.includes('index.html')) throw new Error('Missing index');
    const forbidden = files.filter(file => /^readme\.(?:html|md)$/i.test(file));
    return { directory, passed: forbidden.length === 0, forbiddenFiles: forbidden,
      indexSha256: createHash('sha256').update(readFileSync(scopedFile(root, `${directory}/index.html`))).digest('hex') };
  } catch {
    return { directory, passed: false, reason: 'Site output is missing, unreadable or outside checkout.' };
  }
}

export function verifyDocumentationContracts(root, registry, options = {}) {
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.requirements) || !registry.requirements.length)
    throw new Error('Unsupported or empty registry');
  const docFolders = options.docFolders || registry.docFolders || ['docs', 'docs-dev'];
  const userDocPrefix = options.userDocPrefix || registry.userDocPrefix || 'docs/';
  const boundaryRules = options.boundaryRules || registry.boundaryRules || DEFAULT_BOUNDARY_RULES;
  const requireGit = options.requireGit ?? registry.requireGit ?? true;

  const ids = new Set();
  const files = new Map();
  const read = (path) => {
    const bytes = readFileSync(scopedFile(root, path));
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (files.has(path) && files.get(path) !== hash) throw new Error('Evidence changed during inspection');
    files.set(path, hash);
    return bytes.toString('utf8');
  };
  const gitmodules = existsSync(resolve(root, '.gitmodules')) ? read('.gitmodules') : '';
  const repositories = ['.', ...Array.from(gitmodules.matchAll(/^\s*path\s*=\s*(.+)$/gm), m => m[1].trim())];
  const results = registry.requirements.map(requirement => {
    if (typeof requirement.id !== 'string' || !requirement.id || ids.has(requirement.id)) throw new Error('Missing or duplicate requirement ID');
    if (typeof requirement.title !== 'string' || !requirement.title) throw new Error('Missing requirement title');
    ids.add(requirement.id);
    if (!repositories.includes(requirement.component)) throw new Error('Unknown component');
    if (!['static', 'manual', 'out_of_scope'].includes(requirement.mode)) throw new Error('Unknown mode');
    if (!Array.isArray(requirement.documents) || !requirement.documents.length) throw new Error('Missing documents');
    if (requirement.mode === 'static' && (!Array.isArray(requirement.checks) || !requirement.checks.length))
      throw new Error('Static requirement without checks');
    if (requirement.mode !== 'static' && !requirement.reason) throw new Error('Missing boundary explanation');
    const result = { id: requirement.id, component: requirement.component, title: requirement.title,
      documents: requirement.documents, status: 'unverified', failures: [] };
    try {
      for (const path of requirement.documents) read(path);
      if (requirement.mode !== 'static') {
        result.status = requirement.mode === 'manual' ? 'pending_manual' : 'out_of_scope';
        result.reason = requirement.reason;
        return result;
      }
      for (const check of requirement.checks) {
        const content = read(check.file);
        let passed;
        if (check.kind === 'contains' || check.kind === 'not_contains') {
          if (typeof check.value !== 'string' || !check.value) throw new Error('Empty assertion');
          passed = content.includes(check.value);
          if (check.kind === 'not_contains') passed = !passed;
        } else if (check.kind === 'json_equals') {
          if (!Array.isArray(check.path) || !check.path.length) throw new Error('Missing JSON path');
          let value = JSON.parse(content);
          for (const key of check.path) value = value != null && Object.hasOwn(value, key) ? value[key] : undefined;
          passed = JSON.stringify(value) === JSON.stringify(check.value);
        } else throw new Error('Unsupported check');
        if (!passed) result.failures.push({ file: check.file, kind: check.kind });
      }
      result.status = result.failures.length ? 'mismatch' : 'matched_static';
    } catch {
      // Never include file contents or parser diagnostics in reports.
      result.status = 'unverified';
      result.failures.push({ reason: 'Unreadable evidence or invalid check; inspect registered paths and checker configuration.' });
    }
    return result;
  });
  const counts = Object.fromEntries(['matched_static', 'mismatch', 'unverified', 'pending_manual', 'out_of_scope']
    .map(status => [status, results.filter(r => r.status === status).length]));
  const documentInventory = [];
  const inventoryErrors = [];
  for (const folder of docFolders) {
    try { documentInventory.push(...markdownFiles(root, folder)); }
    catch { inventoryErrors.push(folder); }
  }
  const mappedDocuments = new Set(results.flatMap(r => r.documents).filter(p => documentInventory.includes(p)));
  const documentCoverage = documentInventory.sort().map(path => {
    const requirements = registry.requirements.filter(r => r.documents.includes(path));
    const staticChecks = requirements.filter(r => r.mode === 'static' && r.checks.some(check => check.file === path));
    return { path, requirementIds: requirements.map(r => r.id),
      modes: [...new Set(requirements.map(r => r.mode))].sort(),
      staticAssertionIds: staticChecks.map(r => r.id) };
  });
  const boundaryIssues = [];
  for (const path of documentInventory.filter(p => p.startsWith(userDocPrefix))) {
    try { boundaryIssues.push(...inspectUserDocumentationBoundary([{ path, text: read(path) }], boundaryRules, userDocPrefix)); }
    catch { boundaryIssues.push({ file: path, rule: 'UNREADABLE_DOCUMENT', line: null }); }
  }
  const components = repositories.map(path => {
    let head = null;
    let dirty = null;
    try {
      const gitOpts = { cwd: scopedFile(root, path), encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] };
      head = execFileSync('git', ['-c', 'core.fsmonitor=false', 'rev-parse', 'HEAD'], gitOpts).trim();
      dirty = Boolean(execFileSync('git', ['-c', 'core.fsmonitor=false', 'status', '--porcelain', '--untracked-files=normal', '--ignore-submodules'], gitOpts).trim());
    } catch { /* An unavailable Git snapshot is not a clean checkout. */ }
    return { path, head, dirty, registeredRequirements: results.filter(r => r.component === path).length };
  });
  const automatic = registry.requirements.filter(r => r.mode === 'static').length;
  const snapshotComplete = components.every(c => c.head !== null && c.dirty !== null);
  const evidenceStable = [...files].every(([path, hash]) => {
    try { return createHash('sha256').update(readFileSync(scopedFile(root, path))).digest('hex') === hash; }
    catch { return false; }
  });
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(), scope: registry.scope,
    assurance: 'Static assertions only; not behavioral, exhaustive, deployed or device acceptance.',
    registrySha256: createHash('sha256').update(JSON.stringify(registry)).digest('hex'),
    metrics: { registeredRequirements: results.length, ...counts,
      automaticVerificationRate: percent(automatic, results.length - counts.out_of_scope),
      staticMatchRate: percent(counts.matched_static, automatic),
      documentFiles: inventoryErrors.length ? null : documentInventory.length,
      mappedDocumentFiles: mappedDocuments.size,
      documentFileMappingRate: inventoryErrors.length ? null : percent(mappedDocuments.size, documentInventory.length),
      documentFilesWithStaticAssertions: documentCoverage.filter(d => d.staticAssertionIds.length > 0).length,
      unmappedDocumentFiles: inventoryErrors.length ? null : documentInventory.length - mappedDocuments.size,
      userDocumentationBoundaryIssues: boundaryIssues.length,
      repositoryMappingRate: percent(components.filter(c => c.registeredRequirements > 0).length, components.length) },
    inventoryErrors, snapshotComplete, evidenceStable, components, documentCoverage, boundaryIssues,
    evidenceSha256: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b))),
    results,
    staticGatePassed: automatic > 0 && counts.mismatch === 0 && counts.unverified === 0 && boundaryIssues.length === 0 && inventoryErrors.length === 0 && (!requireGit || snapshotComplete) && evidenceStable && components.every(c => c.registeredRequirements > 0),
    exhaustiveConformanceProven: false,
  };
}

export function renderReport(report) {
  const escape = text => String(text).replace(/[|\r\n<>]/g, ' ');
  return `# Documentation contract report\n\nGenerated: ${report.generatedAt}\n\n` +
    `Scope: ${escape(report.scope)}\n\n${report.assurance}\n\n` +
    `Static gate: ${report.staticGatePassed ? 'PASS' : 'FAIL'}. Exhaustive conformance proven: false.\n\n` +
    Object.entries(report.metrics).map(([key, value]) => `- ${key}: ${value ?? 'unknown'}`).join('\n') +
    '\n\nFile mapping is not semantic requirement coverage. Unregistered claims remain unaudited.\n\n' +
    '| ID | Component | Status | Requirement |\n| --- | --- | --- | --- |\n' +
    report.results.map(r => `| ${escape(r.id)} | ${escape(r.component)} | ${r.status} | ${escape(r.title)} |`).join('\n') + '\n\n' +
    '## User-document boundary issues\n\n' +
    (report.boundaryIssues.length ? report.boundaryIssues.map(issue => `- ${escape(issue.file)}:${issue.line ?? '?'}: ${issue.rule}`).join('\n') : 'None detected by registered heuristics; manual review remains required.') + '\n\n' +
    `Generated user site check: ${report.siteOutput ? (report.siteOutput.passed ? 'PASS' : 'FAIL') : 'NOT RUN'}\n`;
}

function prepareOutput(root, argument) {
  const output = resolve(root, argument);
  const rel = relative(resolve(root), output);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Output must be inside project root');
  let ancestor = output;
  while (true) {
    try { scopedFile(root, relative(root, ancestor)); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; ancestor = dirname(ancestor); }
  }
  mkdirSync(output, { recursive: true });
  for (const name of ['report.json', 'report.md']) {
    const file = resolve(output, name);
    try {
      if (lstatSync(file).isSymbolicLink()) throw new Error('Output file must not be a symlink');
      scopedFile(root, relative(root, file));
      unlinkSync(file);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return output;
}

function printHelp() {
  console.log(`doc-contract-linter - Docs-as-Code contract verifier and audience-boundary linter

Usage:
  doc-contract-linter [options]

Options:
  --registry <path>     Path to contract registry JSON (default: contracts.json)
  --output <dir>        Directory to output report.json and report.md
  --site-output <dir>   Verify generated user-facing documentation website output
  --no-git              Skip Git commit and working-tree clean status check
  --json                Output report in raw JSON instead of Markdown
  -v, --version         Show version number
  -h, --help            Show this help message
`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const root = process.cwd();
    const args = process.argv.slice(2);

    if (args.includes('-h') || args.includes('--help')) {
      printHelp();
      process.exit(0);
    }

    if (args.includes('-v') || args.includes('--version')) {
      try {
        const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        console.log(pkg.version);
      } catch {
        console.log('1.0.0');
      }
      process.exit(0);
    }

    const options = new Map();
    let requireGit = true;
    let jsonOutput = false;

    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === '--no-git') {
        requireGit = false;
        continue;
      }
      if (arg === '--json') {
        jsonOutput = true;
        continue;
      }
      if (['--output', '--site-output', '--registry'].includes(arg)) {
        const next = args[index + 1];
        if (!next || next.startsWith('--')) throw new Error(`Missing value for argument: ${arg}`);
        options.set(arg, next);
        index += 1;
        continue;
      }
      throw new Error(`Unknown argument: ${arg}`);
    }

    const registryPath = options.get('--registry') || 'contracts.json';
    const output = options.has('--output') ? prepareOutput(root, options.get('--output')) : null;
    const registry = JSON.parse(readFileSync(scopedFile(root, registryPath), 'utf8'));
    const report = verifyDocumentationContracts(root, registry, { requireGit });

    if (options.has('--site-output')) {
      report.siteOutput = verifyUserSiteOutput(root, options.get('--site-output'));
      report.staticGatePassed &&= report.siteOutput.passed;
    }

    if (output) {
      for (const [name, value] of [
        ['report.json', JSON.stringify(report, null, 2) + '\n'],
        ['report.md', renderReport(report)],
      ]) {
        const path = resolve(output, name);
        try { if (lstatSync(path).isSymbolicLink()) throw new Error('Output file must not be a symlink'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        try { scopedFile(root, relative(root, path)); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        writeFileSync(path, value, { encoding: 'utf8' });
      }
    }

    if (jsonOutput) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(renderReport(report));
    }

    process.exitCode = report.staticGatePassed ? 0 : 1;
  } catch (err) {
    console.error('Documentation verification failed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
