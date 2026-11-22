# Release checklist

Use this for every tagged release. The release workflow re-runs verification on the tagged
commit, and `.github/workflows/ci.yml` covers changes on `main`. This checklist covers the manual
checks and packaging steps that CI cannot prove.

## Public web gate

- `pnpm build:web` retains the source demo (`index.html`) and embedded
  PWA (`pwa.html`) for Tauri and developer testing.
- `pnpm build:hosted` refuses a missing or privileged Supabase key and
  promotes the real RLS-backed volunteer/coordinator PWA as the web root.
  `vercel.json` runs this build. Never publish `dist/` from plain
  `build:web` as a real hosted organization service.
- The web coordinator currently has live health and upcoming shifts; it
  does **not** reproduce every desktop coordinator editing or reporting
  screen. Verify the precise scope before inviting an organization.
- Run `pnpm test:hosted` and `pnpm test:ops` before publishing web assets.
  Confirm the deployed `/` serves the PWA entrypoint rather than
  the localStorage preview.
- Test live email confirmation, all membership roles, two organizations,
  revoked members, last-seat contention, offline sync, sign-out,
  notifications and password recovery on a staging HTTPS origin.
  `.github/workflows/hosted-auth-smoke.yml` provides a read-only
  three-account authorization gate, but it needs seeded staging credentials.

**Do not claim production readiness from a successful build alone.**

## Prerequisites

- A clean checkout of the exact commit to release, with no untracked secrets.
- The Node version in `.node-version`, pnpm 12.9.1, stable Rust, and the platform's Tauri
  prerequisites.
- `pnpm install --frozen-lockfile` completes without changing the lockfile.
- The signing and updater secrets are configured for this repository. Unsigned test builds may
  be distributed as such, but a functioning auto-updater requires a valid signed feed.
- Verify that the updater endpoint points to `Praket7/civic-flow` and that the embedded public
  key matches the signing private key configured for its releases. A successful build does not
  prove that an update can be authenticated.
- Earlier `civicflow2` installers still point to the original repository's feed. Test upgrades
  from a prior `civic-flow` release separately; do not assume those older binaries will
  discover the new feed without an explicitly tested transition.

## Signing and publication gate

The tagged release workflow now **fails closed** if required updater,
macOS signing/notarization, Windows signing, or Supabase shared-workspace
credentials are missing. Configure the GitHub Actions secrets
`TAURI_SIGNING_PRIVATE_KEY`, `VITE_SUPABASE_ANON_KEY`,
`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
`WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`,
and either a complete Apple ID or App Store Connect API notarization set.

A release tag must point to a merged `main` commit. Artifacts are published
to a **draft GitHub release** first, so GitHub's public `latest` feed and
existing auto-updaters do not expose binaries before verification.
Complete checksums, provenance, the real clean-install matrix and a signed
updater round trip _before_ manually publishing the draft. Configuring
secrets and getting a green build is not evidence that existing user data
upgrades correctly.

Do not advise visitors to bypass Gatekeeper or SmartScreen for an untrusted
installer. Investigate and correct missing signatures or notarization.

## Version and automated gate

1. Bump the version in all four manifests together: `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml`, and `src-tauri/core/Cargo.toml`.
2. Run the exact-tag check. The tag must match the manifest version; prerelease tags must use the
   same prerelease version in every manifest.

   ```bash
   node scripts/check-release-version.mjs vX.Y.Z
   ```

3. Run the full local gate:

   ```bash
   pnpm verify
   cargo check --manifest-path src-tauri/Cargo.toml
   pnpm audit --prod --audit-level=high
   gitleaks dir . --no-banner --redact --config .gitleaks.toml
   ```

4. Confirm the CI run for the exact commit is green. Do not tag a different SHA.

## Build installers

Build on each target platform, or tag the commit and let the release workflow build the matrix.
The workflow produces one universal macOS DMG (Apple silicon and Intel), Windows x64, and Linux x64
installers, plus the signed updater feed, `SHA256SUMS.txt`, and GitHub build provenance attestations.

For a local macOS build:

```bash
pnpm build:web
pnpm tauri build --target universal-apple-darwin --bundles dmg
```

## Clean-install matrix

Use a fresh OS install or a disposable VM for each column. Download through a browser so
quarantine or Mark-of-the-Web applies.

| Check                                                                                                 | macOS | Windows 11 | Ubuntu 24.04 |
| ----------------------------------------------------------------------------------------------------- | ----- | ---------- | ------------ |
| Verify `SHA256SUMS.txt` before opening the installer                                                  | ☐     | ☐          | ☐            |
| Complete Gatekeeper, SmartScreen, or AppImage permission flow                                         | ☐     | ☐          | ☐            |
| Launch with the network off and open the demo workspace                                               | ☐     | ☐          | ☐            |
| Build and apply an AutoRoster plan                                                                    | ☐     | ☐          | ☐            |
| Check in a volunteer and record a no-show                                                             | ☐     | ☐          | ☐            |
| Approve service hours and export a CSV and PDF report                                                 | ☐     | ☐          | ☐            |
| Create a backup, change data, and restore the backup                                                  | ☐     | ☐          | ☐            |
| Quit, relaunch, and confirm the data persisted                                                        | ☐     | ☐          | ☐            |
| Sign in to the shared workspace                                                                       | ☐     | ☐          | ☐            |
| Install the previous release, update to this release, and confirm data and the keychain entry survive | ☐     | ☐          | ☐            |

Do not mark a row complete from a developer machine or from an earlier build. Record the actual
release-candidate result, and do not claim notarization or signing that was not performed.

## Signing constraints

- Public macOS release builds require a Developer ID signature and successful
  notarization. The release workflow fails if its required credentials are absent.
- Public Windows release builds require a code-signing certificate. Do not
  publish a development installer as if it were a signed production release.
  Checksums and attestations supplement a signature; they do not replace it.
- Linux AppImages need the executable bit; the deb and rpm use WebKitGTK 4.1.
- The updater requires `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
  Losing either half prevents installed builds from updating.

