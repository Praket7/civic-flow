# CivicFlow — FBLA Stage 1 judging and release gates

**Status: candidate implementation; not a published, signed, installed, or production-certified release.**

This work is based on the existing hardening pull request. Review and merge its
security fixes independently before treating this as a successor to `main`.

## Delivery boundaries

| URL or artifact | Data source | What it demonstrates |
| --- | --- | --- |
| `/` on the hosted website | Supabase authenticated PWA | Real volunteer and limited coordinator shared-workspace functionality |
| `/judge/` | Static application evidence | Public review page, screenshots, and guidance; no account needed |
| `/judge/demo/#/welcome` | Browser-local fictitious demo data | Full interactive coordinator preview, including AutoRoster and reporting |
| Signed Tauri installer | SQLCipher-encrypted SQLite local workspace | Complete offline-first desktop application after installer acceptance |

The judging sample never writes to the live organization backend. Its local storage
must not contain real volunteer information. The hosted production PWA must not
accept unverified local account credentials.

## Rebuild and verify

```bash
pnpm install --frozen-lockfile
pnpm check:demo
pnpm test:hosted
pnpm build:web
# Build configuration must supply a PUBLIC Supabase publishable/anon key.
# Do not use service-role or private credentials in browser code.
pnpm build:hosted
node scripts/check-judge-build.mjs
node scripts/audit-judge-flow.mjs # headless Chrome, clean profile, offline sample routes
```

The hosted build first preserves the sample entrypoint at
`dist/judge/demo/index.html`, bundles the five checked-in screenshots under
`dist/judge/screenshots/`, then promotes the authenticated PWA to
`dist/index.html`. The sample uses hash navigation because its coordinator
routes must not conflict with the hosted PWA routes.

This uses root-relative assets and requires a web server. Opening a built file
with `file://` is not supported. Check the delivered URL, not just local HTML.

## Competition smoke test

Use a clean browser profile with no CivicFlow storage or active session.

- [ ] Load `/judge/` without authentication or a blank page.
- [ ] Open `/judge/demo/#/welcome` and enter the browser-local demo with no password.
- [ ] Confirm changes in the demo do not appear in the hosted Supabase PWA.
- [ ] Navigate through coordinator scheduling, AutoRoster, service hours and reports.
- [ ] Refresh a nested hash route and confirm the screen remains usable.
- [ ] Verify every screenshot loads from the same host, with descriptive alt text.
- [ ] Verify `/` still renders the real hosted PWA rather than the sample demo.
- [ ] Disconnect from the network and demonstrate the *installed* native desktop application.
- [ ] Complete a clean install and cold start on macOS and Windows.
- [ ] Validate signing, notarization, installer checksums and the updater feed before publication.
- [ ] Reopen an older encrypted workspace and verify backup/restore with real fixtures.
- [ ] Confirm the submitted judging URL works unauthenticated on a second device.

## Use a dedicated judging origin

**Do not cohost the judging sample on an active production nonprofit origin.**
A URL path such as `/judge/demo/` separates navigation, but it does not
provide browser security isolation: pages under one origin share access to
cookies, localStorage, and IndexedDB unless otherwise restricted. Use a
dedicated Vercel project and hostname for FBLA judging, distinct from any
production deployment containing real volunteer sessions. Keep the site
populated exclusively with fictitious demo data; never test real credentials
on the judging origin.

The hosted root on that dedicated project remains the real PWA *build
entrypoint*, but it is not approved as a live organization service. The
judging sample is for a controlled educational demonstration. A future
production rollout should be separately validated and deployed on a
different origin.

## Administrative gates still required

The GitHub application can push code and open PRs, but this connector does not
expose a branch-protection write operation. Set repository rules in GitHub:
require PR reviews, six CI checks, resolved conversations and a linear merge
strategy as appropriate for `main`. Configure an explicit protection policy
before merging or tagging releases.

