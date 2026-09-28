# Floe Note Architecture

> Scope: single-user, multi-device, local-first note synchronization

This document defines the architecture of Floe Note. It focuses on stable system boundaries and protocol semantics rather than implementation history. Detailed protocol or subsystem specifications may be split into separate documents when they require independent treatment.

## 1. Goals

Floe Note is a privacy-oriented, local-first note application for one person using multiple devices.

The core goals are:

- Notes remain available offline.
- Workspace data synchronizes directly between devices over peer-to-peer connections.
- Central coordination is used where it keeps the protocol and implementation simple.
- The coordination service does not store note contents or WorkspaceKeys.
- Concurrent edits are merged by a CRDT rather than by application-specific conflict resolution.
- Persistent data is encrypted at rest and in transit at the application layer.
- The architecture should remain usable from the web first, while allowing native wrappers later.
- Security-critical state is kept separate from collaborative document state.

### Scope exclusions

The following are outside the core architecture:

- multi-user collaboration;
- roles and permissions between different users;
- server-side document synchronization or document storage;
- a custom rich-text document format;
- folders, backlinks, full-text search, and other higher-level organization features;
- background synchronization when no application runtime is active.

If multi-user collaboration becomes a requirement, it should be treated as a separate project rather than an incremental extension of this security model.

## 2. Core invariants

The following decisions are considered architectural invariants unless there is a strong reason to revisit them.

Workspace is the only top-level security identity. Legacy implementation names
that still use `Project` do not introduce a separate Project-level
authorization, key, or cryptographic boundary.

1. A **Workspace** is the synchronization, authorization, and cryptographic boundary.
2. A **Project** is a flat organization boundary inside one Workspace. It is not a security, key, device-authorization, coordinator, or transport boundary.
3. Every non-purged **Document** belongs to exactly one Project.
4. One **Document** is one independent **LoroDoc**.
5. Document bodies are Markdown stored in **LoroText**.
6. Collaborative metadata is stored in Loro containers, primarily **LoroMap**.
7. Collaborative conflict resolution is delegated to **Loro**.
8. Security authorization state is **not** a CRDT.
9. Workspace data is encrypted with a Workspace-level symmetric key (`WorkspaceKey`).
10. Device authorization changes are represented by signed, linearly ordered security transitions.
11. Cloudflare coordinates signaling, rendezvous, invitations, and security-state ordering, but never receives plaintext Workspace data or WorkspaceKeys.
12. Decentralization is not a goal by itself. Coordination remains centralized when decentralizing it would make the implementation or protocol less natural without improving the privacy boundary.

## 3. System overview

```text
                         Cloudflare

                WorkspaceCoordinatorDO(W)
              ┌─────────────────────────┐
              │ Security sequencer      │
              │ Invite / rendezvous     │
              │ Signaling relay         │
              └────────────┬────────────┘
                           │ bootstrap
                           │
                    ┌──────┴──────┐
                    │             │
                Device A      Device B
                    ╲             ╱
                     ╲  WebRTC   ╱
                      ╲         ╱
                       Device C

Workspace data:
  encrypted Loro updates / snapshots
  encrypted attachments

Normal data path:
  device <-> device

Cloudflare data path:
  coordination metadata only
```

The control plane and data plane are deliberately separated.

- **Control plane:** peer rendezvous, signaling bootstrap, invitations, security sequencing.
- **Data plane:** encrypted CRDT state and attachments exchanged directly between devices.

## 4. Identity model

Long-lived domain identities use UUIDv7.

```text
WorkspaceId   -> UUIDv7
ProjectId     -> UUIDv7
DocumentId    -> UUIDv7
DeviceId      -> UUIDv7
AttachmentId  -> UUIDv7
CheckpointId  -> UUIDv7
```

UUIDv7 is used because devices can generate identifiers independently while retaining useful creation-order locality.

Short-lived protocol identifiers are cryptographically random tokens rather than UUIDs.

```text
InviteId      -> random 128-bit token
SessionId     -> random 128-bit token
PairingSecret -> random 256-bit secret
```

Identifiers are immutable and are not derived from names, titles, public keys, or mutable metadata.

Creation timestamps are stored independently. The timestamp embedded in UUIDv7 is not treated as authoritative application metadata.

## 5. Time metadata

Document creation and update times are stored as timezone-independent instants, for example Unix timestamps or UTC timestamps.

```text
createdAt -> immutable after creation
updatedAt -> updated for UI purposes
```

The UI converts these values to the user's local timezone.

Timestamps are used for display and sorting only. They must not be used to resolve CRDT conflicts or determine causality.

## 6. Workspace-scoped content model

> Project v1 is the accepted target model. Implementation is tracked by
> #177–#180 and is not yet complete.

The Workspace owns Projects, Documents, Workspace-scoped presentation metadata,
and edit-history metadata. Project is intentionally lighter than Workspace: it
organizes content but does not introduce a second authorization, encryption, or
synchronization boundary.

Some implementation names may still use `NoteProject` or `Project manifest`
for historical reasons while the Project model is introduced. Those legacy names
must not be interpreted as separate Project-level security state.

```text
Workspace
├── WorkspaceId
├── SecurityState
├── Manifest: LoroDoc
│   ├── Project metadata / lifecycle
│   ├── Document lifecycle
│   ├── Document -> Project membership
│   └── edit-history checkpoint metadata
├── Documents
│   ├── DocumentId -> LoroDoc
│   └── ...
└── Attachments
    ├── AttachmentId -> encrypted blob
    └── ...
```

The Workspace-scoped content model is intentionally small. It does not contain
all note contents in one CRDT document, and Project does not become an
independent synchronization object.

### 6.1 Workspace manifest

The Workspace manifest is a LoroDoc that tracks Workspace-scoped collaborative
metadata.

Conceptually:

```text
Manifest
├── projects: LoroMap
│   ├── ProjectId A -> { name, status, createdAt }
│   └── ProjectId B -> { name, status, createdAt }
├── documentProjects: LoroMap
│   ├── DocumentId A -> ProjectId A
│   ├── DocumentId B -> ProjectId A
│   └── DocumentId C -> ProjectId B
├── documents: LoroMap
│   ├── DocumentId A -> active
│   ├── DocumentId B -> deleted
│   └── DocumentId C -> active
└── editHistoryCheckpoints: LoroMap
    ├── CheckpointId X -> checkpoint metadata
    └── CheckpointId Y -> checkpoint metadata
```

The exact CRDT container encoding may evolve during implementation, but the
logical invariants are stable:

- every non-purged Document belongs to exactly one valid Project;
- Project names are mutable and need not be unique;
- Project membership is collaborative Workspace state;
- moving a Document changes membership rather than Document identity;
- Project metadata and membership converge through the existing Workspace
  manifest synchronization.

The manifest should contain as little duplicated document metadata as possible.

In particular, the document title should not be authoritative in both the manifest and the document itself. Local indexes may cache titles for efficient listing, but those indexes are derived state.

Edit-history checkpoints are an exception only in the sense that they are
Workspace-scoped references to Document history, not duplicated Document content.
A checkpoint stores a DocumentId, encoded Loro Frontiers, a display timestamp,
and optional restore-source metadata. It does not store a copy of the title,
tags, or Markdown body. Checkpoint records are immutable after creation and are
ordered for display by their timestamps rather than by CRDT container order.

The detailed edit-history semantics are defined in
[edit-history.md](./edit-history.md).

### 6.2 Project model

Projects are flat organization units inside a Workspace.

```text
Workspace
├── Project "Notes"
│   ├── Note A
│   └── Note B
└── Project "Research"
    └── Note C
```

