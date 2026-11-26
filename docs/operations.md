# Operations

## Backup and restore

The [cloud backup script](../scripts/backup-cloud.sh) streams a PostgreSQL dump through age encryption to a private S3 bucket. Configure its GitHub environment with restricted reviewers and a least-privilege OIDC role. Keep the age private identity outside the repository.

The [backup workflow](../.github/workflows/backup-cloud.yml) requires the database URL, age recipient, S3 destination and OIDC role configuration. Do not print those values in logs.

Use [the restore script](../scripts/verify-cloud-restore.sh) with an explicitly authorized disposable local PostgreSQL database. Never rehearse restoration over the production database.

```mermaid
flowchart LR
    A[("Production database")] --> B["Encrypted dump"]
    B --> C[("Private backup bucket")]
    C --> D["Disposable local restore"]
    D --> E["Verify records and access"]
    E --> F["Record rehearsal result"]
```

A successful upload does not prove that the backup is restorable. Record the backup date, restore date, source revision, validation result and any discrepancies. Verify authentication and organization membership separately.

## Incident handling

If a credential is exposed, revoke or rotate it promptly and review its use. If organization isolation fails, suspend the affected access path and preserve relevant logs without exporting unnecessary personal data. Use the [security policy](../SECURITY.md) to coordinate disclosure.

## Hosted verification

Run the [hosted authentication smoke workflow](../.github/workflows/hosted-auth-smoke.yml) with authorized staging accounts in separate organizations. Keep test credentials in the protected staging environment.

Synthetic SQL tests are useful regression checks, but they do not replace live staging acceptance. Record actual results before approving enrollment.
