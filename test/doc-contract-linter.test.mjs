import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
import {
  verifyDocumentationContracts,
  renderReport,
  inspectUserDocumentationBoundary,
  verifyUserSiteOutput,
  emitGitHubAnnotations,
  writeGitHubStepSummary,
} from '../src/index.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'doc-contract-linter-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs'));
  mkdirSync(join(root, 'docs-dev'));
  writeFileSync(join(root, '.gitmodules'), '');
  writeFileSync(join(root, 'source.json'), '{"sdk":{"version":"1.2.3"}}');
  writeFileSync(join(root, 'docs', 'guide.md'), 'SDK version is 1.2.3.');
  writeFileSync(join(root, 'docs-dev', 'unmapped.md'), 'Not yet audited.');
  const requirement = {
    id: 'SDK', component: '.', title: 'SDK declaration', mode: 'static', documents: ['docs/guide.md'],
    checks: [
      { file: 'source.json', kind: 'json_equals', path: ['sdk', 'version'], value: '1.2.3' },
      { file: 'docs/guide.md', kind: 'contains', value: '1.2.3' },
      { file: 'docs/guide.md', kind: 'not_contains', value: '0.0.0' },
    ],
  };
  const registry = { schemaVersion: 1, scope: 'fixture', requirements: [requirement] };
  writeFileSync(join(root, 'contracts.json'), JSON.stringify(registry));
  return { root, requirement, registry };
}

test('reports static matches, hashes and partial document mapping without claiming proof', t => {
  const { root, registry } = fixture(t);
  const report = verifyDocumentationContracts(root, registry);
  assert.equal(report.metrics.matched_static, 1);
  assert.equal(report.metrics.documentFileMappingRate, 50);
  assert.equal(report.metrics.documentFilesWithStaticAssertions, 1);
  assert.equal(report.metrics.unmappedDocumentFiles, 1);
  assert.deepEqual(report.documentCoverage.find(d => d.path === 'docs-dev/unmapped.md').requirementIds, []);
  assert.equal(report.metrics.staticMatchRate, 100);
  assert.equal(report.exhaustiveConformanceProven, false);
  assert.equal(report.snapshotComplete, false);
  assert.equal(report.staticGatePassed, false);
  assert.match(report.evidenceSha256['source.json'], /^[a-f0-9]{64}$/);
});

test('source drift is a mismatch, not a skipped check', t => {
  const { root, registry } = fixture(t);
  writeFileSync(join(root, 'source.json'), '{"sdk":{"version":"2.0.0"}}');
  const report = verifyDocumentationContracts(root, registry);
  assert.equal(report.metrics.mismatch, 1);
  assert.equal(report.staticGatePassed, false);
});

test('document drift is detected independently of source', t => {
  const { root, registry } = fixture(t);
  writeFileSync(join(root, 'docs', 'guide.md'), 'SDK version is 0.0.0.');
  assert.equal(verifyDocumentationContracts(root, registry).metrics.mismatch, 1);
});

test('missing or invalid evidence stays unverified and never leaks contents', t => {
  const { root, registry, requirement } = fixture(t);
  requirement.checks[0].file = 'missing.json';
  let report = verifyDocumentationContracts(root, registry);
  assert.equal(report.metrics.unverified, 1);
  assert.equal(report.metrics.staticMatchRate, 0);
  requirement.checks[0].file = 'source.json';
  writeFileSync(join(root, 'source.json'), 'private test material');
  report = verifyDocumentationContracts(root, registry);
  assert.equal(report.metrics.unverified, 1);
  assert.ok(!JSON.stringify(report).includes('private test material'));
});

test('manual and excluded items are never counted as successful verification', t => {
  const { root, registry, requirement } = fixture(t);
  requirement.mode = 'manual';
  requirement.reason = 'Needs real device';
  registry.requirements.push({ ...requirement, id: 'EXCLUDED', mode: 'out_of_scope', reason: 'Separate review' });
  const report = verifyDocumentationContracts(root, registry);
  assert.equal(report.metrics.pending_manual, 1);
  assert.equal(report.metrics.out_of_scope, 1);
  assert.equal(report.metrics.matched_static, 0);
  assert.equal(report.metrics.documentFilesWithStaticAssertions, 0);
  assert.equal(report.metrics.mappedDocumentFiles, 1);
  assert.equal(report.metrics.staticMatchRate, null);
  assert.equal(report.staticGatePassed, false);
});

test('missing documentation root cannot inflate coverage', t => {
  const { root, registry } = fixture(t);
  rmSync(join(root, 'docs-dev'), { recursive: true });
  const report = verifyDocumentationContracts(root, registry);
  assert.deepEqual(report.inventoryErrors, ['docs-dev']);
  assert.equal(report.metrics.documentFileMappingRate, null);
  assert.equal(report.staticGatePassed, false);
});

test('reference-only files do not count as having static assertions', t => {
  const { root, registry, requirement } = fixture(t);
  requirement.documents.push('docs-dev/unmapped.md');
  const report = verifyDocumentationContracts(root, registry);
  assert.equal(report.metrics.mappedDocumentFiles, 2);
  assert.equal(report.metrics.documentFilesWithStaticAssertions, 1);
  assert.deepEqual(report.documentCoverage.find(d => d.path === 'docs-dev/unmapped.md').staticAssertionIds, []);
});

test('rejects invalid registries and duplicate requirements', t => {
  const { root, registry, requirement } = fixture(t);
  assert.throws(() => verifyDocumentationContracts(root, { schemaVersion: 9, requirements: [] }));
  registry.requirements.push(requirement);
  assert.throws(() => verifyDocumentationContracts(root, registry));
});