A Project has an immutable `ProjectId`, a mutable display name, a creation
timestamp, and a lifecycle state of `active` or `archived`. Project names may
be duplicated. Projects are not nested, and a Document cannot belong to multiple
Projects.

A blank Workspace starts with one active Project named `Notes`. The first-run
default is therefore `Personal > Notes`. After normal use, a Workspace may
legitimately have zero active Projects.

Project archival is deliberately softer than deletion:

- a Project may be archived only when it has no active Documents;
- the final active Project may also be archived;
- deleted Documents in Trash do not prevent archival;
- archived Projects are hidden from normal Project selection but can be reopened;
- archived Projects cannot be targets for ordinary Document creation or moves;
- restoring a deleted Document whose Project is archived reactivates that Project.

Permanent Project deletion is not part of v1.

Project selection is local UI state, remembered per Workspace and not
synchronized. The ordinary sidebar Note list and sidebar search are scoped to
the selected Project. Workspace-wide features such as Trash, tags, backlinks,
and global search remain Workspace-wide.

Opening an active Note from a Workspace-wide surface or canonical Note URL
updates the local selected Project to that Note's current Project membership.
This includes direct URL navigation, browser Back/Forward, global search, and
backlinks. Thus, if Project B is selected and a Note belonging to Project A is
opened, Project A becomes the selected Project while the canonical Note URL
remains unchanged.

A remembered Project selection is valid only while that Project remains active.
If synchronization makes the remembered Project archived or otherwise invalid,
an active Note being opened determines the selected Project. When no active
Note determines the context, the UI may select another available active Project
using the existing Project-list ordering. If no active Project exists, there is
no selected Project and the UI presents an empty state for creating or reopening
a Project.

Creating a Note assigns it to the selected active Project. Moving a Note only
changes its Project membership and an archived Project is not a valid move
destination. The DocumentId, canonical URL, content, edit history, tags, and
links remain unchanged.

### 6.3 Convergent Project invariants

Local mutation rules reject creation or moves into a Project that is already
archived on that device. They cannot, however, eliminate the concurrent case
where one peer archives an empty Project while another peer, which still sees
that Project as active, creates or moves an active Document into it.

After local manifest mutations and after merged or remote manifest state is
applied, the domain therefore normalizes only this invariant:

- every Project containing at least one active Document is active.

This repair does not impose a minimum number of active Projects. Concurrently
archiving different empty Projects may legitimately converge to a Workspace
with zero active Projects.

The rule repairs domain invariants after Loro has merged collaborative state.
It does not replace Loro's field-level conflict resolution and does not
introduce timestamp ordering, device priority, or a separate winner-selection
protocol. Normalization must be idempotent: applying it again to an already
valid state does not create further changes.

### 6.4 Deletion

Document deletion is logical before it is physical.

```text
active
  |
  v
deleted (tombstone)
  |
  v
optional garbage collection later
```

A tombstone allows a device that was offline during deletion to learn that the document was removed.

Deleted Documents retain their Project membership so restoration can return them
to the same Project. If that Project is archived, restoration reactivates it.

Garbage collection policy is intentionally left for later. The first implementation may retain tombstones indefinitely.

## 7. Document model

Each note page is one independent LoroDoc.

```text
Document
├── DocumentId
└── LoroDoc
    ├── meta: LoroMap
    │   ├── title: string
    │   ├── createdAt: timestamp
    │   ├── updatedAt: timestamp
    │   └── tags: LoroList
    └── body: LoroText
```

The `DocumentId` exists outside the CRDT document because it is immutable identity, not collaborative state.

### 7.1 Markdown as the source format

The body contains Markdown directly.

```markdown
# Example

Some **Markdown** text.

- Item one
- Item two
```

This keeps the persistent document format independent of the editor implementation.

The intended editor direction is CodeMirror 6. A different Markdown editor can be substituted later without migrating document contents.

### 7.2 Metadata CRDT choices

Metadata fields should use a CRDT container appropriate to their semantics.

Examples:

- `title`: scalar value in `LoroMap`;
- `createdAt`: scalar value;
- `updatedAt`: scalar value;
- `tags`: independent list/set-like CRDT structure rather than a scalar array.

Application code should not add its own last-write-wins rules on top of Loro.

### 7.3 Edit history

User-facing edit history is distinct from editor Undo/Redo.

Undo/Redo uses Loro `UndoManager` for local editing history. Persistent edit
history instead records selected Loro `Frontiers` as shared Workspace-manifest
checkpoints. Historical preview reconstructs a read-only state from the
Document's retained Loro history, while restore applies historical title, tags,
and body to the current Document as new CRDT operations.

The live Document must remain attached while a historical version is viewed;
preview therefore uses an independent historical Loro view rather than
checking out the live editor document.

v1 retains both checkpoint metadata and full Loro Document history
indefinitely. Retention and shallow-history pruning are future concerns.

See [edit-history.md](./edit-history.md) for the complete v1 specification.

## 8. CRDT and conflict resolution

Loro is the authority for collaborative merge semantics.

The application does not decide conflicts using:

- local timestamps;
- device priority;
- "latest received update";
- manually selected winners.

This applies to:

- document bodies;
- collaborative metadata;
- the Workspace document manifest.

Project-invariant normalization described in section 6.3 is not a competing
conflict-resolution rule. Loro first merges the collaborative fields; the
domain then deterministically repairs only states that violate the Project
invariants.

Security authorization is explicitly excluded from this rule and is handled separately.

## 9. Synchronization model

Synchronization operates at three object classes:

```text
Workspace Manifest
  └── includes edit-history checkpoint metadata
Document
Attachment
```

Edit history does not add a fourth synchronization object or a separate
protocol. Checkpoint metadata converges through the existing Workspace manifest
Loro synchronization, while the referenced historical content remains in each
Document's Loro history.

A typical synchronization flow is:

```text
1. synchronize Workspace manifest
2. discover differences in the document set
3. synchronize required Document Loro states
4. synchronize required attachments
```

Documents are independent synchronization units. Opening a Workspace does not require loading every document into memory.

### 9.1 Loro synchronization

Loro version/update mechanisms are used for CRDT synchronization.

The sync layer should operate in terms of document identity and serialized Loro data rather than exposing editor-specific state.

### 9.2 Transport abstraction

Synchronization logic should not depend directly on WebRTC.

Conceptually:

```ts
interface Transport {
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array) => void): void;
}
```

Possible transports include:

- WebRTC DataChannel;
- BroadcastChannel for same-browser testing;
- other transports added later.

The SyncEngine should depend on the abstraction, not on `RTCPeerConnection` directly.

### 9.3 Encrypted synchronization transport

Normal synchronization within a Workspace is encrypted below `WorkspaceSyncEngine`.
The engine continues to encode and decode the existing plaintext Loro sync
protocol, while an `EncryptedSyncTransport` wraps the underlying transport:

```text
WorkspaceSyncEngine
      |
plaintext sync message
      |
EncryptedSyncTransport
      |
XChaCha20-Poly1305 envelope
      |
WebRTC DataChannel
```

This keeps CRDT synchronization independent from the cryptographic transport
policy and avoids passing raw WorkspaceKey bytes into the sync package.

Protocol version 1 encrypts the complete encoded sync message, including the
message type and DocumentId when present. The application-layer envelope carries
only the information needed to select and authenticate the key epoch:

```text
EncryptedSyncEnvelope
├── magic = "FLOE"
├── envelopeVersion = 1
├── keyEpoch
├── random XChaCha20 nonce
└── ciphertext
    └── complete encoded SyncMessage
```

