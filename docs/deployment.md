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

The hosted root is the authenticated PWA. The judging showcase is at `https://civic-flow-demo.vercel.app/judge/`. Its interactive sample redirects to the dedicated `civic-flow-sample-praket7.vercel.app` origin, where hosted credentials are disabled and hosted entrypoints redirect back to the showcase. Keep the sample domain assigned to the same reviewed deployment. Paths alone do not isolate browser storage.

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

Evaluation installers are published separately as prereleases after CI passes. They are intended for testing with fictional records, not production enrollment. The macOS application uses ad-hoc signing; the Windows packages are unsigned.

If the macOS DMG bundler times out while communicating with Finder, build the universal application and package it without Finder automation:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm tauri build --target universal-apple-darwin --bundles app
bash scripts/package-macos-evaluation.sh
```

The script checks the application version, universal architecture and existing code signature before creating and verifying the disk image. It prints the resulting SHA-256 checksum. This does not perform notarization or establish publisher trust.

See [operations](operations.md) for backup and recovery requirements.
