# Stage 4 — Verified Reporting & Impact

**Project:** CivicFlow — FBLA Coding & Programming 2026–2027
**Scope:** Local desktop SQLite and isolated browser judging sample.
**Competition relevance:** The official [2026–2027 Coding & Programming guidelines](https://greektrack-fbla-public.s3.us-east-1.amazonaws.com/files/1/High%20School%20Competitive%20Events%20Resources/Individual%20Guidelines/Presentation%20Events/Coding-and-Programming.pdf) award up to **10 points** for a presentable, customizable, analyzable report and **5 points** for appropriate data structures. This document describes mechanisms, not a promised score.

## The source-to-report contract

1. An **hour entry** has a stable record ID, volunteer/program link, service date, submitted duration, current approval status and optional approved duration. Corrections update the reported approved total; an approved duration is _not_ inferred from a pending or rejected submission.
2. **Verified** contributions count toward approved minutes and unique contributing volunteers. **Pending** minutes remain visible as submitted-but-unapproved work; **rejected** records remain visible for audit but add zero service time. Duration arithmetic uses integer minutes before any display conversion.
3. The **report builder** constructs a single typed `ReportRequest` with template, field allowlist, inclusive dates, cause, stable program ID and grouping choice. Preview, chart and export consume the report generated from that request; the chart cannot display hours omitted by the report's field selection.
4. The **coverage report** counts role seats in non-canceled shifts; a requested historical range includes historical shifts, whereas no specified period means upcoming shifts. Zero required seats are reported as **N/A coverage**, not fabricated 100%.
5. **Attendance** is a separate event-based measure: a completed check-in counts as arrival, and no-shows never count as arrivals. It is not interchangeable with a verified service-hour total.
6. **Outcome metrics** (meals, families served, etc.) are separate program-recorded data, not derivable from hours. Do not describe outcomes as independently verified when only a record is available.
7. **Snapshot-only templates** (retention cohorts and credentials inventory) explicitly say that activity period/cause/program selectors do not apply. Do not silently imply those filters affect an inventory snapshot.

## Judge walkthrough

Open the no-account [judging sample](https://civic-flow-demo.vercel.app/judge/demo/#/welcome) and navigate to **Reports → New report**. Select _Service date, Approved minutes, Requested minutes, Status, Record ID, Program, Cause_. Switch between _year to date_ and custom date ranges, and between different programs and causes. Compare a corrected, pending and rejected hour record. Export CSV/PDF and confirm the same row counts and approved total, including zero-result periods. Open **Coverage by program** to compare historical service against the upcoming-capacity view. Source record IDs make row-by-row reconciliation possible.

The hosted Supabase PWA is not equivalent to the full offline desktop product. The judging sample is isolated local sample data; it does not exercise production organization-authorized cloud reporting. Run the native SQLite report tests independently.

## Reproducible checks

- `pnpm test -- src/lib/workspace/preview/reports.test.ts src/features/reports/CustomReportPage.test.ts` — exact-answer ledger and chart tests.
- `cd src-tauri/core && cargo test --test reports` — native report reconciliation, date validation, export and filtering.
- `pnpm typecheck && pnpm lint && pnpm format` and `cd src-tauri/core && cargo fmt --check && cargo clippy --all-targets -- -D warnings`.
- Full main CI checks include native and Windows compilation, browser judging traversal, security and dependencies. Verify them against the **exact PR head** before merging.
- In a clean browser, manually change a custom period and selected program, confirm table/charts change, and compare exported CSV contents. Record actual screenshots and checks rather than assuming a successful build establishes browser behavior.

### Known-answer ledger

The Stage 4 fixture supplies 45 approved minutes for an originally submitted 90-minute correction, 30 additional verified minutes, 100 pending requested minutes and a rejected 60-minute claim with a deliberately stale 600-minute approved override. The correct October report is **75 approved minutes**, **100 pending minutes**, **one rejected claim**, **two verified volunteers**. The August entry is excluded by the selected month. A canceled shift never inflates the October coverage result.

## Design and research rationale

- [FBLA 2026–2027 Coding & Programming event rubric](https://greektrack-fbla-public.s3.us-east-1.amazonaws.com/files/1/High%20School%20Competitive%20Events%20Resources/Individual%20Guidelines/Presentation%20Events/Coding-and-Programming.pdf) — configurable, accurate reports, validation and clear programming explanations.
- [Jarske et al., _Modeling the Dashboard Provenance_ (2023)](https://www.alphaxiv.org/abs/2308.06788) — indicate data origins, transformations and timing so users can trust dashboards.
- [_The Complexities of Volunteer Data_ (2024)](https://scispace.com/papers/the-complexities-of-volunteer-data-96s7d2cpnywv) — real nonprofit volunteer records are challenging to gather and maintain.
- [W3C Data on the Web Best Practices](https://www.w3.org/TR/dwbp/) — data provenance, metadata and accuracy.
- [W3C Accessible Tables](https://www.w3.org/WAI/tutorials/tables/) — meaningful accessible table headers.
- [VolunteerBadge hour-tracking guide](https://www.volunteerbadge.com/blog/how-to-track-your-volunteer-hours) — operational distinction between submitted and verified volunteer hours, correction history, stable record IDs and filtering.

## Explicit boundaries

- The demo's seeded records are synthetic, not a validated record of genuine nonprofit outcomes.
- Native and browser stores use separate reporting engines and require parity tests; matching field names alone does not prove source parity.
- A computed proportion of arrivals is only based on recorded attendance events. If no observations exist, show N/A.
- Report dates are inclusive local calendar dates. Shift timestamps are sliced to the persisted local date convention; cross-time-zone semantics require a separately tested production policy.
- Rejected corrections must remain auditable; this stage does not implement a generalized immutable approval-event history.
