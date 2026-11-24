# Stage 7 — production reliability and security

Baseline: Stage 6 merged commit `1fd76c73b35c6ab201d2e0e3accf02ec31392c81` passed all six CI jobs in [run 45316426714](https://github.com/Praket7/civic-flow/actions/runs/45316426714).

## Acceptance boundaries

Repository checks are not production or staging acceptance. Keep the competition demo synthetic and isolated. Record the exact commit, environment, run, date, expected outcome and observed outcome for each gate. Do not use production as a fixture.

- Infrastructure: require the six CI checks on main, prohibit force pushes and restrict release, backup and staging environments. Owner configuration remains pending.
- Authorization: confirm three distinct verified staging accounts across two organizations, positive and negative RPC and table controls, role revocation, session refresh and sign-out. Explicit denial is required; transport errors are inconclusive.
- Concurrency: run two authenticated clients against the same disposable last seat, replay a lost response with the same operation ID, verify one seat and one ledger entry per operation, then test stale and revoked offline queues.
- Recovery: reconcile the live migration ledger with repository migrations before any rollout. Verify an encrypted archive in disposable local Postgres, compare row counts and business invariants, reapply and check grants, measure restore duration and recovery point. Never claim ACL restoration from a no-ACL dump.
- Delivery: configure the scheduler credential, verify real in-app and push delivery to the intended recipient only, test expired subscriptions and retries. Email and SMS are deliberately unsupported.
- Desktop: follow [release checklist](RELEASE-CHECKLIST.md); collect signed draft installers, checksums, fresh installations and signed updater evidence on the supported operating systems.
- Human validation: at least three unfamiliar participants, completion time, errors, assistance, keyboard and screen-reader evidence, consent and data minimization. Do not invent results.

## Security changes and remaining warnings

The migration makes absent staff membership false rather than SQL NULL, binds device records to their original account and organization, prevents active push endpoint takeover, and limits global job diagnostic exposure. Existing staff and volunteer flows must remain available. The preference read uses caller RLS rather than elevated access.

Intentional privileged command functions still require individual security review and real authorization tests. Never suppress the advisory by moving an equivalent privileged operation behind an unreviewed wrapper. Leaked-password protection is a separate Auth setting, subject to project plan and owner approval.

## References

- [OWASP object-level authorization testing](https://wstg.owasp.org/latest/4-Web_Application_Security_Testing/12-API_Testing/02-API_Broken_Object_Level_Authorization/)
- [Supabase row level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [PostgreSQL restore reference](https://www.postgresql.org/docs/current/app-pgrestore.html)
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)

All live acceptance gates remain pending until actual evidence is collected.
