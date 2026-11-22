# CivicFlow foundation baseline — Phase 0

## Source and verified import

- Source: [Praket7/civicflow2](https://github.com/Praket7/civicflow2)
- Original baseline: `89cc6d6c173cae7564463076c47fccb21b0de2cb` (2026-11-02)
- Audited Phase 0/1 source: `6538cf9fae00d0937db3dd531a280a1a52f79a26`
- Successor: [Praket7/civic-flow](https://github.com/Praket7/civic-flow), `main`
- Source Git tree: `4ad3f0e2b71ce8c2e0c2f65df5227193ccb6da24`
- New repository import tree: `4ad3f0e2b71ce8c2e0c2f65df5227193ccb6da24`

All **585 file blobs** (including screenshot and icon binaries) were transferred
and the complete Git tree hashes were compared successfully. This proves that
the imported source snapshot matches the audited source **byte for byte**.

**Commit ancestry was not mirrored.** The connected GitHub tools copied the
files into a new repository with a new commit graph. For the original commit
history and contributor attribution, consult `civicflow2`. A historical mirror
can still be imported using a conventional authenticated `git push --mirror`
or appropriate history-preserving workflow; do not pretend the new commit
graph represents original development. Preserve the MIT license, third-party
notices, and bundled media credits.

## Development environment

- Node: `22.20.0` (`.node-version`); pnpm: `12.9.1` (CI)
- Rust: stable; Tauri 2 platform prerequisites
- React 19, TypeScript, Vite; Tauri 2/Rust; SQLCipher-encrypted local SQLite
- SQLite local schema v15 (15 migrations), Supabase Postgres shared workspace
- Install: `pnpm install --frozen-lockfile`
- Full gate: `pnpm verify`
- SQL integration: `pnpm test:sql` (PGlite, 65 tests including permission cases)
- Desktop build: `pnpm tauri build`

The source [Phase 0/1 CI run](https://github.com/Praket7/civicflow2/actions/runs/44990995772)
passed **all 65 SQL tests**, TypeScript, lint, formatting, frontend unit tests,
and Rust checks. The dependency audit failed on an existing vulnerable
`libsqlite3-sys` 0.35.0 dependency. The new repository requires fresh CI
verification; a passed source run does not verify a new build automatically.

## Deployment and repository configuration

1. Configure GitHub branch protection and required checks on `civic-flow/main`.
2. Configure deployment secrets and variables **in GitHub**, not in files. Keep
   `SUPABASE_SERVICE_ROLE_KEY` exclusively in trusted server runtimes.
3. Upgrade the SQLite/SQLCipher dependency chain and verify the native
   macOS/Windows/Linux builds before issuing a successor installer release.
4. The legacy release links in `README.md` remain pointed at `civicflow2`
   intentionally while this repository has **no published installers**.
5. The Tauri updater endpoint also still uses the legacy feed intentionally.
   Switch it only in a tested release migration with compatible signing keys.
   Avoid breaking the existing install base with an empty updater feed.
6. Before applying database hardening to production, restore database access,
   take a database backup, validate on a staging clone, and confirm user
   registration, workspace bootstrap, pull, and server reminder dispatch.
7. Publish a new release only after the full CI matrix, signed update path,
   clean installs, and migration upgrades are verified.

## Phase 1 status and gaps

- Implemented: explicit SQL function privileges, restricted internal RPCs,
  change-log RLS, service-only reminder functions, regression tests.
- Verified: 65/65 PGlite SQL integration tests at the source PR head.
- Not verified: actual deployed Supabase credentials, policy results in the
  managed project, native installers, security-advisor findings.
- Blocking condition: connected Supabase management reports `ACTIVE_HEALTHY`,
  but SQL access fails with PostgreSQL `28P01` for `postgres` and
  `supabase_read_only_user`. **No live migration was deployed.**
- Dependency blocker: source [security issue #3](https://github.com/Praket7/civicflow2/issues/3).

Do not mark Phase 1 complete until production/staging database connectivity,
advisors, and runtime checks pass. Deploy permission migrations from a reviewed
migration history, not by inserting SQL blindly into an inaccessible project.
