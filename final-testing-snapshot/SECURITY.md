# Security policy

CivicFlow handles volunteer records, availability, attendance and account information. Please treat those records as private even when testing a suspected vulnerability.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting feature if it is enabled for this repository. Otherwise, contact a maintainer privately and ask for a secure way to send the report. The maintainers are Praket Gauri, Samanyu Mergu and Yash Vepuri.

Include the affected version or commit, the relevant platform, steps to reproduce, and the potential impact. Use fictional accounts and redact tokens, email addresses and personal records. Do not open a public issue containing an active exploit or private data.

We will review reports, agree on a disclosure plan where possible, and publish fixes and advisories as appropriate. No specific response-time guarantee is currently offered.

## Deployment responsibilities

- Use publishable Supabase keys in clients and keep privileged credentials on the server.
- Restrict organization access through server-side authorization and row-level security.
- Keep signing keys, backup identities and production credentials outside Git.
- Verify backup restoration and hosted account isolation before enrollment.

See [operations](docs/operations.md) for recovery procedures and [deployment](docs/deployment.md) for release requirements.

The current source is under development. The sample workspace is not approved for real volunteer records.
