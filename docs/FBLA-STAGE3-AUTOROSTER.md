# Stage 3 — AutoRoster intelligence and verification

**Repository:** Praket7/civic-flow  
**Baseline:** Stage 2 PR #13 merged at 312dbd7; Stage 3 PR #14 merged at 7518fed and consolidated PR #16 merged at 7750182. All six PR #16 CI jobs passed.
**Scope:** explainable and deterministic staffing decisions, a trustworthy coordinator review, adversarial correctness evidence, and reproducible benchmarks. This stage does not change production Supabase schema or misrepresent the judging demo as a hosted multiuser coordinator.

## Algorithm and already-implemented capabilities

The native Rust engine enforces skill, credential, minimum-age, availability, overlapping-shift, and organization-policy constraints before ranking candidates. It uses deterministic min-cost max-flow plus a follow-up for nonoverlapping same-day assignments. Required roles get priority. Every recommendation includes eligibility checks and weighted score components.

Coordinators can preview a plan without committing, see "why this volunteer," ask "why not another," view a forced-alternative comparison showing displaced seats, and accept or reject proposed staffing. Existing assignment locks, waitlist promotion, cancellation recovery, and stale-plan revision checks are preserved.

The browser judging workspace has its own demo matching implementation and golden regression tests. It is not the native Rust solver.

## Added in Stage 3

1. Independent, read-only proposal verification reconciles open seats, assignments, remaining gaps, individual and total scores, the candidate and seat identifiers, and hard-constraint evidence. It detects duplicated slots and multiple same-shift bookings of one volunteer.
2. A failed integrity check prevents applying the proposed plan in the interface. The transactional backend still performs authoritative revision and policy checks.
3. Expandable plan evidence explains the proposed coverage, unfilled-seat reasons, score interpretation, and workload distribution without cluttering the main planner.
4. Projected weekly shift counts show minimum and maximum across the represented candidate pool. This is workload spread, not demographic fairness.
5. Unknown availability is flagged for coordinator follow-up rather than presented as verified.
6. Why-not alternatives are ordered deterministically. Eligible contenders appear first, but blocked contenders remain available to explain their actual hard-rule refusal.
7. Native solver tests cover 64 combinatorial skill scarcity cases against the existing independent brute-force oracle, plus a specialist-scarcity case where first-eligible greedy fills one of two roles but the optimizer can fill both.
8. A manual reproducible 1,000-volunteer, 250-seat scale fixture complements the pre-existing 24/12, 120/35 and 300/80 benchmarks. CI never asserts an unreliable wall-clock threshold.

## Stage 3 follow-up: workload audit and reliable judging entry

The read-only audit independently reconciles proposed shifts against the
current seat-level evaluation, catches cross-shift time overlaps and excessive
role capacity, and refuses malformed shift intervals or mismatched unfilled
roles. Its integration tests include a real demo optimizer fixture so the
extra verification does not wrongly reject valid recommendations.

The read-only audit additionally rejects invalid numeric scores, fractional or negative
candidate workloads, and duplicate candidate identifiers. Workload evidence now compares
the _same represented candidate pool_ before and after assignment: minimum/maximum,
spread and average shifts per week, explicitly noting if concentration worsens.
These measures are not demographic fairness, predictions of retention, or evidence
of better real-world outcomes. Native Rust remains the authoritative solver.

On the public hosted PWA, judges can open the isolated, no-account sample from
the first screen, the sign-in page or the provider-loading splash. The judging
workspace remains at /judge/demo/#/welcome and the public site lives at
https://civic-flow-demo.vercel.app. A compiled Chromium regression exercises the
mistaken sign-in route and verifies it reaches the demo without credentials.

## Limits and accuracy

- Weighted match score means relative preference, not attendance probability or a percentage.
- The configured fairness weight balances workload; it is not a demographic statistical parity certification.
- No synthetic experiment establishes real-world volunteer retention, long-term outcomes or production latency.
- Rust native and browser preview matching remain separate implementations.
- Nothing is booked until a coordinator explicitly applies the plan.
- Ask volunteers to confirm uncertain availability before publicizing final assignments.

## Test commands

Frontend: pnpm install --frozen-lockfile; pnpm typecheck; pnpm lint; pnpm test; pnpm build:hosted; pnpm test:hosted.

Rust: cargo test --manifest-path src-tauri/core/Cargo.toml; cargo test --manifest-path src-tauri/core/Cargo.toml --test roster_performance -- --ignored --nocapture.

Record CPU, Rust version, build profile, volunteer and seat counts, greedy/optimized fill counts, objective scores only when comparable, and elapsed time. Stage 2's Linux Intel Xeon Vercel sandbox benchmarks had equal filled counts and faster first-eligible greedy times; do not claim general speedup. The new specialist-scarcity fixture illustrates where suitability constraints can make optimization useful.

## Research basis

- Sampson (2006), [Optimization of volunteer labor assignments](https://onlinelibrary.wiley.com/doi/full/10.1016/j.jom.2005.05.005): volunteer supply and underutilization differ from wage-based workforce allocation.
- [Optimization of volunteer task assignments to improve volunteer retention and nonprofit organizational performance](https://www.sciencedirect.com/science/article/pii/S0038012122001872): motivation for preferences and role fit, not proof CivicFlow increases retention.
- [Trustworthy and Explainable Decision-Making for Workforce Allocation](https://www.alphaxiv.org/abs/2412.10272): human-readable decision evidence and human review.
- [A Multi-Objective Optimization Framework for Intelligent Volunteer Matching](https://scispace.com/papers/a-multi-objective-optimization-framework-for-intelligent-woy2b8uyge64): report quality, fairness, and interpretability separately.
- [Empowering Volunteer Crowdsourcing Services](https://arxiv.org/abs/2408.11510): baseline comparisons and explicit completion measurements.

## Acceptance gates

Verified against merged PR #16 (CI run [45185465715](https://github.com/Praket7/civic-flow/actions/runs/45185465715), six successful jobs) and the production Vercel alias. On November 23, 2026, the canonical URL resolved to the Stage 3 merge deployment `7750182` (READY). The compiled Chromium check exercises fresh-browser welcome, both no-account entry paths, and the sample coordinator route. The UI's preview and why-not controls are read-only until the explicit Apply operation, which performs authoritative transactional checks. This is automated source and built-browser acceptance, not independent real-account usability or clean-device sign-off.

- [x] Six GitHub CI jobs green on the final Stage 3 PR head.
- [x] Native solver oracle and specialist-scarcity tests pass, alongside existing constraints and forced-comparison tests.
- [x] Frontend proposal reconciliation, invalid-plan blocking, and alternative ranking tests pass.
- [x] Stage 2 golden roster regression and cancellation recovery remain green.
- [x] Coordinators can review, question, and reject a plan without writing data.
- [x] Demo production domain runs the intended commit, with fresh-browser welcome and no-account example access.

Separate release gates remain for real multi-organization staging accounts, cloud migration history, encrypted restore, signed installers, and clean-device testing. A green synthetic CI suite is not proof of these.
