# CivicFlow — Stage 2 architecture and rubric evidence

**Scope:** Stage 2 engineering quality; November 22, 2026.  
**Base:** reviewed `main` (`f6f3538`). **Target:** draft PR #9, not production.  
**Release decision:** not approved for real nonprofit records or signed public installers.

## Why these changes matter

The [official 2026–27 FBLA Coding & Programming rubric](https://greektrack-fbla-public.s3.us-east-1.amazonaws.com/files/1/High%20School%20Competitive%20Events%20Resources/Individual%20Guidelines/Presentation%20Events/Coding-and-Programming.pdf) is a 110-point **presentation** rating sheet, not a code-only audit. Strong implementation is necessary, but delivery and accessible user journeys must also be demonstrated.

| Category | Max points | Verifiable demonstration / evidence |
| --- | ---: | --- |
| Language choice | 5 | Explain React/TypeScript for accessible interactive UI; Rust for deterministic native domain engine; SQLite/SQLCipher for offline persistence; Postgres/RLS for opt-in shared data |
| Comments, naming and formatting | 5 | Small scoped comments explain invariants and the reason for defensive checks; use `pnpm lint`, `pnpm format`, `cargo fmt --check` |
| Logical, modular architecture | 10 | Pure `preview/reports.ts` and `preview/volunteerImport.ts`; separate `matching/flow.rs`; tests prove outputs do not depend on UI storage |
| UX rationale, user journey, accessibility | 10 | Demonstrate a volunteer-to-coordinator journey, keyboard navigation, accessible labels and visible states; retain manual assistive-technology acceptance gate |
| Intuitive interface and instructions | 5 | Show clear coordinator and volunteer navigation, in-context help, and plain-language forms |
| Navigation and intelligent functionality | 5 | Demonstrate AutoRoster eligibility, recommended assignments, alternative explanations and Q&A/help with real behavior |
| Syntactic and semantic input validation | 5 | Show duplicate-email, invalid availability, missing required fields and malformed CSV feedback without crashing |
| Topic requirements | 10 | Recruit, schedule, approve attendance/hours, retain records and explain actual nonprofit usefulness |
| Customizable analytical reports | 10 | Select report templates/fields/causes/date ranges and export a meaningful sample; `preview/reports.test.ts` checks coverage math |
| Data structures, persistence, scope | 5 | Explain typed arrays/sets/maps, scoped repositories, encrypted local database and authenticated cloud policies without conflating demo with production |
| Presentation organization, delivery and Q&A | 30 | Rehearse a coherent 7-minute demonstration, make technical decisions understandable and answer test/security tradeoff questions |
| Rules and event protocols | 10 | Use permitted devices; prepare a true offline desktop fallback; judges must not click/scans links or QR codes |
| **Total** | **110** | **No score is claimed before judging** |

### Stage 2 engineering changes

1. **Preview report engine:** read-only, explicit `request + workspace + snapshot` dependencies; report logic no longer hidden among browser account handlers. Report values and demo boundaries are regression-tested.
2. **CSV validator:** pure `text + existing email list` inputs; malformed quoting now produces a specific error instead of swallowing the row. Existing email/duplicate rows, field semantics and generated template have regression tests.
3. **Error contract:** `classifyError` normalizes Rust `AppError`, JavaScript `Error` and provider rejections to code, category, field, recovery guidance and retryability. Raw SQL/path information is not shown for database/internal failures; legacy callers retain `messageOf`.
4. **AutoRoster solver:** min-cost max-flow graph lives in its own Rust module, with direct correctness tests for negative costs, capacity, and selected edges. Candidate/day nodes are generated once per distinct day, not once per role slot. The ordering is preserved so deterministic tiebreakers remain unchanged.
5. **Performance evidence:** `roster_performance.rs` creates deterministic, realistic combinations of skills, seven-day availability, mandatory roles, eligibility ages, conflicting day slots and workload data. Two equal-input runs must produce identical plans **and explanations**. It measures elapsed time without unreliable hardcoded timing thresholds.

## Verify exact-commit behavior

```bash
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm format
pnpm test -- src/lib/errors.test.ts src/lib/workspace/preview
pnpm test:sql && pnpm build:web
cd src-tauri/core
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo test --test roster_performance medium_roster_performance -- --ignored --nocapture
# Optional larger benchmark; run on a known machine for repeatable comparison:
cargo test --release --test roster_performance large_roster_performance -- --ignored --nocapture
```

Record benchmark **hardware, build profile, candidate count, seat count, fill count, score and elapsed time** before any claims of speedup. The implementation preserves matching priorities; no benchmark measurement alone proves global scheduling optimality for every real-world case. Keep a sample-output screenshot and a clean CI run linked to the exact PR head.

## Judge demonstration (7-minute walkthrough)

| Elapsed time | Action and evidence |
| --- | --- |
| 0:00–0:40 | State nonprofit problem and what CivicFlow actually solves; distinguish the offline desktop app from the fictitious judging sample |
| 0:40–1:30 | Walk through volunteer discovery, registration and service history |
| 1:30–2:40 | As coordinator, show coverage gaps and a real AutoRoster recommendation |
| 2:40–3:40 | Explain hard eligibility vs scoring, why a candidate is selected, and why an alternative was rejected |
| 3:40–4:40 | Demonstrate input validation, including an invalid availability value, and navigate help or Q&A |
| 4:40–5:45 | Customize a report by cause or fields and examine accurate totals |
| 5:45–6:35 | Show modular Rust/TypeScript code, comments, deterministic tests and measured benchmark output |
| 6:35–7:00 | Summarize measurable nonprofit value, honest offline/cloud boundaries and limitations |

The preliminary round permits **3 minutes setup, 7 minutes speaking, 3 minutes Q&A**; power may be unavailable and venue internet unreliable. Carry a charged laptop with a demonstrated local build. The event expects source code, README, third-party notices and an error-free standalone application. A judge may see a link but must not click it under the event protocol.

## Research informing the approach

- [FBLA 2026–27 national Coding & Programming guidelines and scoring (August 2026)](https://greektrack-fbla-public.s3.us-east-1.amazonaws.com/files/1/High%20School%20Competitive%20Events%20Resources/Individual%20Guidelines/Presentation%20Events/Coding-and-Programming.pdf).
- [Kenger, *Benefits of modularity and module-level tests* (2004)](https://scispace.com/papers/benefits-of-modularity-and-module-level-tests-aqdjmqsj0b): small functional units and verification at module boundaries.
- [Yen and Bakken, *Heuristic evaluation versus end-user think-aloud* (2009)](https://scispace.com/papers/a-comparison-of-usability-evaluation-methods-heuristic-1io7s84er1): expert checks and real participant task tests find different usability barriers.
- [Prenzel and Ringwelski, *Design of Human-computer Interfaces in Scheduling Applications* (2012)](https://scispace.com/papers/design-of-human-computer-interfaces-in-scheduling-2kqabm7fhw): studied decision support for human schedulers.
- [*A Benchmarking Suite for Flexible Job Shop Scheduling Problems with Worker Flexibility under Uncertainty* (2025)](https://www.alphaxiv.org/abs/2501.16159): motivates reporting workload sizes and stable evaluation fixtures rather than one toy instance.
- [*Best Practices for Empirical Meta-Algorithmic Research* (2025)](https://www.alphaxiv.org/abs/2512.16491): motivates reproducible, adequately described benchmarks.

**Scope of these citations:** they inform design and test methods; they do not independently verify CivicFlow performance or prove a rubric score.

## Explicit non-goals and open release blockers

Stage 2 does **not** change production Supabase tables, migrate customer data, release unsigned installers, or secretly turn the judging sample into a real multiuser hosted coordinator. The Stage 1 ledger at [FBLA-STAGE1-JUDGING.md](FBLA-STAGE1-JUDGING.md) remains binding: RLS staging-account acceptance, legacy encrypted upgrades, real restore rehearsal, reminder delivery, signed releases, browser QA on a dedicated hostname and branch protection still require separate evidence.

Treat a green CI run as necessary, not sufficient. Before submission, have multiple people perform coordinator/volunteer tasks with real devices and record failures. Follow the actual FBLA honor-code and school submission requirements.
