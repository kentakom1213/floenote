# Portable Workspace import and export

Status: v1 specification.

Workspace export is a collection of portable Project exports, not a storage
dump, encrypted backup, or cryptographic identity restoration. It preserves
active content in a form readable without Floe Note. See
[project-import-export.md](./project-import-export.md) for the Project format.

## Format

A Workspace export is a single unencrypted stored (ZIP method 0) archive
named `<sanitized-workspace-name>.floe-workspace.zip`, without a date suffix.

```text
Personal.floe-workspace.zip
├── manifest.json
└── projects/
    ├── Research/
    │   ├── manifest.json
    │   └── notes/Paper.md
    └── Personal/
        ├── manifest.json
        └── notes/Diary.md
```

The root manifest is UTF-8 JSON:

```json
{
  "format": "floe-workspace",
  "formatVersion": 1,
  "exportedAt": "2026-11-27T06:00:00.000Z",
  "workspace": { "name": "Personal" },
  "projects": [
    { "path": "projects/Research" },
    { "path": "projects/Personal" }
  ]
}
```

Each declared directory contains the ordinary, unpacked Project v1 format;
there are no nested ZIPs. Paths are relative to the Workspace archive root;
inner Project document paths are relative to that Project directory.
Project names are stored in their own manifests, not inferred from paths.
Sanitize directory stems as for Project export, resolving collisions with
numbered suffixes, including case-insensitive and Unicode-normalized name
collisions. Use a stable entry order and the same UTC export instant
for all manifests. ZIP entry timestamps are fixed by the existing encoder.
An empty projects array is valid. Empty active Projects are included.

## Content boundary

Preserve the Workspace name, active Project names and membership, active
Note titles and Markdown bodies, Note creation/update timestamps and tags.
Exclude archived Projects, deleted/purged Notes, tag color overrides,
Project creation timestamps, history, CRDT state, device identities, keys,
authorization, coordinator state, and local UI preferences.

Export captures the current unlocked local Workspace synchronously, without
coordinator availability or connected peers. Reject export if an active Note
declared in the manifest is unavailable locally or lacks required metadata
or valid active Project membership. Remote edits not yet received are not
guaranteed to be included. Do not silently export an incomplete known set.

## Import

Accept either a stored ZIP or a selected directory containing the same
manifest and Project trees. Validate the entire input before creating
persistent state: format/version, paths, duplicate entries/references,
required files, UTF-8, timestamps and existing Project format rules.
A directory import treats the selected directory as the archive root.
Do not infer Projects from unreferenced files.

Create a fresh Workspace using normal coordinator-backed genesis and an
unlocked Device Vault. Recreate Projects and Notes with new identities,
preserving portable content and no additional default Project. A Workspace
with no active Projects is valid. Existing Workspaces are never overwritten
or merged; duplicate Workspace names are allowed. The importing device is
the initial authorized device; pair others normally. Validate and construct
all content before committing genesis and persist atomically through the
existing local initialization flow. Coordinator or storage errors follow
the existing genesis error handling; no partial local import is exposed.

## UI

Workspace Settings offers Export Workspace with a persistent warning that
the archive is unencrypted and excludes archived Projects, deleted Notes
and edit history. No coordinator availability gate is needed.

Workspace switcher offers New / Import Workspace… with Blank Workspace,
Join Workspace and Import Workspace choices. First-run onboarding also
offers Workspace import. Import accepts ZIP or directory, displays the
Workspace name, Project/Note counts and export date for confirmation, and
opens the newly created Workspace after success.

## External backup tools

The fixed filename and uncompressed ZIP allow external tools to manage
generations. Users may extract the ZIP into a fixed staging directory
(replace the old contents, do not merge), then back up that directory with
restic or another backup tool. The root exportedAt records the export time.
Plaintext exports and staging files require appropriate local protection.

## Non-goals

Encryption of exported files, Loro snapshots, automatic/incremental backup,
retention, cloud integration, multi-Workspace export, in-place restoration,
security-state recovery, ZIP64 and streaming ZIP. No new dependencies,
coordinator API, storage schema or sync/security protocol changes.
