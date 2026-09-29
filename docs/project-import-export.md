# Portable Floe Project import and export

Status: accepted Project v1 specification, implemented by #180.

This document defines the portable content boundary for Floe Note Projects.

The `floe-project` format is intentionally a content/interoperability format,
not an internal storage dump, Workspace backup, or cryptographic restoration
image. A Project is an organization boundary inside a Workspace; importing or
exporting one does not introduce Project-level authorization, keys, or
synchronization.

## 1. Product model

Portable content maps to one Project:

```text
Workspace
├── Project "Notes"
└── Project "Research"
    ├── Note A
    └── Note B

Research.floe.zip
        =
portable copy of Project "Research"
```

There are two import contexts.

### 1.1 Import into an existing Workspace

An existing Workspace can create a new Project from:

```text
New / Import Project
├── Blank Project
├── Import Floe export
└── Import Markdown directory
```

These operations reuse the existing Workspace security and synchronization
boundary. They do not create a new WorkspaceId, WorkspaceKey, Device
authorization set, coordinator object, or pairing context.

### 1.2 Create a Workspace from imported content

First-run onboarding may use imported content as the initial Project of a new
Workspace. Once a Workspace already exists, the Workspace switcher does not
offer import as a Workspace-creation source; portable content is added through
`New / Import Project…` instead.

```text
First-run onboarding
├── Import Floe export
│   └── imported Project
└── Import Markdown directory
    └── imported Project
```

An import-created Workspace is named `Personal` in v1 and contains exactly the
imported Project. It does not also create an empty `Notes` Project.

Creating a Workspace still follows the normal coordinator-backed
CreateWorkspace flow and creates a new WorkspaceId, WorkspaceKey, security root,
and initial authorized-device state.

## 2. Portable Floe export

The v1 Floe export is a ZIP archive named:

```text
<project-name>.floe.zip
```

Example:

```text
Research.floe.zip
├── manifest.json
└── notes/
    ├── Paper ideas.md
    ├── Experiments.md
    └── Experiments (2).md
```

After extraction, every note remains a normal UTF-8 Markdown file which can be
opened without Floe Note.

The `.floe.zip` suffix is descriptive. Import validates archive contents and
`formatVersion`; it does not trust the filename extension.

Deleted/tombstoned Notes are not exported in v1.

## 3. Markdown contents

Each active Note in the exported Project is written as one UTF-8 Markdown file.

The file contains the Note body exactly as Markdown. Floe-specific metadata is
not injected into YAML frontmatter.

For example:

```markdown
# Floe Note

This is an ordinary Markdown document.

- [ ] Implement export
```

Keeping metadata separate means exported Markdown remains unsurprising in
Obsidian, VS Code, Git, and other ordinary tools, and Floe Note does not need to
give YAML frontmatter special semantics in its editor model.

## 4. manifest.json

`manifest.json` stores the Project name and Note metadata.

The v1 logical schema remains:

```ts
type FloeExportManifestV1 = {
  format: "floe-project";
  formatVersion: 1;
  exportedAt: string;
  project: {
    name: string;
  };
  documents: Array<{
    path: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    tags: string[];
  }>;
};
```

The portable archive deliberately does not preserve the source ProjectId.
Import creates a fresh ProjectId and fresh DocumentIds.

Timestamps are RFC 3339 / ISO 8601 UTC strings. Unknown optional fields should
be ignored by v1 importers. An unsupported `formatVersion` must fail explicitly
rather than being guessed.

## 5. File naming

Exported Markdown filenames are derived from Note titles for human usability.

The exporter must:

- trim surrounding whitespace;
- replace path separators and characters invalid on common filesystems;
- map an empty result, `.`, or `..` to `Untitled`;
- resolve collisions deterministically.

Example:

```text
Ideas.md
Ideas (2).md
Ideas (3).md
```

The filename is not the Note identity. Metadata is associated with a file by
the relative `path` recorded in `manifest.json`. Archive paths always use
forward slashes.

## 6. Data included and excluded

A v1 Floe Project export preserves:

- Project name;
- active Note titles;
- Markdown bodies;
- createdAt;
- updatedAt;
- tags.

When attachments are implemented, a later format version may add an
`attachments/` directory and attachment metadata.

The portable format does not contain:

