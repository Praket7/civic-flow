# Production onboarding hardening

Baseline: PR #25 merge `433cf69e1c8f7bd4d214415536591d5447513512`, November 26, 2026.

## Scope

The production catalog confirms the Stage 7 composite device key, credential verification, revoked raw job-table grants, public push-key invoker, and zero anonymous executable public SECURITY DEFINER functions. The live migration ledger uses different historical timestamps. Do not replay all repository migrations or mark versions applied solely by matching names.

This patch makes six existing request-identity policies statement-constant without altering row-dependent tenant predicates, explicitly denies raw global backup/job reads even after an accidental SELECT grant, and adds three indexes on user foreign keys supporting recipient reads and user-deletion cleanup. It deliberately does not remove required authenticated command RPCs or existing indexes merely because an advisor lists them.

## Required deployment gate

- Run the full SQL, hosted, operational and application regression suite on this exact commit.
- Compare staging query plans and read/write latency against the baseline using representative data; index maintenance has a write cost. Triage remaining informational foreign-key findings by workload rather than blindly adding all indexes.
- Reconcile historical migration versions against actual definitions and grants; validate a backup and isolated restore before production DDL.
- Apply the exact reviewed migration once, record the actual provider ledger version and verify policies, grants, indexes and advisors afterward.
- Exercise two staging organizations, separate authenticated accounts, revoked memberships, last-seat concurrency, reconnect, and recipient-specific push delivery. Never use real volunteer data for fixtures.
- If a rollback is needed, restore the six previous identity expressions and the prior two policy expressions from the pre-change schema snapshot; drop only these three new indexes after confirming they were created by this migration. Keep existing grants revoked.

No production migration is authorized merely by merging this PR. Actual live onboarding also requires Auth/email settings, MFA/owner access, verified backup/restore, privacy review and a measured pilot.

## References

- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): request-constant auth functions can use a scalar subquery; row-dependent functions must remain correlated.
- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod): appropriate indexes, staging load testing, backups and migration discipline.
- [RLS side channels](https://scispace.com/papers/rls-side-channels-investigating-leakage-of-row-level-3uwo1r04): row filtering alone is not a proof against all information leakage.
