# Release checklist

Use this for every tagged release. The release workflow re-runs verification on the tagged
commit, and `.github/workflows/ci.yml` covers changes on `main`. This checklist covers the manual
checks and packaging steps that CI cannot prove.

## Public web gate

Do not confuse the three distribution targets:

- `index.html` is a demonstration backed by browser-local storage. The production
  build must refuse to create or sign in local accounts, visibly identify sample
  records, and never invite real-person data entry.
- `pwa.html` is the real shared-workspace volunteer client. Before hosting it,
  verify an actual Supabase signup, email confirmation, membership assignment,
  registration, sync/retry, device revocation, and notification flow on the final
  HTTPS origin. A configured anonymous/public key is not proof of these workflows.
- The Tauri desktop app uses encrypted local SQLite. Verify fresh installs,
  existing encrypted database upgrades, signed distribution, and backups separately.

**Do not promote the full coordinator browser preview as a production SaaS.**
Its repository still uses `localStorage`. Add a server-backed coordinator data
implementation and real multiuser authorization tests before that release target.

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
updater round trip *before* manually publishing the draft. Configuring
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

- Without an Apple Developer ID certificate and notarization credentials, macOS builds are
  ad-hoc signed and Gatekeeper will reject them on a quarantined download. Publish the Open Anyway
  instructions with the release; do not imply the artifact is notarized.
- Without a Windows code-signing certificate, SmartScreen warns about the installer. Publish that
  limitation explicitly and rely on SHA-256 checksums plus GitHub build provenance, not a
  self-signed certificate.
- Linux AppImages need the executable bit; the deb and rpm use WebKitGTK 4.1.
- The updater requires `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
  Losing either half prevents installed builds from updating.

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
