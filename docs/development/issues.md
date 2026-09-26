# Issue Protocol

GitHub Issues are the source of truth for accepted backlog items and stable product or design decisions.

Exploration may happen elsewhere, but once scope is agreed, record the durable result in an Issue.

## Scope

Issues describe what should be achieved and the agreed boundaries. Avoid pinning implementation details that are likely to become stale.

Use these sections when applicable:

### Problem

Why this work is needed.

### Goal

What should become possible when the Issue is complete.

### Decisions

Stable product or architectural decisions already made.

### Acceptance criteria

Observable conditions for considering the Issue complete.

### Out of scope

Things deliberately excluded from this Issue.

### Dependencies

Add only when another Issue or prerequisite materially blocks the work.

Avoid recording transient implementation details such as exact file names, function names, branch names, current commit SHAs, or step-by-step coding instructions. Those belong in the implementation plan or pull request.

## Labels

Keep labels minimal.

Each Issue normally has exactly one type label:

- `type: feature` — user-facing functionality
- `type: bug` — behavior that differs from intended behavior
- `type: design` — specification or design work that should be resolved before implementation
- `type: tech-debt` — acceptable implementation debt that should be revisited
- `type: maintenance` — repository, CI, dependency, documentation, cleanup, or operational work

An Issue may additionally have zero to two area labels:

- `area: ui`
- `area: sync`
- `area: security`
- `area: coordinator`
- `area: storage`
- `area: testing`

Do not add priority, size, or workflow-state labels unless the project later has a concrete need for them. GitHub's open/closed state and the Issue body are sufficient for now.

## Lifecycle

```text
discussion
→ scope decision
→ Issue
→ implementation
→ pull request
→ review
→ merge / close
```

Implementation should start from the Issue plus the current repository state, not from stale implementation details in the Issue.

Review findings that are outside the current pull request scope should become separate Issues when they are worth preserving.