Production release signing, notarization and Windows certificates require
account-managed GitHub Actions secrets. Do not copy signing keys into source,
issues, chat or screenshots. The existing release workflow deliberately fails
closed until valid secrets exist and produces a **draft** release first.

For the hosted site, link the reviewed source to the correct Vercel project and
configure only the Supabase **publishable** key in the site's build environment.
Never put a service-role key in a Vite-prefixed variable. Test a preview URL
before assigning a public judging domain.

NYS FBLA's 2026–27 state guidelines require a URL for prejudging and warn
about inaccessible URLs. The official state calendar identifies
**January 15, 2027** as the competition submission deadline; obtain the
final upload rules from your adviser before submission.

## What passing CI cannot establish

The static judging page is not a substitute for a signed desktop installer.
Passing TypeScript, Rust, SQL, and compiled asset checks does not independently
prove a clean-install experience, Apple/Windows trust, live multi-account
authorization, backup recovery or all user interactions. Keep those gates open
until directly observed on the target platforms.

### Sources

- [NYS FBLA 2026–27 guidelines](https://www.nysfbla.org/wp-content/uploads/2026/10/26-27-NYS-FBLA-Complete-Competitive-Events-Guidelines.pdf)
- [National Coding & Programming requirements](https://www.fbla.org/competitive-events/coding-programming/)
- [Tauri distribution guidance](https://v2.tauri.app/distribute/)
- [Vercel Git deployment and preview guidance](https://vercel.com/docs/git)
- [Research on operator comprehension in scheduling](https://www.alphaxiv.org/abs/2610.18679)
- [Empirical CI improvement research](https://scispace.com/papers/what-helped-and-what-did-not-an-evaluation-of-the-strategies-54pegccr9i)

## Archived issue ledger — release blockers still open operationally

This section consolidates the former GitHub issue trackers. **The tasks below have not been
verified just because a CI job is green or an issue is closed.** Preserve these acceptance
requirements before putting real volunteer information into production or distributing a
trusted desktop release.

- **#1 — database migration history and authorization:** The original audit found 18
  source migrations versus seven versions in the managed Supabase migration history.
  Reconcile SQL on an isolated restored clone before any production \`db push\`. Test real
  coordinator, volunteer, revoked-user and cross-organization sessions.
- **#2 — encrypted workspace upgrades:** SQLCipher was upgraded to patched dependencies
  and the security audit is green, but legacy encrypted files still require actual
  cross-version upgrade tests on the target desktop operating systems.
- **#4 — hosted coordinator boundaries:** The public browser demo uses fictitious,
  browser-local data. The real hosted PWA has narrower coordinator functionality;
  server-backed write operations, multi-user concurrency and full production web QA
  still require independent evidence. Keep the judging demo on its own hostname.
- **#5 — branch protection and trusted installers:** An administrator must configure
  GitHub's required-check/review rules for \`main\`. Apple notarization, Windows
  signing, Tauri updater keys, clean-install, backup and compatibility testing have
  not been established by the internal unsigned evaluation builds.
- **#6 — backup and reminder operations:** Prove an encrypted off-site database backup
  can be restored in isolation. Confirm a newly successful reminder scheduler run
  and notification delivery; a historic run does not establish current health.
- **#8 — prejudging acceptance:** Verify the real submission URL in a clean private
  browser and on a second device, including \`/judge/\`, \`/judge/demo/\`, and
  the documented sample flows. Confirm the current NYS FBLA asset requirements.

Related archived tracker URLs: [#1](https://github.com/Praket7/civic-flow/issues/1),
[#2](https://github.com/Praket7/civic-flow/issues/2),
[#4](https://github.com/Praket7/civic-flow/issues/4),
[#5](https://github.com/Praket7/civic-flow/issues/5),
[#6](https://github.com/Praket7/civic-flow/issues/6),
[#8](https://github.com/Praket7/civic-flow/issues/8).

**Archiving an issue tracker is not a claim that its outstanding work is complete.**
