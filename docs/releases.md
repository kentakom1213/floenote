# Releases and versioning

Floe Note releases the Web client and coordinator independently. Production
releases are normally created from GitHub Actions. Production TURN issuance is
part of the coordinator runtime; the legacy `apps/turn` Worker is separate
development infrastructure and is not part of this release workflow.

## Version policy

The release versions are stored in:

- Web: `apps/web/package.json`
- Coordinator: `apps/coordinator/package.json`

Both components use independent SemVer. Internal workspace packages are not
versioned for release and are not published to npm.

Use these bump categories consistently:

- `patch`: bug fixes, small polish, and behavior-preserving fixes
- `minor`: new features and backward-compatible protocol or UI capabilities
- `major`: breaking changes once a component moves to v1

During the 0.x series, keep using the same categories even though strict SemVer
treats 0.x compatibility differently.

Development builds do not require a version bump. The release version may stay
unchanged while the embedded Git build identifier changes. A production
release always bumps the component being deployed.

## Production release with GitHub Actions

Production releases are prepared through a pull request; preparing a release
never commits directly to `main` or deploys a new version.

1. Open **Actions → Prepare Release → Run workflow**.
2. Select the `main` branch, the component (`web` or `coordinator`), and
   the version bump (`patch`, `minor`, or `major`).
3. The workflow verifies the release and creates a PR from
   `release/<component>-v<version>` into `main`.
4. Review and merge the release PR once its normal checks pass.
5. Merging that PR triggers **Deploy Release**, which verifies the merged
   release commit, publishes the corresponding Git tag, and deploys that
   exact commit to production.

Both workflows reject unsupported release refs and unexpected changes.

### Prepare Release

`.github/workflows/prepare-release.yml` requires dispatch from `main` and
pins the current `main` SHA. It:

1. installs dependencies with `pnpm install --frozen-lockfile`;
2. uses `pnpm version:web <bump>` or `pnpm version:coordinator <bump>`;
3. runs `pnpm test`, `pnpm typecheck`, and `pnpm build`;
4. ensures that the only changed file is the selected component's
   `package.json` and that `main` has not advanced;
5. rejects an already-existing release tag;
6. creates (or reuses a matching) `release/<component>-v<version>` branch
   and opens the release PR.

The release commit changes only the selected component's version. It uses
the message `release web v<version>` or
`release coordinator v<version>`.

### Deploy Release

`.github/workflows/deploy-release.yml` starts on a merged PR into `main`
whose source branch matches `release/<component>-v<version>` and belongs
to this repository. It:

1. verifies that the release PR changed exactly the selected component's
   `package.json`, and that the merged version is an allowed next SemVer
   bump from the first parent;
2. checks out the merged commit SHA and runs install, tests, typecheck, and
   build;
3. creates and pushes the matching release tag pointing at that merged SHA;
4. checks out and verifies that same SHA and tag before deploying the selected
   component under the `production` Environment.

Tags are `web-v<version>` and `coordinator-v<version>`. Existing tags
are not overwritten or force-updated.

Deployment is component-specific:

- Web: `pnpm deploy:web`
- Coordinator: `pnpm deploy:coordinator`

This ties the package version, tag, and production deployment to the same
merged release commit.

## Safety and failure behavior

Preparing a release does not change `main`, create a tag, or deploy. If
`main` advances during preparation, the workflow refuses to create an
out-of-date release PR; rerun it from the latest `main`. A release PR must
pass normal review and CI checks before it can be merged.

Deploy Release uses a shared `production-release` concurrency group without
cancelling a running release. A merged release PR remains on `main` even if
subsequent verification or deployment fails. If tag publication succeeds but
deployment fails, retry the failed deployment job from the same run so the
original release SHA is deployed; do not bump the version just for a retry.
If verification fails before tag publication, no release tag or deployment
is produced.

The deploy workflow verifies the merged commit independently rather than
relying on a second CI run triggered by GitHub Actions' built-in
`GITHUB_TOKEN`.

## GitHub Environment and Cloudflare credentials

The production deploy job uses the GitHub Environment named `production`.
Configure **Settings → Environments → production** with:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

They are Wrangler deployment credentials. Never put their values in source,
workflow YAML, logs, or artifacts.

Production TURN settings `TURN_ENABLED`, `TURN_KEY_ID`, and
`TURN_KEY_API_TOKEN` are independent coordinator Worker runtime secrets,
not GitHub release secrets or web-build settings; see [turn.md](./turn.md).
`TURN_ACCESS_TOKEN` belongs only to the legacy `apps/turn` development
Worker.

The preparation workflow requests `contents: write` and
`pull-requests: write` only for the release PR creation job; it does not
require pushing commits directly to `main`. Deploy Release requests
`contents: write` only to publish the tag; deployment reads
Cloudflare credentials from the `production` Environment. Configure
Environment reviewer approval in GitHub if desired.

## Verification after deployment

After the workflow succeeds:

- confirm the Web / Coordinator version and build identifier in Floe Note's
  technical details
- for Coordinator releases, also confirm the production `/health` response

The build identifier should correspond to the release commit deployed by the
workflow.

## Developer version helper

The existing helpers remain available for local development or manual recovery:

```sh
pnpm version:web patch
pnpm version:web minor
pnpm version:web major

pnpm version:coordinator patch
pnpm version:coordinator minor
pnpm version:coordinator major
```

They update only the selected component's `package.json` and require a clean
working tree. They do not commit, tag, push, deploy, or publish.

A package version change does not currently require a pnpm lockfile update
because the workspace lockfile does not record these app package versions.

## Scope

The Release workflow intentionally does not:

- create GitHub Release objects or release assets
- generate release notes or a changelog
- publish packages to npm
- version internal workspace packages
- commit a release directly to `main` during preparation
- automatically release or deploy the TURN Worker
- bump, tag, or version TURN

TURN remains manually deployable through the existing `pnpm deploy:turn`
command when needed.
