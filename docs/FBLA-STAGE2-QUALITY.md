# CivicFlow — Stage 2 architecture and rubric evidence

**Scope:** Stage 2 engineering quality; updated November 23, 2026.
**Base:** main at f5658651; target is the Stage 2 engineering closeout branch, pending PR review and CI.
**Release decision:** engineering acceptance is separate from real-user production and signed release acceptance.

## Why these changes matter

The [official 2026–27 FBLA Coding & Programming rubric](https://greektrack-fbla-public.s3.us-east-1.amazonaws.com/files/1/High%20School%20Competitive%20Events%20Resources/Individual%20Guidelines/Presentation%20Events/Coding-and-Programming.pdf) is a 110-point **presentation** rating sheet, not a code-only audit. Strong implementation is necessary, but delivery and accessible user journeys must also be demonstrated.

| Category                                    | Max points | Verifiable demonstration / evidence                                                                                                                                                |
| ------------------------------------------- | ---------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language choice                             |          5 | Explain React/TypeScript for accessible interactive UI; Rust for deterministic native domain engine; SQLite/SQLCipher for offline persistence; Postgres/RLS for opt-in shared data |
| Comments, naming and formatting             |          5 | Small scoped comments explain invariants and the reason for defensive checks; use `pnpm lint`, `pnpm format`, `cargo fmt --check`                                                  |
| Logical, modular architecture               |         10 | Pure `preview/reports.ts` and `preview/volunteerImport.ts`; separate `matching/flow.rs`; tests prove outputs do not depend on UI storage                                           |
| UX rationale, user journey, accessibility   |         10 | Demonstrate a volunteer-to-coordinator journey, keyboard navigation, accessible labels and visible states; retain manual assistive-technology acceptance gate                      |
| Intuitive interface and instructions        |          5 | Show clear coordinator and volunteer navigation, in-context help, and plain-language forms                                                                                         |
| Navigation and intelligent functionality    |          5 | Demonstrate AutoRoster eligibility, recommended assignments, alternative explanations and Q&A/help with real behavior                                                              |
| Syntactic and semantic input validation     |          5 | Show duplicate-email, invalid availability, missing required fields and malformed CSV feedback without crashing                                                                    |
| Topic requirements                          |         10 | Recruit, schedule, approve attendance/hours, retain records and explain actual nonprofit usefulness                                                                                |
| Customizable analytical reports             |         10 | Select report templates/fields/causes/date ranges and export a meaningful sample; `preview/reports.test.ts` checks coverage math                                                   |
| Data structures, persistence, scope         |          5 | Explain typed arrays/sets/maps, scoped repositories, encrypted local database and authenticated cloud policies without conflating demo with production                             |
| Presentation organization, delivery and Q&A |         30 | Rehearse a coherent 7-minute demonstration, make technical decisions understandable and answer test/security tradeoff questions                                                    |
| Rules and event protocols                   |         10 | Use permitted devices; prepare a true offline desktop fallback; judges must not click/scans links or QR codes                                                                      |
| **Total**                                   |    **110** | **No score is claimed before judging**                                                                                                                                             |

### Stage 2 engineering changes

1. **Preview report engine:** read-only, explicit `request + workspace + snapshot` dependencies; report logic no longer hidden among browser account handlers. Report values and demo boundaries are regression-tested.
2. **CSV validator:** pure `text + existing email list` inputs; malformed quoting now produces a specific error instead of swallowing the row. Existing email/duplicate rows, field semantics and generated template have regression tests.
3. **Error contract:** `classifyError` normalizes Rust `AppError`, JavaScript `Error` and provider rejections to code, category, field, recovery guidance and retryability. Raw SQL/path information is not shown for database/internal failures; legacy callers retain `messageOf`.
4. **AutoRoster solver:** min-cost max-flow graph lives in its own Rust module, with direct correctness tests for negative costs, capacity, and selected edges. Candidate/day nodes are generated once per distinct day, not once per role slot. The ordering is preserved so deterministic tiebreakers remain unchanged.
5. **Performance evidence:** `roster_performance.rs` creates deterministic, realistic combinations of skills, seven-day availability, mandatory roles, eligibility ages, conflicting day slots and workload data. Two equal-input runs must produce identical plans **and explanations**. It measures elapsed time without unreliable hardcoded timing thresholds.

## Stage 2 engineering closeout update (November 23)

The earlier reference to draft PR #10 is historical. The new work starts from the
already merged main commit f5658651.

- Browser preview repository now delegates matching policy, roster import storage,
  local backup fixture handling and demo-only matching to scoped modules in
  src/lib/workspace/preview. Each factory takes scoped dependencies.
- Rust matching planner orchestration and previous unit tests are separated into
  matching/planner.rs and matching/tests.rs. Public APIs remain unchanged.
- Invalid fractional limits, malformed saved policy, deceptive numeric input,
  cross-organization persistence and corrupt storage receive adversarial tests.
- Closeout review adds stored-policy enum/version/boolean validation at read and write,
  and detects edited or incomplete browser-demo snapshots before permitting restore.
  The preview checksum detects accidental damage, not malicious replacement or cryptographic authenticity.
- Shared hosted error mapping retains provider HTTP statuses and SQLSTATE,
  classifies failures consistently and filters internal SQL/path error messages.
- Three golden plan/evaluation hashes from side-by-side execution of old and
  new browser matching engines test that explanations and assignments are
  unchanged in three 14-shift scenarios.
- A synthetic greedy baseline has been added to the native Rust performance
  harness. Hardware, build profile, filled seats, total score and elapsed
  times must be recorded before making runtime comparisons.

The staged real-account hosted authorization smoke test is NOT automatically
covered by simulated tests. Three provisioned real staging accounts in two
organizations and GitHub Actions hosted-staging secrets are required. Encrypted
recovery, clean-device installers and signed release testing are independent
release gates.

Detailed architecture and benchmark methodology are included in the Stage 2 closeout appendix below.

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

| Elapsed time | Action and evidence                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:40    | State nonprofit problem and what CivicFlow actually solves; distinguish the offline desktop app from the fictitious judging sample |
| 0:40–1:30    | Walk through volunteer discovery, registration and service history                                                                 |
| 1:30–2:40    | As coordinator, show coverage gaps and a real AutoRoster recommendation                                                            |
| 2:40–3:40    | Explain hard eligibility vs scoring, why a candidate is selected, and why an alternative was rejected                              |
| 3:40–4:40    | Demonstrate input validation, including an invalid availability value, and navigate help or Q&A                                    |
| 4:40–5:45    | Customize a report by cause or fields and examine accurate totals                                                                  |
| 5:45–6:35    | Show modular Rust/TypeScript code, comments, deterministic tests and measured benchmark output                                     |
| 6:35–7:00    | Summarize measurable nonprofit value, honest offline/cloud boundaries and limitations                                              |

The preliminary round permits **3 minutes setup, 7 minutes speaking, 3 minutes Q&A**; power may be unavailable and venue internet unreliable. Carry a charged laptop with a demonstrated local build. The event expects source code, README, third-party notices and an error-free standalone application. A judge may see a link but must not click it under the event protocol.

## Research informing the approach

- [FBLA 2026–27 national Coding & Programming guidelines and scoring (August 2026)](https://greektrack-fbla-public.s3.us-east-1.amazonaws.com/files/1/High%20School%20Competitive%20Events%20Resources/Individual%20Guidelines/Presentation%20Events/Coding-and-Programming.pdf).
- [Kenger, _Benefits of modularity and module-level tests_ (2004)](https://scispace.com/papers/benefits-of-modularity-and-module-level-tests-aqdjmqsj0b): small functional units and verification at module boundaries.
- [Yen and Bakken, _Heuristic evaluation versus end-user think-aloud_ (2009)](https://scispace.com/papers/a-comparison-of-usability-evaluation-methods-heuristic-1io7s84er1): expert checks and real participant task tests find different usability barriers.
- [Prenzel and Ringwelski, _Design of Human-computer Interfaces in Scheduling Applications_ (2012)](https://scispace.com/papers/design-of-human-computer-interfaces-in-scheduling-2kqabm7fhw): studied decision support for human schedulers.
- [_A Benchmarking Suite for Flexible Job Shop Scheduling Problems with Worker Flexibility under Uncertainty_ (2025)](https://www.alphaxiv.org/abs/2501.16159): motivates reporting workload sizes and stable evaluation fixtures rather than one toy instance.
- [_Best Practices for Empirical Meta-Algorithmic Research_ (2025)](https://www.alphaxiv.org/abs/2512.16491): motivates reproducible, adequately described benchmarks.

**Scope of these citations:** they inform design and test methods; they do not independently verify CivicFlow performance or prove a rubric score.

## Explicit non-goals and open release blockers

Stage 2 does **not** change production Supabase tables, migrate customer data, release unsigned installers, or secretly turn the judging sample into a real multiuser hosted coordinator. The Stage 1 ledger at [FBLA-STAGE1-JUDGING.md](FBLA-STAGE1-JUDGING.md) remains binding: RLS staging-account acceptance, legacy encrypted upgrades, real restore rehearsal, reminder delivery, signed releases, browser QA on a dedicated hostname and branch protection still require separate evidence.

Treat a green CI run as necessary, not sufficient. Before submission, have multiple people perform coordinator/volunteer tasks with real devices and record failures. Follow the actual FBLA honor-code and school submission requirements.

## New York State prejudged asset — separate 200-point project rubric

New York's 2026–27 State Leadership Conference evaluates the working URL in a **200-point prejudged project** before selecting a maximum of five finalists. The national **110-point presentation** is a separate evaluation. An inaccessible program URL earns **zero** for the state prejudged portion.

| NYS prejudged criterion                   |  Points | Specific acceptance evidence                                                               |
| ----------------------------------------- | ------: | ------------------------------------------------------------------------------------------ |
| Identifiers, constants, objects and types |      20 | Inspect typed models, names, pure validation and scope in source                           |
| Useful comments                           |      20 | Review matching eligibility, validation, backups and permission invariants                 |
| Clear program documentation               |      20 | Follow README, help topics, installation notes and licensing records                       |
| Conditional logic that saves steps        |      20 | Try draft opportunity planning, AutoRoster and eligibility rules                           |
| Secure storage and dynamic backup         |      20 | Verify desktop SQLCipher and backup/restore; local browser sample is not production-secure |
| Logical sequence                          |      20 | Follow registration, staffing, attendance, hours approval and reporting                    |
| Intelligent navigation                    |      20 | Test interactive help, keyboard access and AutoRoster explanations                         |
| Accurate, dynamically updated results     |      30 | Change shift and volunteer data and reconcile status, hours and totals                     |
| Customizable analytical reports           |      30 | Filter by cause/date/fields and compare chart, table and export totals                     |
| **Total**                                 | **200** | No claim of judging points or independent accessibility certification                      |

Source: [official NYS Coding & Programming event and project sheet, pages 47–49](https://www.nysfbla.org/wp-content/uploads/2026/10/26-27-NYS-FBLA-Complete-Competitive-Events-Guidelines.pdf).

**Deadline:** [official NYS 2027 SLC mailing](https://www.nysfbla.org/wp-content/uploads/2026/09/SLC-HS-Mailing-Email-Blast-2.pdf) says **January 15, 2027, 11:59 p.m. ET** for Blue Panda uploads. The state event overview appears to have a 2026 date typo. Confirm with the adviser/portal. Check the public URL from a clean browser without a saved session and from a second device. A project that scores well on the presentation but cannot be accessed for prejudging will not advance.

The browser judging workspace contains only invented data, stored locally. It does not prove secure real-user authentication, encryption or trusted public desktop distribution. Those must be tested on the native app separately.

---

# CivicFlow — Stage 2 engineering closeout

Baseline: main at f5658651be560fae7b6f45bdeddb339764b39038.
Working branch: refactor/stage2-engineering-closeout-2026-11-23.

Scope: code modularity, error handling, validation, reproducible benchmarks,
and current documentation. No production database migration or release switch.

## Repository architecture

| Module                                         | Responsibility                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| src/lib/workspace/repository.ts                | Shared typed desktop/preview repository interface and adapter selection |
| src/lib/workspace/previewRepository.ts         | Browser workflow coordination, snapshot and audit orchestration         |
| preview/rosterStorage.ts                       | Scoped roster imports, storage and deduplication                        |
| preview/rosterPolicyStore.ts                   | Policy bounds, persistence and invalid-policy fallback                  |
| preview/backupStore.ts                         | Browser-only demo snapshot fixtures and capped retention                |
| preview/rosterEngine.ts                        | Demo-only ranking, candidate checks, explanations and plan previews     |
| preview/reports.ts; preview/volunteerImport.ts | Pure reporting and CSV validation                                       |
| src-tauri/core/src/matching.rs                 | Native eligibility, scoring, public matching domain                     |
| matching/planner.rs                            | Deterministic plan orchestration, forced assignments and same-day fill  |
| matching/flow.rs                               | Min-cost max-flow graph implementation                                  |
| matching/tests.rs                              | Former matching unit tests with identical expectations                  |

The Rust public plan and plan_with_forced functions retain their calling
conventions. Browser demonstration matching is not the production Rust solver.

## Error and input contracts

The shared classifyError result consists of category, safe message, optional
action/field and retryability. The hosted transport preserves provider code
and status through errors instead of discarding them. Native-style error
objects and hosted responses map to the same UI categories. SQL internals,
private paths and server traces are not exposed to the user.

Input tests cover malformed and misleading capacity/duration values,
fractional scheduling limits, invalid policy persistence, corrupt browser
storage and organization-scoped roster and policy isolation.

## Behavioral equivalence

The browser roster golden tests use three 14-shift scenarios with full
evaluations and plan hashes captured from side-by-side unmodified baseline
and extracted module executions. Existing Rust solver tests remain the native
behavioral acceptance gate.

## Benchmark methodology

Use the deterministic synthetic fixture in
src-tauri/core/tests/roster_performance.rs. It varies candidate skills,
availability, workloads and required roles. Baseline: iterate chronological
slots, choose the first eligible unassigned candidate for that calendar day.
This is a transparent non-optimal heuristic, not a solver-equivalent score.

Run from the repository root:

    cargo test --manifest-path src-tauri/core/Cargo.toml \
      --test roster_performance -- --ignored --nocapture

Record CPU hardware, Rust toolchain, build profile, candidate and seat counts,
filled counts, total optimized score, and elapsed time. Results are samples,
not guaranteed speedups or a claim of global optimum.

## Acceptance still requiring real environments

- Run the manually dispatched hosted-staging workflow with three real
  staged identities (coordinator A, volunteer A, coordinator B) across two
  organizations. Its secrets must be configured; fake login evidence is not
  a substitute.
- Reconcile actual migrations and exercise encrypted backup restoration on
  an isolated real native database.
- Test signed Windows/macOS installers, clean upgrades, assistive technology,
  offline resumption and real staged-account conflict/revocation behavior.
- Verify the eventual national submission URL and production Vercel branch.

A green CI run does not establish any of these real-world release gates.

## Recorded benchmark results

Benchmark performed on a 4-vCPU Vercel sandbox running Linux x86_64 on
an Intel Xeon reported at 2.90 GHz, Rust 1.100.0, Cargo test debug profile.
Single wall-clock samples (milliseconds) from November 23, 2026:

| Candidates | Seats | Greedy filled | AutoRoster filled | AutoRoster score | Greedy ms | AutoRoster ms |
| ---------: | ----: | ------------: | ----------------: | ---------------: | --------: | ------------: |
|         24 |    12 |            12 |                12 |             1112 |     0.062 |         1.701 |
|        120 |    35 |            35 |                35 |             3245 |     0.210 |        21.367 |
|        300 |    80 |            80 |                80 |             7415 |     0.479 |       138.486 |

The greedy reference filled the same number of seats but was faster in this
synthetic fixture. This is expected because it only checks feasibility and
does not maximize match quality. The reference has no comparable objective
score and no equivalent explanation payload. Do not claim an AutoRoster
speedup or superior fill-rate from this dataset. Planner determinism and
matching explanations are tested separately; more discriminating real-world
benchmark fixtures are needed before claiming improved staffing outcomes.
