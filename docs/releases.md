# Releases and versioning

Floe Note releases the Web client and coordinator independently.

## Version policy

The release versions are stored in:

- Web: `apps/web/package.json`
- Coordinator: `apps/coordinator/package.json`

Both components use SemVer independently. Internal workspace packages are not
versioned for release and are not published to npm.

The intended bump rules are:

- `patch`: bug fixes, small polish, and behavior-preserving fixes;
- `minor`: new features and backward-compatible protocol or UI capabilities;
- `major`: breaking changes once a component moves to v1.

During the 0.x series, use the same categories consistently even though strict
SemVer treats 0.x compatibility differently.

A development build does not require a version bump. Its release version may
stay unchanged while the embedded Git build identifier changes.

A production release must explicitly bump the component being deployed.

## Bumping a component

Start from a clean working tree. The bump helper intentionally refuses to run
when tracked or untracked changes are present.

```sh
pnpm version:web patch
pnpm version:web minor
pnpm version:web major

pnpm version:coordinator patch
pnpm version:coordinator minor
pnpm version:coordinator major
```

The command updates only the selected component's `package.json`. The pnpm
lockfile does not record workspace package versions here, so a version-only
bump does not require a lockfile change.

The helper validates the component, bump kind, current plain SemVer version,
and clean Git working tree. It does not commit, tag, push, deploy, or publish.

## Tags

Tags are component-specific and must exactly match the version in the
corresponding `package.json`:

- Web: `web-v<version>`, for example `web-v0.1.0`
- Coordinator: `coordinator-v<version>`, for example
  `coordinator-v0.1.0`

Do not reuse a tag for another commit or component.

## Release workflow

Release only from the latest `main`, or from a short-lived release branch
created from it.

1. Update local `main` and confirm the working tree is clean.
2. Bump only the component being released.
3. Run tests, typecheck, and build.
4. Commit the version bump.
5. Ensure the release commit is on `main` (merge a release PR first when
   branch protection requires it).
6. Tag that exact `main` commit with the component-specific tag.
7. Push the tag.
8. Deploy only that component.
9. Verify the running version and build identifier in Floe Note. For the
   coordinator, also verify `/health`.

Example Web patch release from a repository where direct release commits to
`main` are allowed:

```sh
git switch main
git pull --ff-only
git status --short

pnpm version:web patch
pnpm test
pnpm typecheck
pnpm build

WEB_VERSION=$(node -p "require('./apps/web/package.json').version")
git add apps/web/package.json
git commit -m "Release web v$WEB_VERSION"
git tag "web-v$WEB_VERSION"
git push origin main
git push origin "web-v$WEB_VERSION"

pnpm deploy:web
```

Example coordinator minor release:

```sh
git switch main
git pull --ff-only
git status --short

pnpm version:coordinator minor
pnpm test
pnpm typecheck
pnpm build

COORDINATOR_VERSION=$(node -p "require('./apps/coordinator/package.json').version")
git add apps/coordinator/package.json
git commit -m "Release coordinator v$COORDINATOR_VERSION"
git tag "coordinator-v$COORDINATOR_VERSION"
git push origin main
git push origin "coordinator-v$COORDINATOR_VERSION"

pnpm deploy:coordinator
```

If `main` requires pull requests, perform the bump and verification on a
release branch, merge that release-only PR, then update local `main` and tag
the merged commit. The tag must point to the exact commit whose component
version is deployed.

The existing build observability remains the final release check: the Web
Settings technical details show Web and coordinator release versions and Git
build identifiers, while the coordinator `/health` endpoint reports its own
`version` and `build`.
