# CivicFlow foundation baseline — Phase 0

## Source and migration target

- Original source: [Praket7/civicflow2](https://github.com/Praket7/civicflow2)
- Baseline commit: `89cc6d6c173cae7564463076c47fccb21b0de2cb` (main, November 2, 2026)
- Planned successor: `Praket7/civic-flow` (display name: CivicFlow)
- Source repository remains unchanged on `main` until work is reviewed.
- Preserve the MIT license, third-party notices, asset credits, and accurate development history.

This working branch is a staging area, not a newly created repository. GitHub
repository creation is a separate account-level action not available through
the current GitHub integration.

## Toolchain and reproducible commands

- Node: `22.20.0` from `.node-version`
- pnpm: `12.9.1` (pinned in GitHub Actions)
- Rust: stable, with the Tauri 2 platform prerequisites
- Frontend: React 19, TypeScript, Vite; desktop shell: Tauri 2
- Local data: SQLite (schema v15, 15 local migrations); shared data: Supabase Postgres
- `pnpm install --frozen-lockfile`
- `pnpm verify`: TypeScript, lint, formatting, unit tests, SQL tests, builds, accessibility audits, Rust checks
- `pnpm test:sql`: PGlite integration tests, including `permissions.test.mjs`
- `pnpm tauri build`: platform installer builds

Previous source CI success: [GitHub Actions run 41539064142](https://github.com/Praket7/civicflow2/actions/runs/41539064142).
This is a historical baseline, **not** evidence that this new branch has passed.
A CI run on this branch and a fresh native installation are required.

## New repository migration procedure

1. Create a new empty repository named `civic-flow` under `Praket7`, with
   **no** generated README, license or .gitignore.
2. Review and merge the Phase 0/1 staging PR in `civicflow2`, or transfer
   the reviewed commit to a new branch in `civic-flow`.
3. Clone the existing project with its history, point the remote to the new
   repository, and push `main` and the desired development branches. Do **not**
   force-push existing references or import release tags indiscriminately.
4. Configure branch protection, required checks, repository secrets, and
   Supabase environment variables in the new repository.
5. Change `Praket7/civicflow2` references in release documentation, release
   provenance checks, app update endpoints, and distributable metadata.
   Confirm actual signing and update-feed behavior before publishing releases.
6. Re-run the entire CI matrix and build a fresh native installer on each
   supported operating system.

Never copy secret **values** from one repository into committed files.
The `SUPABASE_SERVICE_ROLE_KEY` must remain server-side. The
`VITE_SUPABASE_*` values are public client configuration, not privileged keys.

## Baseline acceptance gates

- A preserved history and working original source repository.
- An installable and reproducible developer toolchain.
- All existing tests and the new SQL authorization regression tests pass.
- The new Postgres hardening migration runs after all existing migrations.
- A tested upgrade/rollback path and documented signing/updater identity.
- No claim that a repository or release is production-ready before those checks.
