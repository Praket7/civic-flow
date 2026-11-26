# Deployment and releases

CivicFlow has separate native, demonstration and hosted entrypoints. Select the correct target before building.

## Build targets

```sh
pnpm build:web
pnpm tauri build
pnpm build:hosted
```

The first command builds the web assets used by the desktop shell. The native build produces platform-specific packages. The hosted build requires a Supabase URL and a publishable key; it fails when required configuration is absent.

Use [the environment template](../.env.example) as a starting point. Never place a service-role key in a client build or a public repository.

The hosted root is the authenticated PWA. The judging sample at `/judge` uses browser-local fictional data. Host the sample separately from an active customer's production origin because paths alone do not isolate browser storage.

## Production acceptance

Before accepting real volunteer records:

- Apply the reviewed migrations to a staging database and validate organization isolation with separate accounts.
- Exercise invitation, authentication, role changes, revoked membership and notification delivery.
- Configure private backups and complete a disposable restore rehearsal.
- Review the client configuration and confirm that only publishable credentials ship.
- Verify the hosted build, accessibility checks and applicable end-to-end workflows.

## Desktop release

Use [the release workflow](../.github/workflows/release.yml) to build a draft from a version tag after checking that the version agrees across the package, Rust crates and Tauri configuration.

Configure platform signing and updater signing before publication. Verify the installer on a clean supported system, check migration behavior against a disposable prior-version workspace, and review checksums and build provenance. Do not publish the draft until those checks pass.

Unsigned evaluation installers are internal test artifacts, not production releases.

See [operations](operations.md) for backup and recovery requirements.