## Backup and restoration gate

1. Protect `main` and the GitHub `backup-production` environment with
   reviewed commits and restricted environment secrets.
2. Configure an encrypted off-site destination, and manually run
   `.github/workflows/backup-cloud.yml` on `main`. Review the encrypted
   S3 object's existence without downloading plaintext to CI artifacts.
3. On a private workstation, use `scripts/verify-cloud-restore.sh` against
   a throwaway localhost `civicflow_restore_*` database. Confirm actual
   organization rows, auth identities, RLS grants and user workflows.
4. Document the restoration date, operator, key custody, retention policy,
   recovery time and point objectives. Do not create a `backup_runs`
   success entry until real verification has occurred.
5. A GitHub scheduled dispatcher is not a substitute for an external liveness
   alarm. Prove reminder delivery to a consenting test device and review
   last-job freshness in the hosted coordinator health console.

## Tag and publish

1. For a release candidate, bump all four manifests to `X.Y.Z-rc.N`, run the checks, and tag
   `vX.Y.Z-rc.N`. A hyphen makes the GitHub release a prerelease, so it never becomes `latest`
   or feeds the updater.
2. Run the clean-install matrix against the candidate assets. Fix defects and repeat the
   candidate build if necessary.
3. Bump all four manifests to `X.Y.Z`, rerun the local gate and CI, and tag `vX.Y.Z`.
4. Verify the release contains the universal macOS DMG, Windows and Linux x64 installers,
   `SHA256SUMS.txt`, the updater feed, and GitHub build provenance attestations.
5. Install the published release, then install the next patch release from **Settings → Updates**
   and complete the updater round trip.


## Known unresolved deployment gates (consolidated from archived issues)

These are **not completed** merely because the hardening and judging PRs are merged or
CI is green. Do not populate a live volunteer organization with personal data or publish a
trusted installer until the relevant acceptance gates are evidenced. The archived source
issues remain available at [#1](https://github.com/Praket7/civic-flow/issues/1),
[#2](https://github.com/Praket7/civic-flow/issues/2),
[#4](https://github.com/Praket7/civic-flow/issues/4),
[#5](https://github.com/Praket7/civic-flow/issues/5),
[#6](https://github.com/Praket7/civic-flow/issues/6), and
[#8](https://github.com/Praket7/civic-flow/issues/8).

- [ ] **Database migration reconciliation (#1):** Compare the 18 local migration files with
      the seven managed-history versions in an isolated clone. Neither matching filenames
      nor tests prove the existing SQL matches; do not run blind production `db push`.
- [ ] **Real authenticated authorization (#1, #4):** Test actual sessions for coordinators,
      volunteers, revoked members and two organizations, including simultaneous last-seat
      registration, real sync, logout/recovery and notification rules.
- [ ] **Legacy encrypted data (#2, #5):** Reopen pre-upgrade SQLCipher databases on both
      supported desktop OSes and test updater migration, not only new installations.
      The vulnerable SQLCipher dependency was patched and audited; upgrade compatibility
      has not yet been demonstrated.
- [ ] **Repository controls (#5):** An administrator must enable protected main/required
      checks and review rules. Merging on an unprotected branch is not that proof.
- [ ] **Trusted desktop release (#5, #8):** Configure Apple notarization, Windows
      code-signing and Tauri signing/updater secrets in protected GitHub Actions,
      verify clean installs, signed updates, backup/restore, checksums and OS warnings.
      Internal unsigned evaluation artifacts are not publicly trusted installers.
- [ ] **Durability and reminders (#6):** Complete a real encrypted off-site backup and
      isolated restore test. The Free-tier managed service must not be assumed to
      provide daily backups. Verify a newly successful reminder-dispatch job and
      delivery to an explicitly consented test device; historical runs are not evidence
      that the current schedule is healthy.
- [ ] **Judging site (#4, #8):** Verify the actual deployment origin, not only CI's
      localhost server. The public `/judge/` and `/judge/demo/` must be reachable
      without authentication, must use fictitious data only, and must be hosted on a
      dedicated judging origin separate from any production data-bearing PWA. The
      browser sample is not equivalent to a complete hosted coordinator backend.

**Closing GitHub issues to consolidate tracking does not waive any of these gates.**
