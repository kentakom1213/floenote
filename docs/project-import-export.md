# Project import and export

Status: proposed v1 specification.

This document defines the portable data boundary for Floe Note Projects.

The format is intentionally a content/interoperability format, not an internal
storage dump and not a cryptographic restoration image. Import always creates a
new Project identity.

## 1. Project creation sources

Creating a Project has three equivalent entry points:

```text
Create Project
├── Blank Project
├── Import Floe export
└── Import Markdown directory
```

All three produce an ordinary new Floe Note Project with:

- a new ProjectId;
- a new ProjectKey;
- a new CreateProject root;
- the current Device as the initial authorized device.

The source only determines the initial Project content. Project creation still
uses the normal coordinator-backed CreateProject commit flow.

This keeps Project creation separate from the authorization identity of any
source Project without introducing a separate offline-genesis mode.

## 2. Portable Floe export

The v1 Floe export is a ZIP archive named:

```text
<project-name>.floe.zip
```

Example:

```text
Personal.floe.zip
├── manifest.json
└── notes/
    ├── Welcome.md
    ├── Ideas.md
    └── Ideas (2).md
```

After extraction, every note remains a normal UTF-8 Markdown file which can be
opened without Floe Note.

The `.floe.zip` suffix is descriptive. Import validates archive contents and
`formatVersion`; it does not trust the filename extension.

## 3. Markdown contents

Each active note is exported as one UTF-8 Markdown file.

The file contains the note body exactly as Markdown. Floe-specific metadata is
not injected into YAML frontmatter.

For example:

```markdown
# Floe Note

This is an ordinary Markdown document.

- [ ] Implement export
```

Keeping metadata separate has two goals:

1. exported Markdown remains unsurprising in Obsidian, VS Code, Git, and other
   ordinary tools;
2. Floe Note does not need to give YAML frontmatter special semantics in its
   editor model.

Deleted/tombstoned notes are not exported in v1.

## 4. manifest.json

`manifest.json` stores Project-level metadata and note metadata.

The v1 logical schema is:

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

Timestamps are RFC 3339 / ISO 8601 UTC strings.

Example:

```json
{
  "format": "floe-project",
  "formatVersion": 1,
  "exportedAt": "2026-09-23T02:30:00.000Z",
  "project": {
    "name": "Personal"
  },
  "documents": [
    {
      "path": "notes/Welcome.md",
      "title": "Welcome",
      "createdAt": "2026-09-20T12:00:00.000Z",
      "updatedAt": "2026-09-23T01:45:00.000Z",
      "tags": ["floe", "todo"]
    }
  ]
}
```

Unknown optional fields should be ignored by v1 importers. An unsupported
`formatVersion` must fail explicitly rather than being guessed.

## 5. File naming

Exported Markdown filenames are derived from note titles for human usability.

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

The filename is not the note identity. Metadata is associated with a file by the
relative `path` recorded in `manifest.json`.

Archive paths always use forward slashes.

## 6. Data included in a Floe export

v1 preserves the logical content data needed for portability and interoperability:

- Project name;
- active note titles;
- Markdown bodies;
- createdAt;
- updatedAt;
- tags.

When attachments are implemented, a later format version may add an
`attachments/` directory and attachment metadata.

The export format should evolve from the logical Project model, not from the
IndexedDB schema.

## 7. Data deliberately excluded

A portable export must not contain:

- edit-history checkpoints or historical note versions;
- presentation metadata such as Project tag colors;
- original ProjectId;
- DeviceId or authorized-device membership;
- Device Vault contents;
- device private keys;
- ProjectKey material;
- SecurityState;
- SecurityTransitions;
- coordinator URL/state;
- presence or signaling state;
- Loro peer/synchronization history;
- edit-history checkpoints and historical versions;
- IndexedDB records or schema details.

These values are either Floe Note-specific presentation/runtime metadata or
belong to the original Project's cryptographic and synchronization identity.

Consequently, importing an export does not resume synchronization with the
original Project. Tag strings are preserved, but Project tag colors are not;
imported tags therefore use the default gray until the user explicitly chooses
a color. Imported notes also start with fresh edit history; portable v1 export
carries only the current logical note state.

## 8. Export consistency

Export is a local operation.

It requires:

- an unlocked Device Vault;
- access to the local Project data.

It does not require:

- coordinator availability;
- current coordinator SecurityState freshness;
- presence;
- WebRTC peers.

The exporter captures one local logical snapshot, then writes the ZIP from that
snapshot. Changes arriving after snapshot capture may be absent.

The UI should describe the result as a copy of the data available on this device
at export time, not as a distributed snapshot of every peer.

## 9. Importing a Floe export

Import validates the complete archive before creating persistent Project state.