AEAD associated data binds a domain-separation string, WorkspaceId, and keyEpoch.
The key epoch is therefore visible on the wire but cannot be changed without
causing authentication failure. WorkspaceId is supplied by the local Workspace
context rather than repeated in the envelope, so a ciphertext copied between
Workspaces does not authenticate.

For live synchronization, the receiver requires the envelope keyEpoch to equal
the current committed `SecurityState.keyEpoch`. Older WorkspaceKeys may remain in
the Vault for future lazy storage migration, but they are not accepted for
network sync after the security state advances. This prevents a device that
knows only a revoked/old epoch key from continuing to inject otherwise valid
sync ciphertext into the current Workspace session.

The Device Vault exposes encrypt/decrypt capabilities for a Workspace and epoch;
higher layers do not receive raw WorkspaceKey bytes. The encrypted transport
serializes asynchronous encrypt/decrypt operations so the ordered semantics of
the underlying WebRTC DataChannel are preserved.

After successful WorkspaceKey delivery during pairing, both peers may replace the
pairing protocol on that same DataChannel with encrypted Workspace synchronization.
The joining side starts its encrypted listener before sending the
`workspace-key-stored` acknowledgement; after receiving that acknowledgement,
the inviter starts its encrypted SyncEngine and sends full state. This ordering
avoids requiring a second WebRTC connection for the initial synchronization.

## 10. Peer-to-peer connectivity

WebRTC DataChannels carry Workspace synchronization data directly between devices.

Floe Note does not require or maintain a particular peer-to-peer graph topology. In particular, it does not require a full mesh and does not implement peer-relayed signaling as part of the core protocol.

Each online authorized device maintains an authenticated presence connection to
the Workspace coordinator after Device Vault unlock and SecurityState freshness
verification. Presence authentication uses a fresh coordinator challenge signed
by the device signing key; the proof binds WorkspaceId, DeviceId, the current
SecurityState head, and the challenge. The coordinator verifies the signature
against the authorized device public key in its current SecurityState before the
device is included in the online-device set.

Presence discovery supplies the online authorized DeviceIds used by the browser
reconnect layer. For each online device pair, the lexicographically smaller
DeviceId acts as the initiator. It generates a random 128-bit signaling SessionId
and sends that rendezvous capability to the peer over the already authenticated
presence WebSocket. The peer then joins the same signaling session.

The current browser implementation opportunistically establishes a direct
WebRTC connection for each simultaneously online device pair so CRDT updates do
not depend on peer-to-peer relaying. This is an implementation choice rather
than a protocol requirement: Floe Note does not add leader election, graph
repair, peer introduction, or a durable full-mesh membership protocol.

WebRTC offer, answer, and ICE messages are relayed through Cloudflare
separately. Once the DataChannel is available, the existing
`EncryptedSyncTransport` and `WorkspaceSyncEngine` perform WorkspaceKey-protected
synchronization.

```text
Device A ---- WebSocket ----┐
                            │
                     WorkspaceCoordinatorDO(W)
                            │
Device B ---- WebSocket ----┘

          signaling

              ↓

Device A ===== WebRTC ===== Device B

          Workspace data
```

Additional device pairs can establish direct WebRTC connections as needed. The application should not add mesh-maintenance, leader-election, or peer-introduction protocols unless a concrete requirement later justifies them.


## 11. Cloudflare coordination

Cloudflare Workers and Durable Objects provide the coordination plane.

The official production client uses the Floe Note coordinator deployment
(`https://floe-coordinate.pwll.dev`). v1 does not expose per-Workspace
coordinator selection or coordinator migration as user-facing features.
Development builds may use an environment-specific endpoint.

Coordinator availability is required for online coordination operations, but it
must not gate read/edit/export of a Workspace whose verified state, WorkspaceKey,
and data are already available locally.

Each Workspace maps to one logical coordinator:

```text
WorkspaceId W
   |
   v
WorkspaceCoordinatorDO(W)
```

The Durable Object has two distinct responsibilities.

### 11.1 Persistent security coordination

Persistent state includes:

- the current materialized SecurityState;
- the current sequence/head hash;
- the current key epoch;
- signed SecurityTransitions required for verified client catch-up.

When a transition is accepted, the coordinator atomically stores both the new
materialized SecurityState and the signed transition at its sequence number.
A client whose locally verified state is behind requests every transition after
its local sequence. The coordinator returns a chain only when every sequence up
to the current state is available; a missing transition is an error rather than
a reason to trust the materialized state directly.

The retained transition history exists to support authorization-state catch-up,
not as a product-facing permanent audit log. A future pruning policy may remove
history that is no longer needed by any supported device state.

### 11.2 Ephemeral rendezvous and signaling

Ephemeral coordination includes:

- authenticated online-device presence;
- pending invitations;
- WebSocket rendezvous;
- WebRTC offer/answer/ICE forwarding.

For normal authorized-device discovery, a client opens
`/workspaces/:workspaceId/presence`. The coordinator returns a random 256-bit
challenge and its current SecurityState head. The client signs the deterministic
authorized-presence proof with its Device Vault signing key. Only after the
coordinator verifies that signature against a DeviceId in the current
SecurityState does the socket contribute to the online-device list. The list is
deduplicated by DeviceId and broadcast to authenticated presence sockets.

The authenticated presence socket also carries Workspace-scoped control commands
that require an already authorized device, including invitation creation. Before
executing such a mutation, the coordinator reloads the current SecurityState and
requires the socket DeviceId to remain authorized under the same security head.
Possession of a WorkspaceId alone is not sufficient to allocate invitation state.

Presence is ephemeral Durable Object/WebSocket state. It is not persisted as an
authorization record and does not change SecurityState.

After authentication, a presence socket may also request a reconnect rendezvous
for another currently authorized device. The coordinator validates that both
DeviceIds are still authorized under the same current SecurityState head and
forwards the random signaling SessionId, sender DeviceId, and requested
transport mode (`direct` or `relay`) to one matching authenticated presence
socket. The mode is connection metadata only; it carries no key material or
authorization authority. The signaling SessionId therefore remains an
unguessable short-lived capability rather than a deterministic value derived
from public Workspace/device metadata.

Automatic sync starts with a direct STUN-only attempt. When a device has a TURN
credential endpoint configured and the initiating side has not connected within
six seconds, it abandons that PeerConnection, creates a fresh signaling
SessionId, and requests `relay` mode. Both peers then create fresh
relay-only PeerConnections. A failed relay attempt returns to the normal
reconnect backoff and the next attempt starts direct again.

Workspace-scoped signaling remains in `WorkspaceCoordinatorDO(WorkspaceId)`. Because a
join URL intentionally does not expose `WorkspaceId`, short-lived invitation
lookup is handled by a separate `InvitationCoordinatorDO(InviteId)`. That
object stores only the bootstrap mapping and lifecycle metadata needed to
resolve an invite:

```text
InviteId
  -> WorkspaceId
  -> SessionId
  -> waiting / claimed / consumed / cancelled / expired
  -> expiresAt
```

The invitation object is not an authorization authority. Claiming an invite
only resolves rendezvous information; device authorization still requires the
signed `AddDevice` flow.

WebSocket Hibernation should be used where appropriate so idle connections do not require an actively running object.

The Durable Object must not store:

- WorkspaceKeys;
- device private keys;
- note contents;
- Loro document states;
- attachment plaintext.

## 12. Device keys

Each device has two long-lived asymmetric key pairs.

