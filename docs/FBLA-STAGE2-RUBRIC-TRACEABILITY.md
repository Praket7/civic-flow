# CivicFlow — Stage 2 architecture, workflows and FBLA evaluation

**Branch:** `feat/fbla-stage2-architecture-ux-workflows-2026-11-22`  
**Status:** implementation candidate pending exact-head CI and cross-device verification.  
**Rubric:** [National FBLA Coding & Programming 2026–27 (August 2026)](https://greektrack-fbla-public.s3.us-east-1.amazonaws.com/files/1/High%20School%20Competitive%20Events%20Resources/Individual%20Guidelines/Presentation%20Events/Coding-and-Programming.pdf), pages 4, 8–9.

## Why these changes

The official 110-point evaluation includes code clarity, modularity, UX rationale,
accessibility, intuitive navigation, intelligent features, syntactic AND semantic
input validation, prompt coverage, customizable reports, data storage and presentation.
Stage 2 improves observable product behavior rather than adding cosmetic success
badges. Judges should test claims, not infer implementation from screenshots.

## Traceability and reproduction

| Rubric area                           | Change                                                                                                                                                                                                                                  | How to verify                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Validation (5)                        | Shared pure opportunity validator runs on wizard progression and again on final save. Rejects fractional/exponential/infinite/zero capacity, unreasonable shift duration, empty locations, invalid causes, excessive requirement lists. | `pnpm test -- src/lib/workspace/opportunityValidation.test.ts`; create a program and try 1.5, 201, 0-hour durations.            |
| Reports (10)                          | Cause donut and trend now use the same selected date range/cause rows as the table. Full matched count is disclosed separately from the 12-row preview, and duration uses minutes consistently.                                         | `pnpm test -- src/features/reports/CustomReportPage.test.ts`; change cause/range in the custom report.                          |
| Modularity (10)                       | Browser evaluation-account parsing separated from 3,782-line preview repository, with defensive JSON parsing tests. It is explicitly NOT real authentication.                                                                           | `pnpm test -- src/lib/workspace/previewAccountStorage.test.ts`.                                                                 |
| Errors and recovery                   | Shared exception normalization recognizes native errors, strings and provider error objects without displaying an opaque serialized object.                                                                                             | `pnpm test -- src/lib/errors.test.ts`.                                                                                          |
| Intelligent feature (5 UX navigation) | Preserves deterministic Rust min-cost matching and explanations; introduces an ignored, reproducible workload-scale benchmark without changing algorithm priorities.                                                                    | `cargo test --manifest-path src-tauri/core/Cargo.toml benchmark_realistic_volunteer_and_shift_counts -- --ignored --nocapture`. |
| User journey and documentation        | Public competition page connects coordinator, volunteer, matching, reporting and source inspection to the scoring criteria.                                                                                                             | Open `/judge/` and `/judge/demo/`; inspect at 200% zoom.                                                                        |

## Evidence-driven design

- [Ben Zaken et al. (2022), _Generating Recommendations with Post-Hoc Explanations for Citizen Science_](https://scispace.com/papers/generating-recommendations-with-post-hoc-explanations-for-1x35flfn): explanation alongside volunteer recommendation is an appropriate research direction; this is not proof CivicFlow improves retention.
- [Rauchecker & Schryen (2018), _Decision Support for the Optimal Coordination of Spontaneous Volunteers in Disaster Relief_](https://scispace.com/papers/decision-support-for-the-optimal-coordination-of-spontaneous-1lsqtmabr7): relevant precedent for constrained volunteer assignment and decision support.
- [MATWA (2024), _A Web Toolkit for Matching under Preferences_](https://www.alphaxiv.org/abs/2409.04402): reference for transparent preference-based matching systems.
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/): focus visibility, clear descriptions and usable target sizes should be tested on real flows, not only by scanners.

## Seven-minute competition demonstration

1. 0:00–0:45: nonprofit coordination problem, two roles, architecture and language choice.
2. 0:45–2:00: volunteer journey, discovery, registration, schedule and tracked hours.
3. 2:00–3:40: coordinator journey, gaps, AutoRoster ranking and why a candidate was rejected.
4. 3:40–5:00: semantic validation (reject fractional or out-of-range capacity), then create a valid opportunity.
5. 5:00–6:15: change report date/cause filters, inspect aligned charts and export; distinguish sample from real records.
6. 6:15–7:00: code modularity, deterministic tests and offline-first desktop story; distinguish what is tested from what remains a release gate.

The NLC provides three minutes of setup, seven minutes of presentation and
three minutes of Q&A, with no shifting of time between them. Internet may be
unreliable; an independently installed and tested offline desktop backup is
needed before relying on that demonstration at NLC.

## Boundaries / outstanding work

- Do not confuse browser-local demo users and records with authenticated
  Supabase data. Stage 1 signing, real-user RLS, migration-history reconciliation,
  backup restore and desktop installation gates remain open unless separately verified.
- The benchmark is disabled in standard CI and is **not a performance claim**
  until it has been run with recorded hardware/configuration.
- Green automated checks do not establish a perfect rubric score, manual keyboard
  navigation, voiceover performance, real-user task success or a trusted installer.
- Keep `main` protected and review this branch's CI before merging.

## New York prejudging is a separate 200-point gate

For NYS FBLA, the program URL is assessed before the state presentation. The project sheet assigns 30 points each to dynamically correct results and customizable reports, and 20 to storage including dynamic backup. Other 20-point criteria cover identifiers, helpful comments, documentation, concise if-then logic, logical workflows and intelligent navigation.

Source: [NYS official 2026–27 Coding & Programming guidelines](https://www.nysfbla.org/wp-content/uploads/2026/10/26-27-NYS-FBLA-Complete-Competitive-Events-Guidelines.pdf). The project URL must be accessible to prejudging judges without private credentials. Check the judging page and its interactive sample in a clean browser and on another device. Local sample data is not production-secure cloud storage.

The [2027 NYS SLC mailing](https://www.nysfbla.org/wp-content/uploads/2026/09/SLC-HS-Mailing-Email-Blast-2.pdf) states a January 15, 2027, 11:59 p.m. ET Blue Panda upload deadline, correcting the apparent 2026 typo in the state event overview. See the detailed 200-point rubric and tests in the Stage 2 Quality guide. National judging uses the distinct 110-point presentation sheet.
