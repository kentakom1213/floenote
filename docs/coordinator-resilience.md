# Coordinator resilience and Project survivability

Status: proposed v1 design.

This document defines what Floe Note should and should not depend on the
coordinator for. The detailed portable data format is specified in
project-import-export.md.

## 1. Problem

Floe Note keeps Project data and ProjectKeys on user devices, not on the
coordinator. A coordinator outage should therefore not be able to turn an
otherwise healthy local Project into unrecoverable data.

The failure path to avoid is:

~~~text
Device A contains the only usable Project copy
        |
coordinator becomes unavailable
        |
normal AddDevice cannot complete
        |
Device A is later lost
        |
Project data is lost even though the coordinator never stored it
~~~

The goal is to eliminate this data-survivability failure without turning device
membership into a fully decentralized consensus protocol.

## 2. v1 invariants

v1 should preserve these properties:

> Coordinator availability must not be required to read, edit, or export an
> already-local Project.

> Coordinator availability must not be required to create a new Project from a
> blank state, Floe export, or Markdown directory.

> An unlocked device must always have a coordinator-independent path for
> preserving user-visible Project data outside the current Project identity.

These requirements do not imply that AddDevice, RevokeDevice, or automatic peer
discovery must work without the coordinator.

## 3. Coordinator responsibilities

The coordinator has two classes of responsibility.

### 3.1 Connectivity control plane

It provides presence, peer discovery, invitation lookup, and WebRTC
signaling/rendezvous.

These services improve automatic synchronization but do not contain Project
plaintext or ProjectKeys.

### 3.2 Membership sequencer

It serializes signed SecurityTransitions:

~~~text
CreateProject(A)
      |
      v
AddDevice(B)
      |
      v
RevokeDevice(B)
~~~

For ordinary membership changes, the coordinator rejects transitions which do
not extend its current head.

Keeping a sequencer avoids divergent authorization histories without requiring
consensus among user devices.

## 4. Why membership remains coordinator-dependent

With multiple authorized devices, concurrent offline membership changes can
fork:

~~~text
             H7
            /  \
 AddDevice(C)   RevokeDevice(B)
      H8a           H8b
~~~

Automatically reconciling such branches would require new semantics for which
devices remain authorized, which key epoch wins, which ProjectKey should be
distributed, and how divergent histories are resolved.

v1 deliberately does not solve this problem. AddDevice, RevokeDevice, and
key-epoch rotation therefore continue to require the coordinator.

This is acceptable as long as coordinator failure cannot trap the user's data.

## 5. Locally usable verified SecurityState

A SecurityState that has already been cryptographically verified and persisted
locally should be usable immediately after Device Vault unlock.

Coordinator freshness checking should happen in the background.

An unavailable coordinator may make freshness unknown, but it must not hide or
invalidate the locally verified state merely because a network request failed.

A coordinator state older than the latest locally verified head remains a
rollback error. A newer state still requires verification from signed
transitions before it replaces local verified state.

## 6. Local-first Project genesis

Creating a Project is different from mutating an existing authorization history.

CreateProject has no previous SecurityState head and exactly one initial signing
device. Project creation can therefore be local-first:

~~~text
Blank / Floe export / Markdown directory
        |
generate new ProjectId
generate new ProjectKey
sign CreateProject locally
        |
persist Project + initial SecurityState
        |
Project becomes usable
        |
register genesis with coordinator when available
~~~

Coordinator registration is a control-plane synchronization action rather than
a prerequisite for creating the first usable local copy.

This rule is limited to Project genesis. It is not a general offline
SecurityTransition mechanism.

## 7. Portable export/import as the escape hatch

v1 uses portable data export rather than an offline AddDevice exception.

An unlocked Project can be exported locally:

~~~text
Project P on Device A
        |
        | Export
        v