test('rejects unknown component and assertions without a concrete value', t => {
  const { root, registry, requirement } = fixture(t);
  requirement.component = 'not-a-repository';
  assert.throws(() => verifyDocumentationContracts(root, registry));
  requirement.component = '.';
  requirement.checks[1].value = '';
  assert.equal(verifyDocumentationContracts(root, registry).metrics.unverified, 1);
});

test('evidence cannot escape checkout', t => {
  const { root, registry, requirement } = fixture(t);
  requirement.checks[0].file = '../outside.json';
  const report = verifyDocumentationContracts(root, registry);
  assert.equal(report.metrics.unverified, 1);
});

test('readable reports escape table separators and flag unaudited claims', t => {
  const { root, registry, requirement } = fixture(t);
  requirement.title = 'one|two\n<three>';
  const markdown = renderReport(verifyDocumentationContracts(root, registry));
  assert.ok(!markdown.includes('<three>'));
  assert.ok(!markdown.includes('one|two'));
  assert.ok(markdown.includes('Unregistered claims remain unaudited.'));
});

test('Provider and internal deployment details are flagged in any user Markdown', () => {
  const issues = inspectUserDocumentationBoundary([
    { path: 'docs/new-page.md', text: '説明\nProvider app/api /v1/auth DOCS_ACCESS_SECRET HttpOnly npm run build' },
    { path: 'docs-dev/internal.md', text: 'Provider app/api DOCS_ACCESS_SECRET npm run build' },
  ]);
  assert.equal(issues.length, 6);
  assert.ok(issues.every(issue => issue.file === 'docs/new-page.md' && issue.line === 2));
  assert.ok(!JSON.stringify(issues).includes('説明'));
});

test('user operations remain allowed and a new unregistered page cannot bypass boundary checks', t => {
  assert.deepEqual(inspectUserDocumentationBoundary([{ path: 'docs/guide.md', text: 'Managementで端末トークンを発行し、施設IDを入力します。証明書は担当者と確認します。' }]), []);
  const { root, registry } = fixture(t);
  writeFileSync(join(root, 'docs', 'new-page.md'), 'Provider');
  const report = verifyDocumentationContracts(root, registry);
  assert.equal(report.metrics.matched_static, 1);
  assert.equal(report.metrics.userDocumentationBoundaryIssues, 1);
  assert.equal(report.staticGatePassed, false);
});

test('generated site check rejects README output and incomplete builds', t => {
  const { root } = fixture(t);
  mkdirSync(join(root, 'build', 'site'), { recursive: true });
  assert.equal(verifyUserSiteOutput(root, 'build/site').passed, false);
  writeFileSync(join(root, 'build', 'site', 'index.html'), '<html lang="ja"></html>');
  assert.equal(verifyUserSiteOutput(root, 'build/site').passed, true);
  writeFileSync(join(root, 'build', 'site', 'README.html'), 'internal content');
  assert.deepEqual(verifyUserSiteOutput(root, 'build/site').forbiddenFiles, ['README.html']);
  assert.equal(verifyUserSiteOutput(root, '../outside').passed, false);
});

test('supports requireGit false to pass static gate outside a git checkout', t => {
  const { root, registry } = fixture(t);
  const report = verifyDocumentationContracts(root, registry, { requireGit: false });
  assert.equal(report.metrics.matched_static, 1);
  assert.equal(report.snapshotComplete, false);
  assert.equal(report.staticGatePassed, true);
});

test('cli flags --help and --version work correctly', () => {
  const cliPath = join(__dirname, '../src/index.mjs');
  const helpOut = execFileSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' });
  assert.ok(helpOut.includes('doc-contract-linter'));
  assert.ok(helpOut.includes('--registry'));

  const verOut = execFileSync(process.execPath, [cliPath, '--version'], { encoding: 'utf8' });
  assert.match(verOut.trim(), /^\d+\.\d+\.\d+$/);
});

test('emitGitHubAnnotations formats boundary violations and gate errors', () => {
  const originalLog = console.log;
  const logs = [];
  console.log = (msg) => logs.push(msg);
  try {
    emitGitHubAnnotations({
      staticGatePassed: false,
      boundaryIssues: [{ file: 'docs/guide.md', line: 12, rule: 'SOURCE_PATH' }],
    });
    assert.ok(logs.some(l => l.includes('::error file=docs/guide.md,line=12::Documentation boundary violation: rule SOURCE_PATH')));
    assert.ok(logs.some(l => l.includes('::error::Documentation contract check failed')));
  } finally {
    console.log = originalLog;
  }
});

test('writeGitHubStepSummary writes markdown report to summary file', t => {
  const { root, registry } = fixture(t);
  const report = verifyDocumentationContracts(root, registry, { requireGit: false });
  const summaryFile = join(root, 'summary.md');
  const written = writeGitHubStepSummary(report, summaryFile);
  assert.equal(written, true);
  const content = readFileSync(summaryFile, 'utf8');
  assert.ok(content.includes('# Documentation contract report'));
});

test('CLI supports --config, --github-actions, and --quiet', t => {
  const { root } = fixture(t);
  const configPath = join(root, '.doccontractrc.json');
  writeFileSync(configPath, JSON.stringify({
    registry: 'contracts.json',
    requireGit: false,
  }));
  const cliPath = join(__dirname, '../src/index.mjs');
  const summaryFile = join(root, 'step_summary.md');
  writeFileSync(summaryFile, '');

  const out = execFileSync(process.execPath, [cliPath, '--quiet', '--github-actions'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: summaryFile },
  });
  assert.equal(out.trim(), ''); // quiet on pass
  const summaryContent = readFileSync(summaryFile, 'utf8');
  assert.ok(summaryContent.includes('# Documentation contract report'));
});
