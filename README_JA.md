# doc-contract-linter

[![npm version](https://img.shields.io/npm/v/doc-contract-linter.svg)](https://www.npmjs.com/package/doc-contract-linter)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)]()

> **AI駆動開発時代のための、ゼロ依存 Docs-as-Code 仕様契約検証 ＆ 読者境界リンター。**

ドキュメントの記述と実装コード（設定値、バージョン、型定義、エンドポイント）が厳密に同期していることを自動検証し、ドキュメントの陳腐化（Drift）を防止します。また、エンドユーザー向け公開ドキュメントに内部シークレット名や非公開アーキテクチャ用語が漏洩するのを防ぎます。

[English README is available here](./README.md)

---

## 🎯 なぜ `doc-contract-linter` なのか？

AI コーディングアシスタント（Claude Code、Cursor、GitHub Copilot、Antigravity など）の普及に伴い、以下のような深刻な課題が発生しています：

1. **ドキュメントの乖離（Drift）と AI ハルシネーション**:
   AI が古い前提や架空のバージョン番号、存在しない API パラメータをドキュメントに書き込んでしまう。従来のリンター（`markdownlint` や `vale`）は文法やスタイルしかチェックできず、**「書かれている仕様値が実際のコードと一致しているか」を検証できません**。
2. **読者境界（Audience Boundary）からの情報漏洩**:
   開発者向けの内部 API パス、非公開の環境変数名、内部データベース名、開発者用 CLI コマンドが、一般ユーザー向けマニュアル（`docs/`）に誤って混入してしまう。

`doc-contract-linter` はこれらを CI 上で自動検出する堅牢なハーネスを提供します：

- **追跡可能な要件アサーション**: `contains`, `not_contains`, `json_equals` などのルールで、ドキュメントの記述がコードと一致しているかを宣言的に検証。
- **改ざん防止・証跡の完全性**: 検証中に参照したすべてのファイルの SHA-256 ハッシュを記録し、実行中にファイルがすり替えられていないことを保証。
- **読者境界の自動監査**: 一般公開用ドキュメント内の内部用語（秘密鍵の環境変数名、内部URL、開発用コマンドなど）を検知。
- **情報漏洩のない安全なレポート (Fail-Closed)**: 検証エラー発生時も、ログや CI 出力に機密ファイルの内容そのものを漏洩させません。
- **GitHub Actions との強力な連携**: PR の Files Changed 上にインライン警告注記（Annotations）を直接表示し、`$GITHUB_STEP_SUMMARY` に見やすい表形式レポートを自動出力。

---

## 📦 インストール

```bash
npm install --save-dev doc-contract-linter
```

`npx` で直接実行することも可能です：

```bash
npx doc-contract-linter --registry contracts.json
```

---

## 🚀 クイックスタート

### 1. 仕様契約ファイル `contracts.json` を定義

プロジェクトのルートディレクトリに `contracts.json` を作成します：

```json
{
  "$schema": "https://raw.githubusercontent.com/takaodev/doc-contract-linter/main/contracts.schema.json",
  "schemaVersion": 1,
  "scope": "プロジェクト仕様適合性検証",
  "docFolders": ["docs", "docs-dev"],
  "userDocPrefix": "docs/",
  "requirements": [
    {
      "id": "API-VERSION",
      "component": ".",
      "title": "APIバージョンの整合性",
      "mode": "static",
      "documents": ["docs/api/overview.md"],
      "checks": [
        {
          "file": "package.json",
          "kind": "json_equals",
          "path": ["version"],
          "value": "1.2.0"
        },
        {
          "file": "docs/api/overview.md",
          "kind": "contains",
          "value": "v1.2.0"
        }
      ]
    }
  ]
}
```

### 2. コマンドラインでの実行

```bash
# 基本実行
npx doc-contract-linter

# レポートを artifacts ディレクトリに出力
npx doc-contract-linter --output artifacts/docs-lint

# GitHub Actions PR連携（インライン注記 + サマリー出力）
npx doc-contract-linter --github-actions --quiet
```

### 3. 設定ファイル `.doccontractrc.json` による運用

リポジトリルートに `.doccontractrc.json` を配置することで、コマンドライン引数を省略できます：

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

## 🤖 GitHub Actions ワークフロー設定例

プルリクエスト時に自動で仕様契約を検証し、違反箇所を PR 上に直接インライン表示します：

```yaml
name: Documentation Verification

on:
  pull_request:
    branches: [main]

jobs:
  lint-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx doc-contract-linter --github-actions --quiet
```

---

## 🛡️ 読者境界（Audience Boundary）監査

デフォルトで `docs/` 配下の全マークダウンファイルがスキャンされ、以下の開発者専用の情報が混入していないか監視されます：

- **環境変数・シークレット名**: `_SECRET`, `_KEY`, `_PEPPER`, `_PASSWORD` 等
- **内部通信パス**: `/v1/internal/*`, `/admin/*` 等
- **内部ソースコード参照**: `app/Provider/*`, `src/internal/*` 等
- **開発者コマンド**: `npm run build`, `dotnet publish`, `docker exec` 等

独自の境界ルールを正規表現で追加することも可能です。

---

## 📄 ライセンス

MIT License © 2026 takaodev