P.floe.zip
  ├── manifest.json
  └── notes/*.md
~~~

The archive contains logical Project content, not Project cryptographic identity.
It can be transferred by any user-chosen mechanism.

Another Floe Note installation can create a new Project from that export even
when the old coordinator is unavailable.

Import creates a new ProjectId, new ProjectKey, new CreateProject root, and new
DocumentIds. It does not restore or join the original Project.

This deliberately trades synchronization continuity for a simple,
coordinator-independent guarantee that the note data remains portable.

## 8. Raw Markdown as another Project source

Floe Note also supports creating a new Project directly from a directory of
ordinary Markdown files.

This supports Obsidian-like directories, manually maintained Markdown
collections, and migration into Floe Note without a Floe-specific archive.

The same new-Project semantics apply. No source directory or file is treated as
an existing Floe Note authorization identity.

See project-import-export.md for details.

## 9. Coordinator outage behavior

Under the v1 boundary:

~~~text
Operation                              Coordinator unavailable

read local notes                       yes
edit local notes                       yes
rename/delete local notes              yes
view locally verified device state     yes
export Project                         yes
create blank Project                   yes
create Project from Floe export        yes
create Project from Markdown directory yes
sync over an already-alive P2P link    yes

automatic peer discovery               no
new WebRTC rendezvous via coordinator  no
AddDevice                              no
RevokeDevice                           no
key-epoch rotation                     no
~~~

This is an intentional boundary rather than an implementation failure.

## 10. Why v1 does not use offline AddDevice

An earlier option was to permit offline AddDevice when exactly one device was
authorized.

That can be made reasonably safe, but it still introduces pending
SecurityTransitions, special ProjectKey-delivery ordering, later
publication/reconciliation, a new conflict path, coordinator-independent
pairing/signaling, and more device-management states.

All of this exists only to preserve another copy of the data.

Portable export/import achieves the actual survivability requirement without
adding an exception to the authorization protocol and is useful as a general
interoperability feature as well.

Therefore offline AddDevice and provisional-device concepts are not part of the
v1 design.

## 11. Coordinator replacement

Replacing the configured coordinator is desirable but is a separate
service-continuity feature.

The current application uses one build-time VITE_COORDINATOR_URL, so it cannot
currently switch a Project to another coordinator at runtime.

Portable export/import already guarantees an escape path if a coordinator
deployment disappears permanently:

~~~text
old Project P
   |
 export
   v
portable data
   |
 import
   v
new Project P'
~~~

P' does not preserve P's identity or existing peer relationships.

A future true coordinator-migration feature would preserve ProjectId and
authorization history. That requires a separate design for verifiable history,
stale heads, and divergent coordinator state.

v1 does not require that feature to satisfy Project data survivability.

## 12. Complexity assessment

The proposed v1 resilience work is limited to:

- use cached locally verified SecurityState while offline;
- make CreateProject genesis local-first;
- implement portable Markdown + JSON export;
- create Projects from Floe exports;
- create Projects from raw Markdown directories.

It explicitly avoids:

- arbitrary offline AddDevice/RevokeDevice;
- pending membership transitions;
- provisional devices;
- authorization fork merging;
- device consensus/quorum;
- automatic coordinator failover;
- peer-relayed signaling;
- preserving Project identity through export/import;
- key-recovery protocols mixed into import/export.

This keeps the security protocol linear and small while providing a
coordinator-independent data escape path.

## 13. Implementation order

A reasonable order is:

1. make locally verified SecurityState usable when coordinator freshness checks
   fail;
2. make blank Project genesis local-first;
3. add the logical import/export model needed by documents and metadata;
4. implement Project creation from a Floe export;
5. implement Project creation from a Markdown directory;
6. expose export from Project settings;
7. add attachments to the portable format when attachments themselves are
   implemented.

True backup/restore of the original Project identity and coordinator migration
remain separate future features.

## 14. Decision summary

The coordinator remains the normal sequencer for device membership.

Floe Note does not add a membership-protocol bypass solely for disaster rescue.
Instead, local-first Project creation plus portable import/export ensures that
coordinator failure cannot prevent the user from extracting their notes and
starting a new independent Project elsewhere.

This satisfies the core survivability requirement with substantially less
protocol complexity.
