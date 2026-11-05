# doc-contract-linter

[![npm version](https://img.shields.io/npm/v/doc-contract-linter.svg)](https://www.npmjs.com/package/doc-contract-linter)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)]()

Zero-dependency **Docs-as-Code contract verifier and audience-boundary linter** designed for AI-assisted engineering teams.

Ensures that documentation claims stay strictly synchronized with implementation code, prevents documentation drift, and blocks internal secrets or architecture terminology from leaking into public user documentation.

---

## 🎯 Why `doc-contract-linter`?

With the widespread adoption of AI coding assistants (Claude Code, Cursor, GitHub Copilot, Antigravity):
1. **Documentation Drift & AI Hallucinations**:
   AI frequently writes or edits documentation with outdated assumptions, incorrect version numbers, or non-existent endpoints. Traditional linters (`markdownlint`, `vale`) only check grammar and syntax—they cannot verify whether documented values match the actual source code.
2. **Audience Boundary Leaks**:
   Internal API endpoints, internal environment variables, database names, or developer-only scripts often accidentally slip into end-user facing guides (`docs/`), creating security and confidentiality risks.

`doc-contract-linter` provides an automated, tamper-evident harness:
- **Traceable Requirement Assertions**: Checks whether documented claims match source code via `contains`, `not_contains`, and `json_equals` assertions.
- **Evidence Stability Guarantee**: Computes SHA-256 hashes of all referenced files during verification to ensure nothing was modified mid-run.
- **Audience-Boundary Protection**: Flags internal secret names, internal APIs, developer commands, or private tech stack terms in user-facing documents.
- **Fail-Closed & Leak-Free Reports**: Error reports never leak file contents or sensitive tokens into logs or CI outputs.

---

## 📦 Installation

```bash
npm install --save-dev doc-contract-linter
```

Or run directly with `npx`:

```bash
npx doc-contract-linter --registry contracts.json
```

---

## 🚀 Quick Start

### 1. Define `contracts.json`

Create a `contracts.json` in your repository root:

```json
{
  "$schema": "https://raw.githubusercontent.com/takaodev/doc-contract-linter/main/contracts.schema.json",
  "schemaVersion": 1,
  "scope": "MyProject Specification Conformance",
  "docFolders": ["docs", "docs-dev"],
  "userDocPrefix": "docs/",
  "requirements": [
    {
      "id": "API-VERSION",
      "component": ".",
      "title": "Documented API version must match package.json",
      "mode": "static",
      "documents": ["docs/getting-started.md"],
      "checks": [
        {
          "file": "package.json",
          "kind": "json_equals",
          "path": ["version"],
          "value": "1.0.0"
        },
        {
          "file": "docs/getting-started.md",
          "kind": "contains",
          "value": "v1.0.0"
        }
      ]
    },
    {
      "id": "INTERNAL-AUTH",
      "component": ".",
      "title": "Multi-tenant auth isolation",
      "mode": "manual",
      "documents": ["docs-dev/security.md"],
      "reason": "Requires penetration testing against live staging environment"
    }
  ]
}
```

### 2. Run the Linter

```bash
npx doc-contract-linter --registry contracts.json --output build/reports
```

Output:
```markdown
# Documentation contract report

Generated: 2026-11-05T14:00:00.000Z
Scope: MyProject Specification Conformance
Static gate: PASS. Exhaustive conformance proven: false.

- registeredRequirements: 2
- matched_static: 1
- mismatch: 0
- unverified: 0
- pending_manual: 1
- out_of_scope: 0
- staticMatchRate: 100%
- mappedDocumentFiles: 2
- userDocumentationBoundaryIssues: 0

| ID | Component | Status | Requirement |
| --- | --- | --- | --- |
| API-VERSION | . | matched_static | Documented API version must match package.json |
| INTERNAL-AUTH | . | pending_manual | Multi-tenant auth isolation |

## User-document boundary issues
None detected by registered heuristics; manual review remains required.
```

---

## 🛠️ CLI Options

| Flag | Description | Default |
| --- | --- | --- |
| `--registry <path>` | Path to contracts registry JSON file | `contracts.json` |
| `--output <dir>` | Directory to write `report.json` and `report.md` | `null` (stdout only) |
| `--site-output <dir>` | Verify built user-facing site (checks `index.html`, forbids `README.*`) | `null` |
| `--no-git` | Skip Git commit hash & clean working-tree requirement | `false` |
| `--json` | Output machine-readable JSON to stdout | `false` (Markdown) |
| `-v, --version` | Display version number | |
| `-h, --help` | Display help screen | |

---

## 💻 Programmatic Usage (Node.js & TypeScript)

```typescript
import {
  verifyDocumentationContracts,
  renderReport,
  inspectUserDocumentationBoundary,
} from 'doc-contract-linter';

const registry = JSON.parse(fs.readFileSync('contracts.json', 'utf8'));

// Run verification
const report = verifyDocumentationContracts(process.cwd(), registry, {
  requireGit: false,
});

if (!report.staticGatePassed) {
  console.error('Documentation contracts failed!');
  console.log(renderReport(report));
  process.exit(1);
}
```

---

## 🛡️ Audience Boundary Linting

By default, any files under `docs/` (or configured `userDocPrefix`) are scanned to ensure internal implementation details do not leak to public consumers:

- **Secret names**: Environment variables ending in `_SECRET`, `_KEY`, `_PEPPER`, `_PASSWORD`
- **Internal endpoints**: Private route patterns (`/v1/internal/*`, `/admin/*`)
- **Internal source references**: Private codebase paths
- **Developer CLI commands**: Internal build / test invocation commands

You can supply custom boundary rules via `boundaryRules` in `contracts.json` or programmatically:

```typescript
const customRules: BoundaryRule[] = [
  ['NO_INTERNAL_CODE_NAMES', /\bProjectCodename[A-Z]\b/g],
];

const issues = inspectUserDocumentationBoundary(documents, customRules);
```

---

## 🤖 GitHub Actions Integration

Add `doc-contract-linter` directly to your GitHub PR workflow. It automatically publishes rich Step Summaries and annotates PR diffs with file/line inline warnings:

```yaml
- name: Verify Documentation Contracts
  run: npx doc-contract-linter --github-actions --quiet
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Config File Support (`.doccontractrc.json`)

You can also place a `.doccontractrc.json` in your repository root:

```json
{
  "registry": "contracts.json",
  "output": "artifacts/docs-lint",
  "siteOutput": "dist/docs",
  "requireGit": true,
  "docFolders": ["docs", "docs-dev"]
}
```

---

## 📄 License

MIT License © 2026 takaodev