```text
Device
├── DeviceId
├── encryption key pair
│   └── WorkspaceKey delivery / wrapping
└── signing key pair
    └── SecurityTransition signatures
```

Encryption and signing keys are separated by purpose.

Protocol version 1 uses libsodium-generated key pairs:

- device encryption keys: `crypto_box_keypair()` (Curve25519 public-key encryption key material);
- device signing keys: `crypto_sign_keypair()` (Ed25519 signatures).

Both key pairs are generated locally on the device. Only `DeviceId` and the
two public keys are sent over the authenticated pairing channel. Private keys
must never leave the device.

Device display names such as "Laptop" or "Phone" are not security-critical identity and should not be part of the signed authorization state unless needed later.

## 13. Workspace keys

Each Workspace has a symmetric WorkspaceKey.

```text
Workspace
├── keyEpoch = n
└── WorkspaceKey Kn
```

The WorkspaceKey encrypts:

- Workspace manifest persistence;
- Document persistence and synchronization payloads;
- attachments.

WorkspaceKeys are random symmetric keys. They are not derived from a user password.

The current intended AEAD is XChaCha20-Poly1305 through libsodium.

### 13.1 WorkspaceKey storage and delivery

The Device Vault stores WorkspaceKeys as a key ring keyed by
`(WorkspaceId, keyEpoch)`. Retaining the epoch explicitly allows old keys to
remain available for lazy ciphertext migration after a future rotation without
making old-key garbage collection part of the initial protocol.

For epoch 1, the root device (`addedAtSequence = 0`) creates a random 256-bit
WorkspaceKey if its Vault does not already contain one. A non-root device must
never invent a missing WorkspaceKey for an existing Workspace; it receives the key
from an already authorized device.

After `AddDevice(B)` is committed, the sender constructs a WorkspaceKey
envelope containing:

```text
WorkspaceKeyEnvelope
├── protocolVersion
├── WorkspaceId
├── keyEpoch
├── recipientDeviceId
├── committed SecurityState headHash
└── WorkspaceKey
```

The complete envelope is encrypted with
`crypto_box_seal(envelope, B.encryptionPublicKey)`. The recipient opens it
with its own device encryption key pair and rejects it unless WorkspaceId,
keyEpoch, recipientDeviceId, and the committed security head all match the
pairing context.

The sealed envelope is transported only after AddDevice has committed. The
receiving device persists the WorkspaceKey in its encrypted Device Vault and the
matching committed SecurityState locally before returning a `workspace-key-stored`
acknowledgement. The inviter consumes the one-time invitation only after that
acknowledgement arrives.

If a pairing is retried for a DeviceId that is already authorized with the
exact same encryption and signing public keys, the inviter must not submit a
second AddDevice transition. After the same explicit local confirmation, it may
resume WorkspaceKey delivery against the current committed SecurityState. If the
same DeviceId appears with different public keys, the pairing is rejected.

`crypto_box_seal` provides recipient confidentiality but not sender
authentication. Floe Note therefore does not treat a sealed box as proof of who
sent the WorkspaceKey. Sender authenticity comes from the already
PairingSecret-authenticated WebRTC pairing channel together with the committed
AddDevice authorization state.

Encrypted envelopes should authenticate unencrypted routing metadata, such as:

- protocol version;
- WorkspaceId;
- key epoch;
- object type;
- DocumentId or AttachmentId when applicable.

## 14. Device vault

Secrets on a device are stored inside a Device Vault.

Conceptually:

```text
OS / WebAuthn authentication
          |
          v
       VaultKey
          |
          v
     Device Vault
     ├── device encryption private key
     ├── device signing private key
     ├── WorkspaceKey A
     ├── WorkspaceKey B
     └── ...
```

The web application requires WebAuthn support. Environments that cannot provide the required WebAuthn-based vault unlock are unsupported rather than routed through a separate password-based fallback.

WebAuthn PRF is used to derive or unlock the vault key. The vault boundary remains abstract so a native application can use an equivalent platform-backed mechanism without changing the Workspace or synchronization model.

### 14.1 Browser vault

The initial browser implementation stores one encrypted device-vault record in
IndexedDB. The cleartext record contains only the material required to unlock
the vault:

- WebAuthn credential id;
- a random PRF input;
- AEAD nonce;
- encrypted vault payload.

The PRF output is not stored. It is evaluated from the WebAuthn credential when
the vault is unlocked. If PRF output is available during credential creation it
may be used immediately; otherwise the implementation performs a subsequent
WebAuthn assertion to evaluate the PRF.

The PRF output is passed through HKDF-SHA-256 with a Floe Note device-vault
context to derive the 256-bit VaultKey. The vault payload is encrypted with
XChaCha20-Poly1305. The payload contains the long-lived DeviceId, the device
encryption/signing key pairs, and WorkspaceKey entries keyed by WorkspaceId and key
epoch.

The Workspace-era Vault uses a distinct record identity and payload version.
Pre-Workspace Vault records are development state and are intentionally not
opened, partially migrated, or reused. Initializing the Workspace-era Vault
therefore creates a fresh DeviceId, fresh device key pairs, and an empty
WorkspaceKey ring. The unlocked runtime retains the VaultKey in memory so
WorkspaceKeys can be added without prompting WebAuthn for every Vault write.
The VaultKey and all in-memory private and Workspace keys are cleared when the
session closes.

Creating a local Device Vault establishes a device identity, but does not by
itself authorize that device for any Workspace. Workspace authorization begins with
the signed SecurityState transitions.

The WebAuthn credential is a vault-unlock mechanism, not the Floe Note device
identity. A synchronized passkey may therefore be reused to unlock independent
local Device Vaults on multiple physical devices. Each local vault still creates
and stores its own DeviceId, device encryption key pair, and device signing key
pair. Reusing the same synchronized passkey does not copy or merge vault
contents and does not make two devices the same authorized device.

When no local vault exists, the browser setup offers two explicit paths:
reuse an existing synchronized Floe Note passkey, or create a new passkey.
Newly created credentials are discoverable credentials so they can be selected
on another device after the passkey provider synchronizes them. Reusing a
passkey evaluates PRF with a fresh device-local PRF input; the resulting VaultKey
and encrypted vault remain independent for each physical device.

The application does not infer "no existing passkey" from a cancelled or failed
WebAuthn request. Creating a new credential is always a separate explicit user
action, which avoids silently creating duplicate passkeys.

### 14.2 Passkey availability and device authorization

Passkey availability and Floe Note device authorization are independent concerns.

A WebAuthn credential proves that the user can unlock or create a local vault boundary. It does not prove that the current local device identity is authorized for a Workspace. Conversely, a device may remain present in SecurityState while the WebAuthn credential needed to unlock its local vault is temporarily unavailable.

Conceptually, the browser onboarding flow must account for the cross product of these two axes:

| Passkey available | Local device / Workspace authorization | Meaning |
| --- | --- | --- |
| no | absent / unauthorized | New or unsupported environment. A persistent vault cannot be opened until a usable WebAuthn credential is available. |
| yes | absent / unauthorized | Normal new-device onboarding state. A synchronized Floe Note passkey may be reused to create or unlock an independent local vault, but the new DeviceId is still unauthorized until the signed AddDevice flow succeeds. |
| no | present / authorized | The Workspace may still list the device as authorized, but the local vault cannot be unlocked in this environment. Authorization alone does not recover local secrets. |
| yes | present / authorized | Normal returning-device state. The passkey unlocks the local vault, after which the device identity is checked against SecurityState. |

The table is a UX model, not a replacement for the underlying security checks. In particular:

