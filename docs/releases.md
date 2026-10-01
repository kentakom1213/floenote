# Releases and versioning

Floe Note releases the Web client and coordinator independently. Production
releases are normally created from GitHub Actions. Production TURN issuance is
part of the coordinator runtime; the legacy `apps/turn` Worker is separate
development/self-host infrastructure and is not part of this release workflow.

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

The primary release path is:

1. Open the repository on GitHub.
2. Go to **Actions → Release → Run workflow**.
3. Select the `main` branch.
4. Select the component:
   - `web`
   - `coordinator`
5. Select the version bump:
   - `patch`
   - `minor`
   - `major`
6. Run the workflow.

The workflow refuses to release from any ref other than `main`.

### What the Release workflow does

The `prepare-release` job:

1. verifies that the dispatch ref is `main`
2. checks out the latest `origin/main`
3. installs dependencies with `pnpm install --frozen-lockfile`
4. reuses the existing version helper:
   - Web: `pnpm version:web <bump>`
   - Coordinator: `pnpm version:coordinator <bump>`
5. runs `pnpm test`
6. runs `pnpm typecheck`
7. runs `pnpm build`
8. verifies that only the selected component's `package.json` changed
9. fetches `origin/main` again and fails if main advanced during preparation
10. verifies that the release tag does not already exist
11. creates a release commit with the GitHub Actions bot identity
12. creates the component-specific release tag
13. pushes the main commit and tag together with an atomic Git push

The release commit format is:

- `release web v<version>`
- `release coordinator v<version>`

Tags are:

- Web: `web-v<version>`
- Coordinator: `coordinator-v<version>`

Existing tags are never overwritten or force-updated.

The `deploy` job starts only after `prepare-release` succeeds. It checks out
the exact release commit SHA produced by `prepare-release`, verifies that the
remote tag points to that SHA, installs dependencies, and deploys only the
selected component:

- Web: `pnpm deploy:web`
- Coordinator: `pnpm deploy:coordinator`

This keeps the package version, embedded build SHA, release tag, and deployed
source tied to the same release commit.

## Safety and failure behavior

Release operations are serialized with one `production-release` concurrency
group across both Web and Coordinator. A running release is not cancelled when
another release is requested.

Before the release commit/tag push, any failure leaves `main` unchanged, does
not create a remote release tag, and does not deploy.

If `main` advances while verification is running, the release fails instead
of merging, rebasing, or force-pushing. Run the workflow again from the latest
`main`.

The commit and tag are pushed atomically. If either ref cannot be updated, the
push fails rather than intentionally leaving a release commit without its tag
or a tag without its release commit.

If the release commit/tag push succeeds but production deployment fails, the
release commit and tag remain valid. Do not bump the version again just to
retry deployment. Retry the failed `deploy` job from the same workflow run so
it deploys the same release SHA.

The Release workflow performs its own install, test, typecheck, and build before
pushing the release. Correctness does not depend on the release commit push
starting `ci.yml`; pushes made with the built-in `GITHUB_TOKEN` should not be
treated as a mechanism for recursively triggering the verification workflow.

## GitHub Environment and Cloudflare credentials

The production deploy job uses the GitHub Environment named `production`.

Before the first release, configure the repository:

1. Go to **Settings → Environments**.
2. Create or open **production**.
3. Add these Environment secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

The values are Cloudflare deployment credentials used by Wrangler. Do not put
their values in the repository, workflow YAML, logs, or artifacts.

The Cloudflare deployment credentials are unrelated to the coordinator's TURN
runtime secrets `TURN_ENABLED`, `TURN_KEY_ID`, and `TURN_KEY_API_TOKEN`. Configure
these on the production coordinator Worker, independently of any staging key.
They are not passed through the Release workflow or web build. See
`docs/turn.md`. `TURN_ACCESS_TOKEN` belongs only to the legacy `apps/turn`
development/self-host Worker.

The `prepare-release` job uses the built-in `GITHUB_TOKEN` with only
`contents: write` so it can update `main` and create the tag. The deploy job
has only `contents: read`; Cloudflare secrets are referenced only by its
deployment steps.

If repository branch protection or a ruleset prevents the built-in
`GITHUB_TOKEN` from updating `main`, adjust the repository policy so the
intended Release workflow can perform this release commit. Do not add a
Personal Access Token merely to bypass that policy.

Environment reviewer approval, if desired, is configured in the
`production` Environment settings. The workflow itself does not add a second
confirmation prompt.

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
- create release PRs
- automatically release or deploy the TURN Worker
- bump, tag, or version TURN

TURN remains manually deployable through the existing `pnpm deploy:turn`
command when needed.
