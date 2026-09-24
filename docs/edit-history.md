# Edit history

Status: v1 specification.

This document defines the user-facing edit-history model for Floe Note. Edit
history is distinct from editor Undo/Redo. Undo/Redo remains an ephemeral local
editing facility backed by Loro `UndoManager`; edit history is shared Project
data that exposes selected historical document states across devices.

## 1. Goals

Edit history should let a user:

- view a chronological list of meaningful historical versions of one note;
- preview a historical note state without changing the current document;
- restore a historical state as a new current edit;
- see the same history on every authorized device after synchronization.

The UI must not expose Loro operations, peer IDs, branches, or other CRDT
implementation details.

## 2. Version model

A Floe Note version is a Project-level checkpoint that bookmarks one Document
Loro history position.

The checkpoint does not contain a copy of the Markdown body. Instead, it stores
the Loro `Frontiers` for the target Document. The Document's Loro history is
the source of truth used to reconstruct the historical state.

Conceptually:

```text
Document LoroDoc
  history: ... -> F1 -> ... -> F2 -> ... -> current

Project manifest
  checkpoints
    checkpoint A -> F1
    checkpoint B -> F2
```

A checkpoint has the minimal logical schema:

```ts
type EditHistoryCheckpoint = {
  id: CheckpointId;
  documentId: DocumentId;
  frontiers: Uint8Array;
  createdAt: number;
  restoreSourceCheckpointId: CheckpointId | null;
};
```

`frontiers` is the encoded Loro `Frontiers` value. `createdAt` is display
metadata only and is never used for CRDT conflict resolution.

Checkpoint records are immutable after creation.

## 3. Storage and synchronization

Checkpoint metadata is collaborative Project data and is stored in the Project
manifest, separate from each note's `LoroDoc`.

The manifest contains a map keyed by `CheckpointId`:

```text
Manifest
├── documents
├── purgedDocuments
├── metadata
├── deviceDisplayNames
└── editHistoryCheckpoints
    ├── CheckpointId -> checkpoint record
    └── ...
```

A map is used rather than an ordered list because checkpoint identity is the
collaborative fact. UI ordering is derived from `createdAt`.

Keeping history metadata in the manifest has three consequences:

- checkpoint records use the existing encrypted Project-manifest persistence;
- checkpoint records use the existing manifest P2P synchronization path;
- no edit-history-specific network protocol or IndexedDB table is required.

The checkpoint metadata must not be stored inside the target Document
`LoroDoc`. Recording a checkpoint there would itself advance the Document
history being bookmarked.

## 4. Automatic checkpoints

v1 creates an automatic checkpoint after local user editing when any of these
conditions is met:

- editing has been idle for 2 minutes;
- continuous editing reaches 10 minutes since the last checkpoint;
- the user leaves the note.

Only local edits start checkpoint timers. Receiving a remote P2P update alone
must not create a checkpoint on the receiving device.

Checkpoint creation is a no-op if the current Document `Frontiers` are already
represented by an existing checkpoint for that Document.

Automatic checkpoint creation is silent. It does not show a save toast or
otherwise imply that ordinary note persistence depends on edit history.

v1 does not implement manual checkpoint names, pinned versions, or retention.

## 5. Ordering and concurrency

The history list is ordered by `createdAt`, newest first.

Concurrent offline devices may independently create checkpoints. After the
Project manifest converges, both checkpoints are retained and appear in the
same timestamp-ordered list.

The UI does not expose a branch graph or attempt to present timestamp order as a
causal history. Loro remains responsible for the underlying causal DAG.

## 6. Historical preview

Selecting a checkpoint opens a read-only historical preview.

The live current Document remains attached and continues to receive local and
remote synchronization updates while history is being viewed. Historical
preview must therefore use an independent historical view, such as
`LoroDoc.forkAt(frontiers)`, rather than calling `checkout()` on the live
editor Document.

The preview shows the historical:

- title;
- tags;
- Markdown body.

Document identity, Project membership, Trash state, and other lifecycle state
are not part of the historical content snapshot.

v1 does not include a diff view. A later version may derive diffs from two Loro
history positions without changing the checkpoint model.

## 7. Restore semantics

Restore never rewinds or truncates the Loro history.

Restoring a checkpoint means applying the selected historical content to the
current Document as a new local edit:

```text
historical checkpoint
        |
        v
historical title / tags / body
        |
        v
current Document
        |
        v
new Loro operations
```

The restored fields are:

- title;
- tags;
- Markdown body.

The following are not restored:

- DocumentId;
- createdAt;
- Project membership;
- Trash/purge state.

`updatedAt` follows the normal current-edit behavior.

The restore is grouped as one user action so ordinary editor Undo can restore
the pre-restore current state.

After restore, an edit-history checkpoint is created immediately. Its
`restoreSourceCheckpointId` identifies the selected source checkpoint.

Peers receive the restore through the ordinary encrypted Document update path.
There is no special network-level restore command.

A restore applies to the state currently known by the restoring device. A later
merge with previously unseen concurrent offline edits may therefore produce a
state that is not byte-for-byte equal to the selected historical version. This
is expected CRDT behavior.

## 8. UI

The v1 UI exposes edit history from the note actions menu.

Opening History shows:

- `Current` at the top;
- checkpoint timestamps, newest first;
- a read-only historical preview for the selected checkpoint;
- `Back to current`;
- `Restore this version`.

While viewing a historical checkpoint, the interface must clearly indicate that
the content is read-only historical state rather than the current editor.

Before restore, the UI explains that the current state remains available in edit
history. After restore, the UI returns to the current editor.

No diff view, branch visualization, device attribution, version naming, or
manual checkpoint UI is part of v1.

## 9. Trash and purge

Moving a note to Trash preserves its checkpoints.

A trashed note is not restored to an old edit-history version directly. The note
must first be restored from Trash to the active document set.

Permanent purge is terminal. Purging a Document removes its checkpoint metadata
and prevents historical recovery through edit history. A stale checkpoint update
must not make a purged Document recoverable.

## 10. Retention and Loro history pruning

v1 has no checkpoint retention policy and does not prune Loro document history.

This deliberately keeps user-facing checkpoint lifetime aligned with the Loro
history required to reconstruct it, without introducing coordinated history GC
for offline devices.

Retention, sparse history, shallow snapshots, and long-term history
materialization are future concerns and must be designed together if introduced.

## 11. Import and export

Portable `.floe.zip` export remains a current-content portability format in v1.

Edit-history checkpoints and Loro synchronization history are not exported.
Import creates fresh Project and Document identities and starts with no edit
history.

## 12. Encryption boundary

Edit-history metadata is Project data. Because checkpoint records live in the
Project manifest, they use the existing ProjectKey encryption boundary for local
persistence and the existing application-layer encrypted synchronization path.

No plaintext edit-history store is introduced.