- synchronized passkey availability must not be treated as device registration;
- creating or unlocking a Device Vault must not implicitly authorize the device for a Workspace;
- a successful vault unlock must still be followed by the normal SecurityState authorization check;
- a revoked device may still be able to unlock its local vault, but must be rejected as unauthorized for the Workspace;
- one synchronized passkey may unlock multiple independent local vaults, each with a distinct DeviceId and device key pairs.

When no local vault exists, the browser onboarding UX prefers reusing an existing discoverable Floe Note passkey when one is available, instead of requiring a new WebAuthn credential for every physical device. Reusing the passkey does not copy vault contents or WorkspaceKeys; the new device still creates its own local device identity and completes the normal pairing and AddDevice flow.

v1 does not provide a recovery credential or recovery secret. If a local vault
still exists but its passkey has been deleted or is permanently unavailable,
that vault is unrecoverable. The UI therefore offers an explicit local reset
path that deletes the Device Vault and local Workspace data so the browser can be
set up again. Resetting local storage does not revoke the old DeviceId from
SecurityState; another authorized device is required to rejoin Workspaces and may
later revoke the stale device entry. If no other usable device or backup exists,
the reset can permanently lose the only accessible copy of local Workspace data.

### 14.3 Ephemeral sessions

A future temporary-session mode may allow a Workspace to be opened without creating a persistent Device Vault on that browser profile.

The intended property is that sensitive session material, including any temporary device key material and WorkspaceKeys delivered for the session, is kept only in application memory and is not written to the persistent vault or Workspace storage. Ending or reloading the runtime discards that material and requires a new pairing flow.

This mode is intentionally separate from private-browsing detection. The application should not infer security semantics from whether the browser reports a private window; a user may choose an ephemeral session in a normal window, and private-browsing storage behavior differs across browsers.

Ephemeral sessions are not part of the initial MVP protocol. Their exact authorization and WorkspaceKey-delivery rules must be specified before implementation so they do not weaken the normal SecurityState device-authorization boundary.

### 14.4 Unlock lifetime

Vault unlock is valid for the current application session.

```text
application starts
   |
device authentication
   |
vault unlock
   |
keys available in memory
   |
lock / runtime ends / reload
   |
keys discarded from memory
```

The initial web design treats one JavaScript runtime as one unlocked session. Keys are not broadcast between tabs.

Higher-level application code should preferably request cryptographic operations through an abstraction rather than receiving raw WorkspaceKey bytes directly.

## 15. Security state

Authorization state is not a CRDT.

It is represented by signed transitions that are applied in a single linear order to a materialized current state. A permanent server-side transition history is not required.

```text
CreateWorkspace(A)
      |
      v
AddDevice(B)
      |
      v
AddDevice(C)
      |
      v
RevokeDevice(B, epoch = 2)
      |
      v
CurrentSecurityState
```

### 15.1 Current state

Conceptually:

```ts
type SecurityState = {
  protocolVersion: 1;
  workspaceId: WorkspaceId;
  sequence: number;
  headHash: Uint8Array;
  keyEpoch: number;
  devices: AuthorizedDevice[];
};
```

An authorized device contains:

```ts
type AuthorizedDevice = {
  deviceId: DeviceId;
  encryptionPublicKey: Uint8Array;
  signingPublicKey: Uint8Array;
  addedAtSequence: number;
};
```

Presence in the current device set means authorized. Revoked devices do not need a `status: "revoked"` entry in the materialized state; removal from the authorized set is sufficient for authorization decisions.

## 16. Security transitions

The initial protocol has only three security transitions:

```text
CreateWorkspace
AddDevice
RevokeDevice
```

Each transition includes at least:

- protocol version;
- WorkspaceId;
- sequence;
- previous transition hash;
- operation-specific fields;
- signer DeviceId, except where the initial transition defines the first device;
- signature.

### 16.1 CreateWorkspace

The first transition creates the root of trust.

```text
CreateWorkspace
├── sequence = 0
├── previousHash = null
├── keyEpoch = 1
└── initialDevice
    ├── DeviceId
    ├── encryptionPublicKey
    └── signingPublicKey
```

### 16.2 AddDevice

```text
AddDevice
├── sequence = current.sequence + 1
├── previousHash = current.headHash
├── newDevice
│   ├── DeviceId
│   ├── encryptionPublicKey
│   └── signingPublicKey
└── signerDeviceId
```

The signer must be present in the current authorized-device set. The new
DeviceId must not already be authorized. AddDevice does not advance keyEpoch.

The unsigned AddDevice logical object is encoded with the same RFC 8949
deterministic CBOR rules as CreateWorkspace and signed with the authorized
signer's Ed25519 key. The new head is SHA-256 of the deterministic-CBOR
encoding of the complete signed AddDevice transition.

The resulting SecurityState advances sequence by one, keeps the current
keyEpoch, adds the new device with `addedAtSequence = sequence`, and stores
authorized devices sorted by DeviceId because the device collection is
logically unordered.

Adding a device does not require rotating the WorkspaceKey. The current WorkspaceKey
is delivered to the newly authorized device only after the transition has been
committed.

### 16.3 RevokeDevice

```text
RevokeDevice
├── next sequence
├── previousHash
├── revoked DeviceId
├── newKeyEpoch = old + 1
└── signerDeviceId
```

Revocation and key-epoch advancement are one atomic security transition. The
signer and revoked device must both be present in the current authorized-device
set, the signer may not revoke itself, and `newKeyEpoch` must equal the current
epoch plus one.

The unsigned RevokeDevice logical object is encoded with the same RFC 8949
deterministic CBOR rules as the other security transitions and signed with the
authorized signer's Ed25519 key. The new head is SHA-256 of the deterministic
CBOR encoding of the complete signed RevokeDevice transition. The resulting
SecurityState advances sequence and keyEpoch together and removes the revoked
device from the authorized set.

## 17. Transition ordering

A Durable Object acts as the authoritative sequencer.

A security update succeeds only if it extends the current head.

Conceptually:

```text
client:
  expected head = H10
  proposed transition -> H11

Durable Object:
  if current head != H10:
      reject conflict

  verify signature
  verify signer is authorized in previous state
  validate transition
  atomically commit the new head
  update materialized state
```

This prevents two concurrent security changes from silently creating divergent authorization histories.

The server determines ordering but cannot forge valid transitions because transitions are signed by authorized device keys.

Devices remember the latest locally verified SecurityState sequence/head. After
Device Vault unlock, a Workspace whose encrypted data, WorkspaceKey, and verified
SecurityState are already present locally may be opened immediately from that
local state.

Coordinator freshness reconciliation then runs as an online/background concern
through `GET /workspaces/:workspaceId/security`. Failure to reach the coordinator
does not invalidate the locally verified state and must not block local
read/edit/export.

If the coordinator reports the same state, no update is needed. A lower
coordinator sequence/head is treated as a rollback or coordination error and is
never adopted. If the coordinator reports a higher state, the materialized
state alone is not trusted: the client fetches every unseen signed transition,
verifies the chain from its locally verified head, derives each successive
state, and only then adopts the newer SecurityState.

A coordination error may disable operations which require current online
membership, such as AddDevice, RevokeDevice, presence authentication, or new
peer rendezvous, while leaving the local Workspace usable.

## 18. Canonical security encoding

Signed security data must have one deterministic byte representation.

Protocol version 1 uses RFC 8949 deterministic CBOR. The implementation uses
`cborg` with `rfc8949EncodeOptions`.

For `CreateWorkspace`, the signing and head-hash rules are:

```text
CreateWorkspace without signature
        |
deterministic CBOR
        |
Ed25519 sign with initial device
        |
Signed CreateWorkspace
        |
deterministic CBOR
        |
SHA-256
        |
SecurityState.headHash
```

The initial device is implicitly the signer of `CreateWorkspace`; the transition
does not carry a separate `signerDeviceId`. The signature covers every other
field in the transition, including the initial device public identity.

Normalization includes rules such as sorting logically unordered device
collections by DeviceId before encoding when such collections are introduced.
`CreateWorkspace` contains only one device and therefore needs no collection
sorting.

A locally generated and verified `CreateWorkspace` is only a bootstrap
candidate. It is not persisted as the authoritative `SecurityState` until the
Workspace coordinator accepts and commits it. This keeps locally constructed but
uncommitted security state distinct from committed authorization state.

The HTTP transport representation is separate from the signed representation.
Security transitions and SecurityState are carried as JSON with binary fields
encoded as canonical base64url strings. The Workspace coordinator parses and
validates that logical object, reconstructs the deterministic CBOR signing
bytes, verifies the Ed25519 signature, recomputes the signed-transition
SHA-256 head hash, and derives the materialized SecurityState itself.

For the initial `CreateWorkspace`, `WorkspaceCoordinatorDO(WorkspaceId)` atomically
stores the resulting materialized state only when no state exists yet. Repeating
the exact same CreateWorkspace is idempotent and returns the existing state.
Attempting to initialize the same WorkspaceId with a different head is rejected.

The client accepts the coordinator response only when it exactly matches the
locally derived candidate state. Only then is the committed SecurityState stored
in local IndexedDB. The local storage keeps the latest verified materialized
state and head, not a permanent transition audit log.

These rules avoid signature failures caused by semantically equivalent but
byte-wise different serializations and define one stable value for the security
head hash.

## 19. Invitation and pairing

Adding a device begins with a short-lived invitation.

The invitation server issues only a rendezvous identifier. The existing authorized device generates the secret locally.

```text
Existing device A:
  authenticate its Workspace presence
  request InviteId over the authenticated presence channel
  generate PairingSecret locally
```

The QR code / invite URL has the form:

```text
https://<app>/join/v1/<InviteId>#s=<PairingSecret>
```

Where:

- `InviteId` is a random 128-bit server-visible rendezvous token;
- `PairingSecret` is a random 256-bit secret generated by the inviter;
- the fragment is not sent in the normal HTTP request to the server.

The fragment should contain only capability secret material. WorkspaceKey, WorkspaceId, SDP, ICE candidates, and device keys do not belong in the fragment.

### 19.1 Pairing flow

```text
A creates invite
  |
B scans QR
  |
B unlocks or creates its local Device Vault
  |
B claims InviteId through Cloudflare
  |
Cloudflare rendezvous connects A and B
  |
PairingSecret mutually authenticates temporary pairing channel
  |
B sends its Device Vault public identity to A
  |
A displays candidate DeviceId and requires explicit confirmation
  |
A signs and submits AddDevice(B)
  |
Durable Object verifies sequence / previousHash / signer / signature
  |
Durable Object commits transition
  |
A verifies and stores committed SecurityState
  |
A seals current WorkspaceKey envelope to B
  |
B opens envelope and validates WorkspaceId / epoch / DeviceId / security head
  |
B stores WorkspaceKey + committed SecurityState
  |
B sends workspace-key-stored ACK
  |
A consumes invite
  |
normal encrypted P2P synchronization begins
```

Possessing an invite does not itself authorize a device. Authorization occurs only after the signed `AddDevice` transition is accepted by the sequencer.

Before an existing device signs `AddDevice`, the application should require
explicit local confirmation of the candidate device. The confirmation UI may
later include non-authoritative connection metadata such as the source IP
observed by Cloudflare during invite claim. Such metadata is only contextual
information for the user and is not part of device identity or the signed
SecurityTransition.

Before any Workspace synchronization or device-key exchange, both peers authenticate
the WebRTC pairing channel using `PairingSecret`. The initial protocol uses
HMAC-SHA-256 challenge-response with fresh nonces from both peers. The proof
transcript binds the InviteId, WorkspaceId, SessionId, both nonces, and prover role,
so a proof from another invitation or signaling session cannot be replayed.
Pairing authentication is separate from device authorization: a peer that knows
the PairingSecret is still not an authorized Workspace device until `AddDevice`
has been committed.

Before authorization succeeds, the joining device must not adopt the claimed
Workspace as its persistent local Workspace. The joining side uses its already
unlocked local Device Vault identity during pairing, but it does not create or
synchronize Workspace data during this stage. Persistent Workspace adoption and
normal synchronization begin only after authorization and WorkspaceKey delivery
succeed.

After the joining device has durably stored the WorkspaceKey and committed
SecurityState, the browser may replace the one-time join URL in history, but it
does not immediately reload the application. The completion UI provides an
explicit "Open Floe Note" action that navigates to the normal application URL.
This avoids tearing down the current runtime while the stored acknowledgement
is still propagating on the existing DataChannel, and prevents a later reload
from attempting to claim the already-used invitation again.

Invitations should be:

- one-time;
- short-lived;
- atomically claimable;
- cancellable/expirable.

The first version uses `waiting -> claimed -> consumed`, with
`cancelled` and `expired` as terminal states. Claim is atomic: once one
device has claimed an InviteId, another claimant must not receive its WorkspaceId
or SessionId.

## 20. Key rotation and revocation

Revoking a device creates a new WorkspaceKey and increments the key epoch.

```text
Before:
  epoch 4
  K4
  devices = {A, B, C}

Revoke B

After:
  epoch 5
  K5
  devices = {A, C}
```

Only remaining authorized devices receive K5.

The revoking device prepares K5 ephemerally inside the unlocked Device Vault
and seals it independently to every device remaining in the candidate
SecurityState, including itself. Raw K5 is zeroed without first being persisted.
Each sealed envelope is bound to WorkspaceId, keyEpoch, recipient DeviceId, and
the security head of the RevokeDevice state that created that key epoch. The
revoking device additionally signs the complete sealed-envelope record with its
device signing key. That rotation-time security head remains part of the
envelope context even if a later AddDevice advances SecurityState.headHash
without changing keyEpoch.

The RevokeDevice transition and the signed sealed envelopes are submitted
together. The WorkspaceCoordinator verifies the RevokeDevice signature, derives
the candidate SecurityState, verifies that exactly every remaining authorized
device has one correctly signed envelope, and stores the new SecurityState,
transition, and envelopes in one Durable Object transaction. The coordinator
therefore acts only as an opaque mailbox and never receives the plaintext
WorkspaceKey.

After commit, each remaining device fetches only its own signed sealed envelope,
verifies that it targets the current Workspace and key epoch and that its signer
is currently authorized, then verifies the complete envelope signature. The
Device Vault opens the sealed key with the authenticated rotation-time security
head carried by the envelope, not the latest SecurityState head, and then
persists K5. A presence connection tied to the old security head is invalidated;
an unlocked client uses that invalidation to run SecurityTransition catch-up and
acquire the current key automatically.

A revoked device may retain data and keys it obtained before revocation. Cryptography cannot make already disclosed plaintext disappear.

Therefore revocation means:

> A revoked device must not gain access to Workspace data protected under future key epochs.

Existing data may be migrated lazily to the new key epoch instead of re-encrypting the entire Workspace immediately.

The exact old-key retention and lazy re-encryption policy remains to be specified.

## 21. Local persistence