- source ProjectId;
- source WorkspaceId;
- deleted/tombstoned Notes;
- edit-history checkpoints or historical Note versions;
- presentation metadata such as tag colors;
- DeviceId or authorized-device membership;
- Device Vault contents or device private keys;
- WorkspaceKey material or key epochs;
- SecurityState or SecurityTransitions;
- coordinator, presence, or signaling state;
- Loro peer/synchronization history;
- IndexedDB records or schema details.

Imported Notes therefore start with fresh edit history. Tags are preserved as
strings, while tag colors fall back to the normal Workspace default until
chosen again.

## 7. Export consistency and security

Export is a local operation. It requires an unlocked Device Vault and access to
the local Workspace data, but it does not require coordinator availability,
presence, or WebRTC peers.

The exporter captures one local logical snapshot of the selected Project and
then writes the ZIP from that snapshot. Changes arriving after snapshot capture
may be absent.

The v1 portable export is not encrypted by Floe Note. This is deliberate:
portability is the primary goal and extracted Markdown should remain directly
readable. The UI must make clear that the resulting archive contains readable
Note contents.

Encrypted backup is a separate future feature and must not replace the portable
Project export.

## 8. Importing a Floe Project

Import validates the complete archive before mutating persistent Workspace
content.

At minimum it validates:

- `format === "floe-project"`;
- supported `formatVersion`;
- every declared Note path exists exactly once;
- paths are relative and cannot escape the archive root;
- timestamps are valid;
- required values have valid types and bounds;
- referenced files decode as UTF-8.

Import into an existing Workspace produces:

```text
.floe.zip
    |
    v
new ProjectId
new DocumentId for each Note
    |
    +-- Project name
    +-- title
    +-- Markdown body
    +-- createdAt / updatedAt
    +-- tags
```

The imported Project belongs to the existing Workspace and synchronizes through
the normal Workspace manifest and Document synchronization path.

Import does not merge into an existing Project in v1. If validation or commit
fails, a partially imported Project must not remain.

Import into an existing unlocked Workspace is a normal local content mutation
and does not require a coordinator round trip. Creating a brand-new Workspace
from the same archive still requires the normal coordinator-backed Workspace
bootstrap.

## 9. Importing a Markdown directory

Floe Note can create one Project from an ordinary directory of Markdown files.

Example source:

```text
research/
├── inbox.md
├── ideas.md
├── papers/
│   ├── paper-a.md
│   └── paper-b.md
└── .obsidian/
    └── ...
```

v1 recursively imports regular files ending in `.md` or `.markdown`,
case-insensitively. Hidden files/directories and tool-specific directories such
as `.obsidian` and `.git` are ignored.

Directory hierarchy is intentionally discarded. The result is:

```text
Project "research"
├── inbox
├── ideas
├── paper-a
└── paper-b
```

The selected directory name becomes the Project name after normal Project-name
validation. If a usable directory name is unavailable, the fallback name is
`Imported notes`.

The filename without its Markdown extension becomes the Note title. The importer
does not infer a title from the first heading.

File contents are imported as the Markdown body, modulo UTF-8 decoding and
normal newline handling. v1 does not parse YAML frontmatter from raw Markdown
directories; frontmatter remains part of the Note body.

A raw Markdown directory uses:

- a new ProjectId;
- a new DocumentId for each Note;
- `createdAt = import time`;
- `updatedAt = import time`;
- `tags = []`.

Filesystem creation/modification timestamps are not authoritative Floe Note
metadata in v1.

If no importable Markdown files are found, import stops before creating the
Project. Unreadable or invalid UTF-8 Markdown files are reported rather than
silently skipped.

## 10. UI placement

Project import/export belongs with Project organization rather than Workspace
security settings.

The Project surface should expose:

```text
New / Import Project
├── Blank Project
└── Import…
    ├── Import Floe export
    └── Import Markdown directory

Project settings…
└── Export Project
```

Workspace settings remain focused on Workspace/device/security concerns.

The exact menu composition may follow the normal Floe Note UI patterns, but
portable import/export must not suggest that importing a Project creates a new
security domain when it is added to an existing Workspace.

## 11. Non-goals for Project v1

Project v1 does not implement:

- Workspace-wide portable export or cryptographic backup;
- restore with the original WorkspaceId or ProjectId;
- importing/merging into an existing Project;
- round-tripping Loro or edit history;
- preserving device authorization;
- encrypted portable containers;
- frontmatter metadata parsing;
- source folder hierarchy as nested Projects;
- automatic filesystem synchronization;
- conflict resolution between an export and its source Project.

These can be introduced independently if later product requirements justify
them.
