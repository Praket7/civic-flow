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

The migration makes absent staff membership false rather than SQL NULL, scopes each device record by installation, account and organization, prevents active push endpoint takeover, and limits global job diagnostic exposure. Existing staff and volunteer flows must remain available. Preference and delivery-health reads use caller RLS rather than elevated access. Operation replay is scoped to its actor and tenant; rejected operations remain rejected on replay. Abandoned delivery claims recover after a bounded lease; stale completions cannot finalize a newer attempt. Push delivery is at-least-once at the external provider, not exactly-once.

Intentional privileged command functions still require individual security review and real authorization tests. Never suppress the advisory by moving an equivalent privileged operation behind an unreviewed wrapper. Leaked-password protection is a separate Auth setting, subject to project plan and owner approval.

## References

- [OWASP object-level authorization testing](https://wstg.owasp.org/latest/4-Web_Application_Security_Testing/12-API_Testing/02-API_Broken_Object_Level_Authorization/)
- [Supabase row level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [PostgreSQL restore reference](https://www.postgresql.org/docs/current/app-pgrestore.html)
- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)

All live acceptance gates remain pending until actual evidence is collected.

## Reproducible staging race

The manual `hosted-capacity-acceptance.yml` workflow uses two independently authenticated volunteers and a coordinator. Configure the staging project reference, organization ID, a future empty one-seat shift, and the second volunteer credentials in the protected staging environment. A reviewer must explicitly enable the disposable-fixture input. The test claims the same seat concurrently, checks one confirmation and one waitlist entry, replays both operation IDs, and checks that cleanup returns the fixture to empty capacity. Audit history is retained as synthetic staging evidence; never point this workflow at a real organization.

The public VAPID key is now an invoker read over a column-restricted view; private signing material remains inaccessible. This changes the warning posture only after the migration is deployed and rescanned.

## Scheduler rollout and release gate

The scheduler now sends a dedicated high-entropy dispatch token, not a database-wide service-role credential. Use a random 32-byte or longer token, stored privately in the Edge Function secret `CIVICFLOW_REMINDER_SCHEDULER_TOKEN` and the same-named GitHub environment secret. The protected `reminder-production` environment also needs `CIVICFLOW_REMINDER_GATEWAY_ANON_JWT`, the legacy public anon JWT needed by the existing gateway verification mode. Do not substitute a service-role JWT. First configure and validate the same arrangement in staging; deploy the SQL migrations before the updated Edge Function, then enable the updated scheduler. Check both unauthorized and authorized requests, in-app and push recipient delivery, and operator-visible status. Keep the former deployment available for rollback until verified. See [Edge Function authorization headers](https://supabase.com/docs/guides/functions/auth-headers).

The release workflow checks that the draft is unpublished and contains platform installers, an updater manifest matching the release tag, and matching signature files for its platform assets. This structural check does not cryptographically verify OS signing or replace a real updater round trip. The signing environment must be protected and correctly configured before a tag is cut.

## Human acceptance protocol

Recruit at least three unfamiliar consenting participants. Use only synthetic organization and identity data. Each participant completes the volunteer registration, coordinator schedule and capacity change, AutoRoster explanation and report export tasks without coaching. Record anonymous participant code, task, completion, elapsed seconds, errors, assistance and observations. Record keyboard-only navigation and actual screen-reader output for at least one full journey; investigate every blocking defect and repeat the task after correction. Keep raw participant notes private, retain only aggregate results and delete recordings when no longer required. Never enter participant identities or contact information into the public judging demo.

Stage 7 is accepted only when all engineering checks and real staging, recovery, release and human evidence are attached to the exact candidate commit. Missing evidence is pending, not passed.

## Migration drift and owner-controlled operations

The production migration ledger was read on November 24, 2026 UTC. It contained seven versions, including the two November 22 hardening migrations. Historical reminder foundation, generation, dispatch, waitlist and bootstrap versions have timestamps different from their repository counterparts; several repository migrations have no direct timestamp match. This is drift, not evidence that historical DDL is absent. Compare normalized schema, routine bodies, privileges, constraints, triggers and data invariants in an isolated restored copy before deciding which historical versions are equivalent. Do not blindly replay or mark migrations applied in production. Require an encrypted recovery snapshot and an approved ordered migration and rollback plan before any production change.

Owner operations still required: protect main against direct changes, deletion and force pushes; require the six named CI checks and up-to-date pull requests; configure staging, release-signing, backup-production and reminder-production environments. Unattended reminder dispatch must not have an approval rule that blocks every scheduled run. Restrict the environment to main and grant only its narrow scheduler credential. A manually approved staging/backup/release environment has different requirements. Confirm actual configuration with screenshots or API evidence.
