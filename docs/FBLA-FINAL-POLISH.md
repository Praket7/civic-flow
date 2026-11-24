# Final competition polish and adversarial audit

This is a behavior-preserving cleanup and targeted correctness pass after the eight-stage plan. Stage 8 PR #22 was merged at `5633459b919d6e0a41c9972d890e84b0bb89e8a4`; its tree matched the candidate that passed all fourteen jobs. Production rollout and competitor-led acceptance remain separate.

## Findings and implemented corrections

| Finding | Correction and verification |
| --- | --- |
| Duplicate single-shift and weekly roster application | Both call one validated, atomic snapshot commit. Revision and policy checks, waitlist promotion, audit records and recipient-specific notices remain. |
| Repeated lock and access control in native commands | Centralized database lock, user, member, coordinator and steward guards. The lock remains held throughout the operation; no role is cached. All IPC command names and data contracts remain unchanged. |
| Zero-minute approved correction fell back to the requested amount | Shared report preserves explicit zero; pending/rejected claims ignore stale approved amounts. One accumulator handles both pending and verified service. |
| Ten-year empty-bucket cap hid later real service months | Every observed service month remains in the breakdown, even beyond the cap on empty buckets. |
| Date validation varied by path | Shared strict calendar validator, incomplete/reversed shared report range guard and clear UI error; native validation rejects malformed multibyte input before extracting a year. |
| Saved JSON null or arrays could break report builder | Accept only a JSON object as filters; recover to defaults. |
| CSV formula prefixes differed by runtime | Guard leading whitespace, control characters and full-width formula prefixes in browser and native exports; preserve original text. Browser retains signed number/phone exception. |
| Demo retention was a fixed 62% | Calculate six cohorts from distinct observed service days and complete 30-day observation windows; rejected and duplicate same-day claims cannot inflate return rates. |
| Report generation repeatedly searched volunteers, programs and shifts | Index once per generation, preserve first program/day fallback and record-ID deduplication. |
| Credential report multiplied unrelated skills and credentials | Independent inventory rows, one per recorded skill or credential; include volunteers without skills, use the workspace clock and distinguish unverified/not-yet-valid credentials. |
| Native PDF truncated long identifiers and folded Latin accents | Wrap cells and continue across pages; wider landscape layout for many columns, repeated table header and page count, Windows ANSI Latin font. Full Unicode remains available in CSV. |
| Windows external browser launch passed the address into shell command text | Parse HTTPS addresses without credentials/control characters; pass the URL as data to a fixed Windows process invocation. Actual Windows interactive launch needs device testing. |

## Judge's adversarial review

- Can a stale plan reserve a seat or partially apply a batch? Weekly revision/policy guards and per-seat validation; run the journey regressions. Real simultaneous hosted last-seat acceptance is deferred.
- Can an invalid calendar date or malformed saved view crash the program? New calendar and native malformed-input regression cases; invalid shared range cannot produce an export.
- Do pending or rejected hours enter verified totals? Known-answer fixtures plus zero and stale approved values; source identities reconcile through reports.
- Is a credential matched to a skill merely because one person has both? No, the inventory separates records and explicitly states verification and validity.
- Is the retention number invented? No, the demo now computes it from its labeled synthetic data. Explain the denominator: first observed activity within the month with a fully elapsed 30-day window; a later distinct service day within 30 days is a return. Pending service counts as an observation, not verified service time.
- Can a report contain an active spreadsheet formula? Escaping and prefix regressions help; spreadsheet applications differ, so do not claim a universal spreadsheet security guarantee.
- Does PDF retain every character? Native report wraps instead of truncating; its built-in font covers Latin characters, not all scripts. CSV retains full Unicode and exact identifiers. Stage 8 separately rendered the browser export.
- Do different devices agree about a service day? Local calendar tests cover DST; shared shift grouping currently follows the device timezone. Organization-wide timezone policy and live hosted convergence require real-environment testing.
- Can a nonprofit trust backups and notifications? Live restore, recipient-only dispatch, production migration reconciliation, staging and signed public release remain deferred.
- Why is the project large? Three separate execution boundaries are retained: offline encrypted native SQLite, isolated browser sample and hosted PWA. Reducing duplicated rules is appropriate; deleting independent tests, migrations, licenses, translations or authorization boundaries is not.

## Research basis

- [FBLA Coding & Programming rating sheet](https://www.fbla.org/competitive-events/coding-programming/): modular, readable logic, validation, useful reports and a working standalone demonstration. There is no line-count scoring criterion.
- [Martin Fowler, Refactoring](https://www.martinfowler.com/books/refactoring.html): small behavior-preserving transformations, not source minification.
- [OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection): spreadsheet formula prefixes, locale variants and application-specific limitations.

The exact candidate must pass the original regression gates. Competition submission, clean-device/offline rehearsal, participant feedback, competitor's own technical explanation and attribution are independent requirements. Never present synthetic records or automated checks as genuine nonprofit impact or a guaranteed competition score.

- Shared seat transitions now preserve explicit coordinator-review requests on cancellation; reset invalidates previously reviewed plans, and duplicate-assignment batches are tested for atomic rejection.