At minimum it validates:

- `format === "floe-project"`;
- supported `formatVersion`;
- every declared note path exists exactly once;
- paths are relative and cannot escape the archive root;
- timestamps are valid;
- required values have valid types and bounds;
- referenced files decode as UTF-8.

After validation:

```text
.floe.zip
    |
    v
new ProjectId
new ProjectKey
new CreateProject
    |
    +-- Project name
    +-- new DocumentId for each note
    +-- title
    +-- Markdown body
    +-- createdAt / updatedAt
    +-- tags
```

Import never overwrites or merges into an existing Project in v1.

If any required import step fails, the newly created Project must not be left
partially persisted.

## 10. Importing a Markdown directory

Floe Note also supports creating a Project from an ordinary directory of
Markdown files.

Example source:

```text
my-notes/
├── inbox.md
├── ideas.md
├── research/
│   ├── paper-a.md
│   └── paper-b.md
└── .obsidian/
    └── ...
```

v1 recursively imports regular files ending in `.md` or `.markdown`,
case-insensitively.

Hidden files/directories and tool-specific directories such as `.obsidian` and
`.git` are ignored.

Directory hierarchy is intentionally discarded during Markdown directory
import. All imported Markdown files become ordinary notes in the new Project,
regardless of their source directory depth.

Duplicate note titles are allowed.

### 10.1 Project name

The selected directory name becomes the initial Project name after normal Floe
Note name validation.

If a usable directory name is unavailable, the fallback name is
`Imported notes`.

### 10.2 Note title

The filename without its Markdown extension becomes the note title.

For example:

```text
research/paper-a.md -> "paper-a"
```

The importer does not infer the title from the first heading.

### 10.3 Note body

The file contents are imported verbatim as the Markdown body, modulo UTF-8
decoding and normal newline handling.

v1 does not parse YAML frontmatter from raw Markdown directories. If a source
file contains frontmatter, it remains part of the note body.

This avoids making raw-directory import define a second metadata model.

### 10.4 Metadata defaults

A raw Markdown directory has no Floe manifest, so v1 uses:

- a new DocumentId;
- `createdAt = import time`;
- `updatedAt = import time`;
- `tags = []`.

Filesystem creation/modification timestamps are not treated as authoritative
Floe Note metadata in v1.

A future importer may explicitly support frontmatter or source modification
times, but that is a separate compatibility feature.

### 10.5 Empty directories and invalid files

If no importable Markdown files are found, creation should stop before creating
the Project and report that no Markdown files were found.

Unreadable or invalid UTF-8 Markdown files should be listed to the user before
creation rather than silently skipped.

## 11. Security of exported files

The v1 portable export is not encrypted by Floe Note.

This is deliberate:

- the primary goal is portability and an escape hatch independent of Floe Note;
- extracted Markdown should remain directly readable;
- adding passphrase recovery, KDF parameters, and an encrypted container would
  create a second key-management system.

The export UI must therefore clearly state that the resulting archive contains
readable note contents and should be stored or transferred accordingly.

Encrypted backups may be added later as a distinct feature. They should not
replace the portable export.

## 12. Coordinator dependency of import

Export is deliberately coordinator-independent, but importing into Floe Note
creates a new Project and therefore follows the normal Project creation flow.

Conceptually:

```text
Floe export / Markdown directory
        |
validate and prepare initial content locally
        |
generate ProjectId + ProjectKey
sign CreateProject
        |
coordinator verifies and commits genesis
        |
persist committed Project locally
```

If the coordinator is unavailable, the source files remain readable and
portable, but Floe Note does not create a partially initialized Project which is
waiting for later coordinator registration.

This keeps import/export separate from the authorization protocol:

- exporting existing local data does not require coordinator availability;
- creating a new Floe Note Project, including through import, does require the
  normal coordinator-backed Project bootstrap in v1.

## 13. UI model

Project creation should expose one conceptual action with source choices rather
than separate unrelated features:

```text
New Project

[ Blank Project ]
Start with an empty Project.

[ Import Floe export ]
Create a new Project from a .floe.zip export and preserve Floe metadata.

[ Import Markdown directory ]
Create a new Project from ordinary Markdown files.
```

Importing always displays that a new independent Project will be created.

Export belongs in Project settings under Data & security (or a future
Import & export section) and remains available while the coordinator is offline.

## 14. Non-goals for v1

v1 does not implement:

- restore with the original ProjectId;
- importing into/merging with an existing Project;
- round-tripping Loro history;
- preserving device authorization;
- coordinator migration;
- encrypted backup containers;
- frontmatter metadata parsing;
- folder semantics;
- conflict resolution between an export and its source Project;
- automatic filesystem synchronization.

These can be introduced independently if later product requirements justify
them.
