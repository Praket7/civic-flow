# CivicFlow public release readiness

Status: **Not ready for unrestricted public deployment**  
Reviewed: November 22, 2026  
Source: `Praket7/civic-flow`, draft pull request #3

This is a release-gate audit, not a claim that every interaction, browser, platform,
translation, or database restore has been independently tested. The purpose is to
separate verified engineering work from features that only look complete in the demo.

## What is actually built

CivicFlow currently has three different delivery surfaces:

- **Tauri desktop:** local-first coordinator and volunteer workflows, using
  SQLCipher-encrypted SQLite. Its optional shared-workspace view uses Supabase.
- **Browser demonstration (`index.html`):** the full-looking coordinator and
  volunteer preview uses a seeded, browser-local repository, **not the hosted
  organization database**. It must not be advertised as a production account
  service or used for actual volunteer records. A production build now blocks
  local preview signup and password sign-in.
- **Shared-workspace PWA (`pwa.html`):** a separate Supabase-backed app for
  volunteers, with a narrower coordinator health/operations surface. Its
  real-world account, onboarding, offline recovery and notifications flows
  require live end-to-end acceptance testing.

A successful `pnpm build:web` produces both HTML entry points. It does not
make them equivalent or turn the browser demonstration into production SaaS.

## Phase 0: repository and baseline — mostly met

The successor repository exists, and the original `civicflow2` was preserved.
The source baseline, licenses, media credits and development commands are
documented. The desktop updater feed in the draft branch points to the new
repository; previous released binaries do not automatically inherit that feed.

**Still required:** verify release signing credentials, application identifiers,
updater key compatibility, and the platform-specific upgrade path before
publishing a successor installer.

## Phase 1: database and security — materially improved, not closed

Two production migrations were applied to Supabase `civicflow-auth`:

- `20261122145712_harden_rpc_permissions` restricts internal function grants
  and enables RLS on the four `sync` tables, retaining organization-scoped
  change-log access and the static replication catalog.
- `20261122150910_notification_read_membership` adds an active-membership
  condition before the privileged notification-read RPC can mutate a record.

Authorization checks were run with temporary simulated role/JWT context and
rolled back. Member workspace bootstrap and pull succeeded, cross-organization
pull was refused, and direct access to sensitive internal tables was denied.
The `42501 permission denied for table devices` entry at approximately 09:58
ET was the intentional negative-permission test, **not a production outage**.
Do not grant blanket `SELECT` to silence it.

Supabase's advisor still reports the deliberately public VAPID-key RPC,
14 authenticated `SECURITY DEFINER` entry points that need continued
function-level review, and two deny-by-default internal tables with no user
read policy. The Auth leaked-password screening warning is separate: this
organization is on the **Free plan**, whereas Supabase lists the feature as
Pro-plan-or-higher. It cannot be enabled at the current plan tier.

**Still required:** capture a usable production backup; rehearse restore and
permission migration on an isolated copy; reconcile existing migration-history
version drift; test actual user sessions, revoked memberships, second-org
access, real concurrent registrations, push delivery, notification recovery
and token expiration; review data retention and privacy policy.

Do not perform a blind `supabase db push` against the live database until
older migration versions have been reconciled.

## Phase 2: architecture and code quality — incomplete

The React-to-repository-to-native separation is documented, and Rust's
matching engine is separated from its database adapter. However, the browser
`previewRepository.ts` is a very large module, and `matching.rs` contains
multiple responsibilities. Refactoring every large file without evidence of
behavioral equivalence is more dangerous than keeping a working module.

**Still required:** split preview account, organization, roster and persistence
operations behind tested interfaces; centralize error categories and recovery
instructions; measure AutoRoster speed and memory at realistic volunteer and
shift sizes; compare output and explanations before and after any algorithm
refactor. Do not change optimization priorities merely to simplify code.

## Phase 3: interaction and visual design — not signed off

The repository already has accessibility-tree, contrast, 200%-zoom, print,
typecheck and UI-unit-test automation. These checks are worthwhile but do not
establish user comprehension or accessibility for complete interactive flows.

