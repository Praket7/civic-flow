# Contributing to CivicFlow

Thanks for helping maintain CivicFlow. Changes should make volunteering easier for coordinators and volunteers without compromising the accuracy or privacy of their records.

## Before opening a pull request

1. Read the [architecture overview](docs/architecture.md) and identify the affected layer.
2. Use fictional data for local development and screenshots.
3. Keep changes focused. Explain the problem, not just the files changed.
4. Add a regression test for a bug fix and appropriate coverage for new behavior.

## Development

Install the Node version specified in [`.node-version`](.node-version), pnpm 12.9.1, stable Rust and the Tauri system dependencies.

```sh
pnpm install --frozen-lockfile
pnpm verify
```

Use [the test guide](docs/testing.md) to run smaller suites while developing.

## Naming and review

Use PascalCase for React components, camelCase for TypeScript utilities, kebab-case for feature directories and scripts, and snake_case for Rust modules and SQL identifiers. Put unit tests next to the code they exercise; keep cross-component integration tests with their subsystem.

Do not rename or rewrite migrations that have already been applied. Add new migrations when database behavior changes.

A pull request should explain user-visible effects, relevant tradeoffs, test results, and any changes to authentication, storage or deployment. Request review from a maintainer before merging changes to a release branch.
