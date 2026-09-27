# Coordinator boundary and Project survivability

Status: proposed v1 design.

This document defines the v1 boundary between the Floe Note client and the
coordinator. The portable data format is specified in
`project-import-export.md`.

## 1. Design principle

Floe Note deliberately keeps a coordinator.

The coordinator handles the parts of a distributed system which benefit from a
single online coordination point: device membership, SecurityState ordering,
presence, discovery, invitations, and WebRTC signaling.

Floe Note does not try to decentralize these responsibilities merely to remove a
server dependency. Doing so would introduce authorization forks, key-epoch
conflicts, leader election, consensus, or explicit fork resolution without a
product requirement that justifies that complexity.

Instead, the client/coordinator boundary follows this principle:

> Local work is coordinator-independent; cross-device coordination is
> coordinator-dependent.

More concretely:

> Once a Project has been created and its data and keys are present on a device,
> coordinator availability must not be required to use or export that local
> Project.

The coordinator remains important, but it does not own the user's note data.

## 2. Coordinator responsibilities

The production Floe Note service uses the coordinator as its online control
plane.

### 2.1 Security coordination

The coordinator stores and sequences:

- the current materialized SecurityState;
- the current sequence/head hash;
- signed SecurityTransitions used for verified catch-up;
- opaque ProjectKey envelopes required by key rotation and delivery.

SecurityState remains a single linear history:

~~~text
CreateProject(A)
      |
      v
AddDevice(B)
      |
      v
RevokeDevice(B)
~~~

The coordinator rejects transitions which do not extend its current head.

This serialization is intentional. v1 does not attempt decentralized membership
mutation or SecurityState fork reconciliation.

### 2.2 Connectivity coordination

The coordinator also provides:

- authenticated device presence;
- online-device discovery;
- invitation lookup and lifecycle;
- WebRTC rendezvous;
- WebRTC offer/answer/ICE signaling.

Once a WebRTC DataChannel is established, Project content synchronization is
peer-to-peer and does not flow through the coordinator.

## 3. Data the coordinator does not own

The coordinator must not store Project user data or private key material.

In particular, it does not store:

- note contents;
- Loro document state as Project content;
- attachment plaintext;
- plaintext ProjectKeys;
- device private keys;
- portable Project exports.

Those remain on user devices.

This distinction is the core resilience boundary: loss of the coordination
service may interrupt coordination, but it must not make already-local note data
unreadable or non-exportable.

## 4. Project creation

Creating a new Floe Note Project may depend on the coordinator in v1.

The normal creation flow remains:

~~~text
create/import Project
        |
generate ProjectId + ProjectKey
        |
sign CreateProject
        |
coordinator verifies and commits genesis
        |
persist committed SecurityState + encrypted Project locally
        |
Project becomes usable
~~~

This keeps Project genesis consistent with the same committed SecurityState
model used by later device membership changes.

v1 does not introduce a pending/offline Project genesis state solely to make
Project creation work during a coordinator outage.

The three Project creation sources are still:

~~~text
Create Project
├── Blank Project
├── Import Floe export
└── Import Markdown directory
~~~

The source affects only the initial user-visible Project content. All three use
the normal coordinator-backed Project creation flow.

## 5. Existing Project open

Coordinator availability must not gate an already-local Project.

After Device Vault unlock, a client with locally persisted Project data,
ProjectKey material, and a previously verified SecurityState may open the
Project from that local state immediately.

~~~text
unlock Device Vault
        |
load local Project + ProjectKey
load locally verified SecurityState
        |
Project usable
        |
background coordinator reconciliation
~~~

Coordinator reconciliation determines whether newer SecurityTransitions exist.
It does not decide whether already-local notes may be rendered or edited.

If the coordinator is unreachable, the local Project remains usable and the
coordination state becomes unavailable/offline.

If the coordinator reports a newer state, the client verifies the complete
signed transition chain from its locally verified head before adopting it.

If the coordinator reports an older or conflicting state, the client treats
that as a coordination/security error and must not roll back its locally
verified SecurityState. Local note data remains available.

This separates two state dimensions which should not be collapsed into one:

~~~text
Local Project state
  locked | ready | unavailable

Coordination state
  connecting | online | unavailable | conflict
~~~

`Local Project = ready` together with `Coordination = unavailable` is a
normal offline condition, not a fatal Project error.

## 6. Coordinator outage behavior

For a Project which already exists locally:

~~~text
Operation                                  Coordinator unavailable

read local notes                           yes
edit/create/delete local notes             yes
edit local Project content metadata        yes
persist encrypted local changes            yes
view cached verified SecurityState         yes
export Markdown + JSON                     yes
sync over an already-alive WebRTC channel  yes

create a new Floe Project                  no
import as a new Floe Project               no
AddDevice                                  no
RevokeDevice                               no
key-epoch rotation                         no
automatic peer discovery                   no
new WebRTC rendezvous/signaling            no
SecurityState freshness/catch-up            no
~~~