The persistent source of truth on a device is encrypted serialized application
state. IndexedDB is accessed through Dexie.

Manifest and document Loro snapshots are encrypted with the WorkspaceKey using
XChaCha20-Poly1305. Storage encryption is exposed to the persistence layer only
as a capability of an unlocked Device Vault session; raw WorkspaceKey bytes are
not passed into the storage package.

The v1 encrypted storage envelope is:

```text
magic = "FLST"
version = 1
keyEpoch
random 24-byte nonce
ciphertext = complete serialized Loro snapshot
```

The AEAD additional authenticated data binds:

```text
domain separation
WorkspaceId
keyEpoch
record kind = manifest | document
DocumentId for document records
```

The envelope carries keyEpoch so records written under an older epoch remain
self-describing after key rotation. An unlocked Device Vault may decrypt such a
record using the corresponding retained WorkspaceKey, while subsequent persistence
rewrites it under the active epoch. This is the basis for lazy key-rotation
migration; exact old-key garbage collection remains a separate decision.

Conceptually:

```text
device-vault (separate IndexedDB database)
  device identity and encrypted WorkspaceKey entries

workspaces (floe-note-workspaces IndexedDB database)
  WorkspaceId -> local Workspace metadata and active/detached/bootstrap state

security
  WorkspaceId -> latest verified SecurityState and head

manifests
  WorkspaceId -> encrypted serialized Workspace manifest Loro state

documents
  [WorkspaceId, DocumentId] -> encrypted serialized note Loro state
```

Future attachments and derived indexes must use the same Workspace boundary.

Workspace discovery metadata and verified SecurityState are not manifest or note
content and remain outside the WorkspaceKey-encrypted snapshot blobs.

The browser schema is versioned independently from network protocols. The
Workspace-era Dexie database starts at schema v1 under `floe-note-workspaces`.
The old `floe-note` Project-era database, including its plaintext `snapshot`
rows and transitional v3 schema, is never opened as Workspace data. No local
data migration or plaintext fallback is provided for this v0 boundary. The
separate Device Vault database is unaffected.

A Workspace is not loaded, rendered, edited, or watched for persistence until
the Device Vault has been unlocked. For a newly created Workspace, cleartext
Workspace metadata may be created first, but the first manifest/document
snapshot is not persisted until SecurityState bootstrap and WorkspaceKey
creation complete.

Indexes are disposable derived data. They must be reconstructable from
authoritative decrypted document state.

Storage schema version and network protocol version are separate concepts.

## 22. Attachments

Attachments are not stored directly inside Loro containers.

Documents contain references only.

```text
Document body / metadata
        |
        v
attachment:<AttachmentId>

Attachment store
        |
        v
encrypted binary blob
```

Each attachment is addressed by its UUIDv7 `AttachmentId` and maps to an encrypted blob. Content-addressing, deduplication, and attachment garbage collection are outside the core design.

## 23. Backup, Project import/export, and Workspace identity

Floe Note does not define a standalone key-recovery mechanism without content
data. If every device and every copy of the content data are lost, recovering
only encryption keys would not recover Workspace content.

Portable import/export is a Project-level data portability and survivability
concern rather than part of device pairing or authorization. The v1 portable
Floe Project export uses ordinary Markdown plus a JSON manifest and can be
produced entirely from already-local unlocked content without coordinator
availability.

The archive contains no source ProjectId, WorkspaceId, WorkspaceKey,
SecurityState, DeviceId authorization state, key epoch, or coordinator runtime
state. Import into an existing Workspace allocates a new ProjectId and fresh
DocumentIds but keeps the existing Workspace identity and security boundary.
Import during creation of a new Workspace first creates the normal fresh
Workspace security identity and then uses the imported Project as its initial
content. Raw Markdown directory import follows the same Project semantics. See
`project-import-export.md`.

Identity semantics are:

- **Project export:** carries portable content, not Project or Workspace identity.
- **Import into an existing Workspace:** preserve WorkspaceId; allocate a new
  ProjectId and new DocumentIds.
- **Create a new Workspace from import:** allocate a new WorkspaceId,
  WorkspaceKey, SecurityState, ProjectId, and DocumentIds.
- **Future full restore from backup:** preserving WorkspaceId would require a
  separate format and design.

A future full backup/restore format would need the data and cryptographic
material required to restore the original Workspace identity and should remain
independent from the internal IndexedDB schema. That is intentionally separate
from the v1 portable Project export.


## 24. Threat model

The initial security model assumes:

- Cloudflare is not trusted with Workspace plaintext or Workspace keys.
- Signaling/rendezvous information is not inherently trusted.
- Peer identity is verified using the authorized device keys in SecurityState.
- Workspace-scoped control-plane mutations such as invitation creation require a
  currently authorized device; knowledge of WorkspaceId alone is not authority.
- Device private keys and WorkspaceKeys are trusted while the Device Vault is unlocked.
- A revoked device may retain all information it obtained before revocation.
- Encryption at rest protects against direct extraction of stored encrypted Workspace blobs.
- A compromised origin or malicious JavaScript executing inside an unlocked session is outside what storage encryption alone can prevent.
- Availability attacks by the coordination service are possible; confidentiality and authorization should not depend on trusting that service.

### 24.1 Known security limitations

The initial design has several deliberate limitations that should remain
visible rather than being implied away by the use of modern primitives.

- **Sealed boxes do not authenticate the sender.** Anyone who knows a device
  encryption public key can create a valid `crypto_box_seal` ciphertext for
  that device. Floe Note relies on the PairingSecret-authenticated pairing
  channel and committed authorization state for sender context.
- **WorkspaceKey delivery does not provide forward secrecy against later recipient
  device-key compromise.** If an attacker records a sealed WorkspaceKey envelope
  and later obtains that recipient's device encryption private key, the
  recorded envelope can be opened. This is accepted for the initial
  single-user design because compromise of an unlocked or extracted Device
  Vault already exposes stored WorkspaceKeys.
- **Authorization and key delivery are two separate durable events.** A crash or
  network failure can occur after AddDevice commits but before the new device
  durably stores the WorkspaceKey. The stored acknowledgement prevents the
  invitation from being consumed too early. A later pairing with the same
  DeviceId and exact same public keys can resume WorkspaceKey delivery without a
  second AddDevice transition, but broader recovery policy after lost or
  replaced device keys still requires separate design.
- **Revocation cannot erase information already disclosed.** A revoked device
  may retain plaintext, old WorkspaceKeys, and old ciphertext. Rotation only
  prevents access to data encrypted under future key epochs.
- **An authorized device is trusted with the current WorkspaceKey.** Such a device
  can deliberately disclose that key outside Floe Note. Cryptographic
  authorization prevents unauthorized protocol participants from obtaining the
  key through the intended flow; it cannot constrain a device that is already
  legitimately authorized and compromised or malicious.
- **SecurityTransition catch-up requires a complete retained chain from the
  locally verified head.** Normal Workspace open fetches the coordinator's current
  SecurityState. If it is newer, the client fetches every retained signed
  transition after its local sequence, verifies each signer against the
  previously verified state, verifies the signature, checks sequence and
  previousHash continuity through state derivation, recomputes each head hash,
  and finally requires the derived state to equal the coordinator's current
  materialized state before persisting it. If any required transition predates
  transition retention or has been pruned, catch-up fails safely. AddDevice and
  RevokeDevice transitions are both applied through this verified chain.
- **Encrypted sync authenticates possession of a WorkspaceKey, not an individual
  DeviceId.** All devices authorized for the current epoch share the same
  symmetric WorkspaceKey, so any such device can construct a valid encrypted sync
  message. Per-message device signatures are not part of the initial
  single-user protocol.
