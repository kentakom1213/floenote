# Floe Note agent instructions

## Development principles

- Prefer simple, natural implementations over speculative abstractions.
- Follow YAGNI. Do not add future-facing infrastructure unless the assigned Issue requires it.
- Preserve existing architecture and security invariants unless the assigned Issue explicitly changes them.
- Keep unrelated refactors out of the assigned work.
- Do not silently make non-obvious product, architecture, security, storage, protocol, deployment, import/export, or UI decisions. Stop and report the decision instead.

## Source of truth

- GitHub Issues contain accepted scope and stable design decisions.
- Read the assigned Issue and its parent before implementation.
- Read `docs/architecture.md` for the current architecture.
- Follow `docs/development/issues.md` for Issue conventions.
- Prefer the current repository state over stale implementation details from earlier discussions.

## Validation

Before considering implementation complete, run:

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

Run browser E2E when the change affects browser integration, routing, persistence, pairing, or another covered end-to-end flow.

Fix failures locally before relying on GitHub Actions. Treat GitHub Actions as the final clean-environment verification rather than the primary debugging loop.

## Git and pull requests

- Do not merge pull requests yourself.
- Do not force-push or rewrite existing branch history unless explicitly requested.
- Keep the working branch buildable and testable.
- Use Issues for durable scope and decisions, and pull requests for implementation details and validation results.

## Scope discipline

If completing the assigned Issue appears to require work owned by another Issue:

1. distinguish mechanical compatibility changes from semantic changes;
2. make mechanical changes only when needed to keep the repository buildable;
3. stop before making unrelated semantic changes;
4. report the dependency or design conflict.
