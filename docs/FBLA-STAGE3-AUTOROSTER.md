# Stage 3 â€” AutoRoster intelligence and verification

**Repository:** Praket7/civic-flow  
**Baseline:** main commit 312dbd7 (merged PR #13).  
**Scope:** explainable and deterministic staffing decisions, a trustworthy coordinator review, adversarial correctness evidence, and reproducible benchmarks. This stage does not change production Supabase schema or misrepresent the judging demo as a hosted multiuser coordinator.

## Algorithm and already-implemented capabilities

The native Rust engine enforces skill, credential, minimum-age, availability, overlapping-shift, and organization-policy constraints before ranking candidates. It uses deterministic min-cost max-flow plus a follow-up for nonoverlapping same-day assignments. Required roles get priority. Every recommendation includes eligibility checks and weighted score components.

Coordinators can preview a plan without committing, see "why this volunteer," ask "why not another," view a forced-alternative comparison showing displaced seats, and accept or reject proposed staffing. Existing assignment locks, waitlist promotion, cancellation recovery, and stale-plan revision checks are preserved.

The browser judging workspace has its own demo matching implementation and golden regression tests. It is not the native Rust solver.

## Added in Stage 3

1. Independent, read-only proposal verification reconciles open seats, assignments, remaining gaps, individual and total scores, the candidate and seat identifiers, and hard-cons¶»§q«^