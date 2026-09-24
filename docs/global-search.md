# Global Search v1

This document defines the first global-search behavior for Floe Note.

## Scope

Global search searches active notes only. Deleted/tombstoned notes are excluded.

The searchable fields are:

- title;
- tags;
- Markdown body.

Sidebar filtering remains a separate navigation feature and searches title and tags only.

## Query semantics

A query is normalized with Unicode NFKC and locale-insensitive lowercase conversion, then split on whitespace.

Every non-empty term must match somewhere in the note. Terms may match different fields.

Matching is literal substring matching. Fuzzy matching, typo tolerance, stemming,
phrase syntax, boolean syntax, and other advanced query languages are outside v1.

For example, a query such as:

```text
graph algo
```

matches a note when `graph` occurs in one searchable field and `algo` occurs
in the same or another searchable field.

## Ranking

Matching notes are ranked by field priority:

1. title;
2. tags;
3. body.

Within the same relevance class, newer `updatedAt` values rank first.

The implementation may use a small deterministic score derived from the same
field ordering when multiple terms match different fields. It must preserve the
priority title > tags > body and must not introduce fuzzy relevance.

## Results

The global-search surface returns at most 50 results.

Each result shows:

- title;
- one body snippet when a body match exists;
- best-effort highlighting of literal matches.

The snippet is anchored near the first body match and is limited to a compact
one- or two-line preview. The implementation does not need to include every
matching term in the same snippet.

Highlighting is best effort. Search correctness must not depend on preserving a
perfect mapping from NFKC-normalized offsets back to source-text offsets, and
highlighting must not add a material performance cost.

## Empty query

When the query is empty, the global-search surface acts as a recent-note
switcher.

Floe Note keeps both:

- `updatedAt`, the synchronized note modification timestamp already present in
  document metadata;
- `lastOpenedAt`, a device-local UI-history timestamp.

Recent notes are ordered primarily by `lastOpenedAt`, then by `updatedAt`.
Notes with no local open history may still appear after previously opened notes.

`lastOpenedAt` is not synchronized across devices and is not project content.

## UI

Global search opens from:

- a search button next to the Floe Note brand in the upper-left area;
- `Ctrl+K` or `Cmd+K`.

It appears as a Spotlight-style modal. Arrow keys move the active result,
Enter opens it, and Escape closes the modal.

The existing sidebar search remains distinct and filters the sidebar note list
by title and tags only.

## Performance model

v1 uses no persistent full-text index.

After Project unlock, the application builds a disposable in-memory search
cache containing normalized title, tags, and body for each active note. The
cache is derived from authoritative decrypted document state and must never be
required for persistence or synchronization.

The cache is updated incrementally at note/field granularity:

- title change -> rebuild normalized title for that note;
- tag change -> rebuild normalized tags for that note;
- body change -> rebuild normalized body for that note;
- note creation -> add the note;
- note deletion -> remove the note from active search;
- note restoration -> add the note back;
- Project change/unlock -> rebuild the cache.

v1 intentionally does not attempt substring-level incremental Unicode
normalization inside a Markdown body. Re-normalizing the changed note body keeps
the implementation simple and avoids normalization-boundary bookkeeping.

Search itself is a linear scan over the in-memory cache. Snippet generation and
highlight preparation should be limited to the returned result set rather than
performed for every note before ranking.

If real-world measurements later show unacceptable latency at large corpus
sizes, the internal implementation may move to an n-gram/trigram index without
changing the query or UI semantics defined here.

## Security and persistence

The normalized search cache contains plaintext Project content. It is therefore
memory-only and disposable.

Floe Note must not persist a plaintext full-text-search cache to IndexedDB. Any
future persistent search index would need to preserve the encrypted-at-rest
boundary defined by the Project storage architecture.