The public landing page previously presented static demo figures as
`Database verified`, `Backup ready` and `3 of 3` startup checks. It now
describes product capabilities and openly labels sample data. Public copy was
also corrected to distinguish local desktop records from cloud sync.

**Still required:** compare the real five principal screens at desktop,
tablet and narrow mobile sizes; inspect focus order, keyboard navigation,
drawers, modals, form errors, empty states and 200% zoom; capture reviewed
visual baselines; do at least one assistive-technology walkthrough and task
testing with coordinator and volunteer participants. Give status indicators
real data sources, not decorative success badges.

Target **WCAG 2.2 AA** for public-facing core flows, including readable text,
visible focus, descriptive labels, target sizes and non-color-only statuses.

## Phase 4: workflows and demo data — partially verified

The corrected demo clock and activity records have a checked-in consistency
gate. SQL integration tests cover organization isolation, command authority,
waitlists, notifications and replicated changes. Native tests cover important
local workflows and encrypted backups.

**Still required:** complete coordinator and volunteer journeys against real
hosted accounts and at least two organizations, including invite acceptance,
availability editing, last-seat concurrency, role assignment, check-in,
attendance correction, verification letters, report export, offline changes
and reconnection. AutoRoster must be tested against unavailable volunteers,
overlaps, credentials, age rules, time zones and workload policies using
production-shaped fixtures, not only the bundled demonstration.

## Phase 5: language quality, accessibility and documentation — incomplete

There are **60 locale entries**, and the catalog test requires more than 75%
of source phrases to have non-identical translated values. The language
inventory and placeholder tests do not demonstrate human-reviewed accuracy.
The separate PWA does not yet share the entire desktop translation surface.

**Still required:** explicitly distinguish supported versus experimental
languages; review high-risk service, eligibility, date/time, consent, privacy
and confirmation wording with native speakers; check right-to-left layouts;
measure PWA untranslated coverage; make the claim on the Accessibility page
match verified capabilities. Keep README, privacy/support information and
deployment guidance consistent with the real browser data model.

## Phase 6: deployment and release — not complete

Five-job GitHub CI has passed on earlier security-hardening commits, including
native macOS end-to-end tests, dependency audit, Rust, frontend and secret
scan. Any newer commits must pass on their **exact SHA**. No signed,
notarized and verified successor release has been published.

**Still required:** staging deployment, configuration and secret review,
fresh installs on macOS/Windows/Linux, data migration from existing
SQLCipher stores, tested backup/restore, upgrade/downgrade behavior, network
failure recovery, native and PWA smoke tests on actual devices, and a
monitored release with installation guidance and honest limitations.

Do not mark the browser coordinator demo as generally available. Launch
the Supabase-backed PWA only after real-user acceptance checks; release
the desktop installers after the separate platform and signing gates pass.

## Evidence and references

- [Draft hardening PR #3](https://github.com/Praket7/civic-flow/pull/3),
  [Supabase issue #1](https://github.com/Praket7/civic-flow/issues/1),
  and [SQLCipher issue #2](https://github.com/Praket7/civic-flow/issues/2).
- [Most recent fully green pre-web-copy CI](https://github.com/Praket7/civic-flow/actions/runs/45036768007).
  Later commits require fresh verification.
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) and
  [W3C design guidance](https://www.w3.org/WAI/tips/designing/).
- [Supabase production security checklist](https://supabase.com/docs/guides/security/production-checklist)
  and [password protections](https://supabase.com/docs/guides/auth/password-security).
- [Usability of volunteer brokerage websites](https://scispace.com/papers/usability-of-volunteer-brokerage-websites-the-why-and-how-of-2y506r41ns):
  supports evaluating real volunteer tasks with users rather than visual
  appearance alone.
- [Flow-A11y: Flow-Aware Accessibility Testing](https://www.alphaxiv.org/abs/2607.03100):
  an emerging research approach; useful context for testing interactive
  flows, not a replacement for WCAG evaluation or assistive-tech testing.

**Release decision:** hold. The next useful proof is one complete,
multi-role, two-organization hosted user journey followed by a tested
production backup restore. Public design polish should proceed in parallel
without sacrificing those controls.