- **Encrypted sync does not currently reject replayed valid ciphertexts.** A
  network participant that records an application-layer envelope may replay it.
  Loro update imports are designed to tolerate duplicate CRDT updates, but
  replayed control messages such as `hello` can cause redundant work or
  traffic. Strong replay protection is deferred unless a concrete requirement
  justifies per-peer sequence state.
- **Application-layer encryption does not hide all traffic metadata.** The
  current key epoch, ciphertext length, packet timing, and WebRTC/network
  metadata remain observable even though SyncMessage type, DocumentId, and Loro
  bytes are encrypted.
- **The coordinator observes authorized-device presence metadata.** Presence
  authentication necessarily reveals WorkspaceId and DeviceId to the Workspace
  coordinator while a device is online, together with connection timing. It
  does not reveal WorkspaceKey, note contents, or device private keys. Hiding the
  online-device graph from the coordination service is not a goal of the
  current reconnect design.
- **Automatic reconnect is currently best-effort while presence is stable.**
  Presence changes cause stale peer connections to be closed and new online
  device pairs to rendezvous automatically. A WebRTC connection that enters a
  terminal failed/closed state is cleaned up, but repeated ICE retry/backoff
  while both presence sockets remain continuously online is not yet a separate
  recovery protocol.
- **Encrypted local persistence still exposes storage metadata.** WorkspaceId,
  DocumentId, local-slot metadata, record counts, ciphertext sizes, and the
  storage envelope keyEpoch remain observable in IndexedDB. Note titles,
  document bodies, manifest state, and serialized Loro snapshots are inside the
  encrypted payload. Hiding local index identifiers is not a goal of the
  initial storage format.
- **Legacy manual WebRTC development transports remain plaintext.** The manual
  SDP/signaling paths predate the security bootstrap and are exposed only in
  development builds. The old manual join paths no longer have a plaintext
  persistence fallback: persistent Workspace adoption requires an unlocked Device
  Vault and WorkspaceKey. They must not be treated as the normal authorized-device
  synchronization path. Normal same-browser BroadcastChannel synchronization
  and production WebRTC synchronization are both wrapped in WorkspaceKey-protected
  application-layer encryption.

This threat model should be revisited before a security-sensitive public release.

## 25. Technology stack

These implementation choices sit behind the architectural boundaries defined above.

| Layer | Choice |
| --- | --- |
| Language | TypeScript |
| Package management | pnpm workspace |
| Web application | React + Vite + PWA |
| Markdown editor | CodeMirror 6 |
| CRDT | Loro |
| Editor/CRDT bridge | Loro CodeMirror integration |
| Local persistence | Dexie + IndexedDB |
| P2P transport | WebRTC DataChannel |
| Coordination | Cloudflare Workers + Durable Objects |
| Cryptography | libsodium |
| Workspace-data AEAD | XChaCha20-Poly1305 |
| Security serialization | deterministic CBOR |
| Vault unlock | WebAuthn PRF |
| Testing | Vitest + Playwright |
| Native packaging later | Tauri 2 |

The application should depend on interfaces around storage, transport, cryptography, and vault access so these implementation choices can be replaced without changing the domain model.

## 26. Suggested module boundaries

A future repository structure may look like:

```text
apps/
├── web/
└── worker/

packages/
├── domain/
├── document/
├── editor/
├── storage/
├── crypto/
├── security/
├── sync/
└── transport/
```

The important dependency direction is:

```text
UI
 |
Application
 |---------------------------|
 |             |             |
Document      Sync        WorkspaceCrypto
 |             |             |
Loro        Transport        Vault
               |
             WebRTC
```

React components should not directly manipulate IndexedDB, `RTCPeerConnection`, libsodium primitives, or raw WorkspaceKeys.

Coordinator access should remain an application-layer concern. Document logic,
local persistence, and portable export must not require coordinator network I/O;
the application layer combines those local capabilities with coordinator state
for cross-device coordination and device management.

## 27. Open decisions

The following details can be specified independently without changing the
Workspace, Document, synchronization, and security boundaries:

1. Old-WorkspaceKey garbage collection and migration of ciphertext after key rotation.
2. General WorkspaceKey re-delivery/recovery after an AddDevice commit outlives its pairing session.
3. SecurityTransition retention/pruning policy once devices can safely declare
   that older transition history is no longer required.
4. Document tombstone garbage collection.
5. Future full backup/restore format for preserving the original Workspace identity.
6. Background synchronization strategy.
7. Detailed synchronization protocol-version negotiation beyond the current encrypted envelope.
9. Optional replay protection / per-peer encrypted-sync sequencing if later required.

These details should be introduced only when required by an implementation or product requirement.

## Browser URL semantics

The web client uses normal pathname routing rather than hash routing. Persistent
navigation state has stable URLs:

```text
/                                  application entry point
/settings                          device/app settings
/w/:workspaceId                    Workspace entry point
/w/:workspaceId/n/:noteId          active note
/w/:workspaceId/settings           Workspace settings
/w/:workspaceId/trash              Trash
/w/:workspaceId/trash/:noteId      deleted note
/join/v1/:inviteId#s=:secret       device invitation
```

The sidebar keeps notes as the everyday surface: the compact top-left context
switches Workspaces, while a Project selector chooses the active organization
context inside the Workspace. The lower device/sync status opens quick device
actions. The Settings entry connects general device preferences at `/settings`
with Workspace name, authorized devices, and local-only removal at
`/w/:workspaceId/settings`. A blank first-run Workspace uses `Personal` with
an initial `Notes` Project.

Project membership is deliberately absent from canonical Note URLs. Moving a
Note between Projects therefore does not change its identity or URL. Project
selection is local UI state rather than a persistent route component; v1 does
not add a canonical Project pathname.

When an active Note is opened through its canonical URL, browser Back/Forward,
global search, backlinks, or another Workspace-wide active-Note surface, the
local selected Project follows that Note's current Project membership so the
Project selector, sidebar, and editor remain consistent. For example, opening a
Project A Note while Project B is selected switches the local Project context to
Project A without changing the URL.

A remembered Project that is no longer active is discarded. When no active Note
determines the context, the UI may choose another available active Project using
the existing Project-list ordering. If no active Project exists, Project
selection is null and the Workspace shows an empty state for creating a Project
or reopening an archived Project. This selection behavior is local and is not
synchronized.

Workspace and note path components are their immutable UUIDv7 identifiers;
titles and note contents never appear in URLs. Unknown local Workspaces,
notes, purged notes, and malformed identifiers are handled as
application-level not-found states after unlock. Cloudflare and the PWA keep
serving the SPA shell for nested-path reloads.

Ordinary user navigation between persistent surfaces uses the History API and
adds an entry. Canonicalization caused by application state uses history
replacement instead: the root and Workspace entry points resolve to the
appropriate note, deleted-note active URLs resolve to their Trash URL, and
delete/restore/purge mutations replace the current resource URL. Browser
Back/Forward is restored from `popstate` without a full reload.

The invitation fragment remains a deliberate security boundary. The
`PairingSecret` stays in `#s=...` so it is not sent to the coordinator or
HTTP server and is never moved into the pathname, query string, browser
storage, or `history.state`. Successful joining replaces the invitation history
entry with a canonical Workspace URL, removing the secret-bearing fragment.
WorkspaceId and DocumentId are accepted as URL metadata. The web security
headers retain `Referrer-Policy: no-referrer` so that metadata is not
propagated as an HTTP referrer.