A live peer-to-peer connection can continue carrying encrypted CRDT updates
without the coordinator. Re-establishing a connection after it is lost normally
requires coordinator presence/discovery/signaling again.

## 7. Why AddDevice and RevokeDevice stay online-only

With multiple authorized devices, independent offline membership mutations can
fork:

~~~text
             H7
            /  \
 AddDevice(C)   RevokeDevice(B)
      H8a           H8b
~~~

Reconciling these branches would require rules for authorization, key epochs,
ProjectKey distribution, revocation, and history selection.

v1 intentionally keeps those operations behind the coordinator sequencer.

The client should not queue speculative AddDevice/RevokeDevice transitions for
later publication. If coordination is unavailable, the operation is unavailable
and can be retried when service returns.

This keeps local application state free from provisional authorization states.

## 8. Portable I/O as the ownership boundary

Floe Note protects user ownership through portable I/O rather than through an
offline membership bypass.

An existing Project can be exported without contacting the coordinator:

~~~text
Project P
   |
   | local export
   v
P.floe.zip
├── manifest.json
└── notes/*.md
~~~

The Markdown files and JSON metadata are user-readable, application-independent
data.

The export deliberately excludes Project identity, SecurityState, ProjectKeys,
and device identity. Importing it later creates a new Project rather than
resuming the old synchronization identity.

This means a permanent coordinator/service failure does not trap the note
contents inside Floe Note. The export can still be opened directly with ordinary
Markdown tools even if creating a new Floe Project is temporarily impossible.

Raw Markdown directories are likewise accepted as a Project creation source
when the Floe Note coordination service is available.

## 9. Fixed production coordinator

v1 does not expose coordinator selection as a user-facing Project setting.

The official production application uses the Floe Note coordinator deployment,
currently configured as:

~~~text
https://floe-coordinate.pwll.dev
~~~

Development builds may use an environment-specific endpoint.

The coordinator URL is not part of the portable Project data model and is not a
Project cryptographic identity field.

v1 does not implement:

- per-Project coordinator selection;
- runtime coordinator switching;
- migration of an existing Project between coordinators;
- multiple concurrent coordinators for one Project.

These features would require additional SecurityState migration/fork semantics
and are not needed for data portability.

## 10. Thin client/coordinator coupling

Keeping a central coordinator does not require coupling the domain model to
network availability.

The desired dependency boundary is:

~~~text
UI / Application
      |
      +---- Local Project / Document / Storage / Vault
      |
      +---- Coordinator client
                |
                +-- HTTP / WebSocket
~~~

`NoteProject`, document logic, local storage, and portable export should not
depend on coordinator requests.

The application layer combines local state with coordinator state for online
features such as synchronization and device management.

Coordinator operations should be designed to fail without corrupting or
invalidating local Project state. In particular they should be:

- retry-safe where practical;
- idempotent where the protocol admits it;
- explicit about conflict versus network failure;
- bounded by normal network failure handling.

The existing CreateProject behavior is an example: repeating the same signed
genesis is idempotent, while attempting to initialize the same ProjectId with a
different head is a conflict.

## 11. UI implications

Coordinator failure should not be represented as a whole-Workspace loading or
fatal-error state when local Workspace data is healthy.

A typical offline state is conceptually:

~~~text
Workspace: available
Local data: available

Sync: offline
Device management: unavailable
~~~

Workspace settings which operate only on local data, including export and local
removal, remain available.

Controls which require coordination, such as Add device or Revoke device, may be
disabled with an explanation that the coordinator is currently unavailable.

## 12. Complexity boundary

The v1 design intentionally keeps:

- centralized SecurityState sequencing;
- centralized invitation/presence/signaling coordination;
- ProjectKey-protected P2P data synchronization;
- encrypted local Project storage;
- coordinator-independent local editing after Project creation;
- coordinator-independent portable export.

It intentionally avoids:

- arbitrary offline membership mutation;
- pending/provisional devices;
- SecurityState fork merging;
- device consensus or quorum;
- peer-relayed signaling;
- automatic coordinator failover;
- coordinator migration;
- preserving Project identity through portable export/import.

This keeps the distributed-systems complexity where it is useful and provides a
small, stable boundary for user data ownership.

## 13. Decision summary

Floe Note is not designed to eliminate its coordinator.

The coordinator remains the authoritative online coordination service for
Project creation, device membership, SecurityState sequencing, presence,
discovery, invitations, and signaling.

The client is decoupled from coordinator availability after Project creation:
already-local notes can be read, edited, persisted, and exported without it.

The resulting model is:

~~~text
centralized coordination
        +
P2P synchronization
        +
encrypted local data ownership
        +
portable Markdown/JSON I/O
~~~

This avoids unnecessary distributed-consensus machinery while ensuring that a
coordination outage does not take ownership of the user's notes away from the
user.
