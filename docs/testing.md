# Testing CivicFlow

Tests are organized by the system they exercise rather than by when they were written. Unit tests stay close to their implementation; integration tests and acceptance checks have their own directories.

| Location                | Scope                                           |
| ----------------------- | ----------------------------------------------- |
| `src/**/*.test.ts(x)`   | React, domain helpers and browser adapters      |
| `src/test/`             | Shared frontend test setup                      |
| `src-tauri/core/tests/` | Rust and SQLite integration                     |
| `supabase/tests/`       | SQL policies, RPC, synchronization and delivery |
| `scripts/tests/`        | Build, backup and release utilities             |
| `tests/e2e/`            | Native desktop journeys                         |

## Commands

```sh
pnpm test
pnpm test:sql
pnpm test:hosted
pnpm test:ops
cargo test --locked --manifest-path src-tauri/core/Cargo.toml
pnpm verify
```

Run the complete verification suite before submitting a change. The native end-to-end suite requires a supported desktop test environment and a built test application.

The SQL suite runs migrations against PGlite using synthetic accounts. Hosted staging smoke tests are separate and must use explicitly authorized accounts.

## Acceptance checks

- Report tests reconcile visible totals, CSV and printable output with source records.
- Roster tests exercise eligibility, deterministic planning and policy parity.
- Browser audits exercise keyboard navigation, focus, zoom, contrast and print.
- Release checks verify asset manifests and version consistency.

Keep generated screenshots, reports, logs and benchmark output out of Git unless they are deliberately maintained product documentation. CI archives temporary evidence with the source revision.

## Hosted startup comparison

The [same-runner browser comparison](../.github/workflows/frontend-performance.yml) builds the exact base and candidate commits with synthetic public configuration. It alternates six runs using fresh Chrome profiles and disabled browser caching. Only loopback network traffic is allowed. It compares median first-contentful paint and observed document readiness for the hosted welcome, judging showcase and interactive sample, plus compressed entrypoint sizes.

The timing guard allows 35% plus 200 ms of variation; the bundle guard allows 2% plus 1 KiB. These are regression thresholds, not a promise of identical results on all devices. Keep the raw observations with the commit when reporting performance.
