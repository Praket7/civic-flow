# Phase 1 — Database permissions and operational security

## Threat model

An untrusted client can obtain an anonymous key, sign in as a volunteer, and
invoke PostgREST functions directly. The client can choose arbitrary RPC
arguments. It must not be able to claim coordinator privileges or read another
organization's records or change-log metadata.

The database must enforce these rules even when someone bypasses the React UI.

## Findings addressed by 20261122000000_harden_rpc_permissions.sql

**1. Direct internal command execution (high severity).**
The existing RLS migration granted EXECUTE on every `private` function to
authenticated users. PostgreSQL also grants EXECUTE on newly created functions
to PUBLIC by default; the `sync.cmd_*` and `sync.dispatch` functions did not
have a blanket revocation. Their `p_role` and `p_actor` parameters are trusted
only because the intended `public.apply_command` entry point derives them
from active membership. Granting direct calls bypasses that entry point.

**Resolution:** revoke EXECUTE on internal functions for PUBLIC, anon, and
authenticated, and allowlist only RLS helpers and the invoker-mode row
resolver required by `pull_changes`.

**2. Cross-organization change-log metadata (high severity).**
The old migration granted authenticated users SELECT on `sync.sync_changes`
without an RLS policy on that table. That exposes organization IDs, record
IDs, actor IDs, and operation metadata to authenticated clients.

**Resolution:** enable RLS on the sync change log and limit SELECT to users
with active membership in that organization.

**3. Service RPC exposure (defense in depth).**
Server-only reminder and VAPID functions previously had EXECUTE grants for
anonymous and authenticated clients, relying on internal service-role checks.

**Resolution:** restrict EXECUTE to the trusted service role. Preserve the
public VAPID-key read and the authenticated application RPC allowlist.

## Required verification

Run `pnpm test:sql`. It applies all migrations in filename order and now
checks internal RPC privileges, cross-organization log isolation, revoked
members, server-only grants, and valid coordinator commands.

Other SQL suites test unauthorized reads and writes, offline operation
protocols, enrollment, waitlists, reminders, and synchronization.

Before production deployment, test the migration against a **backup or
staging clone** with the same Supabase role ownership and PostgREST setup.
Verify an actual sign-in, bootstrap, change pull, role registration, and
service-key reminder dispatch. PGlite does not replicate every managed
Supabase service or live-concurrency condition.

## Residual review work

- Audit row-level policies on every shared application and sync table.
- Test concurrent claims to a final seat under separate transactions.
- Validate database backups, restore, migration rollback, and key rotation.
- Review idempotency-ledger growth and log retention policy.
- Run adversarial role-swap and token-revocation scenarios against real Supabase.
- Confirm which API schemas are exposed through PostgREST (internal schemas
  should not be in its exposed-schema configuration).
- Review future migrations so new application functions are not implicitly
  exposed to PUBLIC; function ownership can affect default privileges.

This migration changes permissions, not table columns or stored records.
It should not require data backfilling. It is intentionally **not**
automatically rolled back if validation fails, since restoring broad EXECUTE
access would reopen the original security issue.
