# Floe Note Architecture

> Status: Draft design baseline  
> Scope: single-user, multi-device, local-first note synchronization

This document records the current architectural decisions for Floe Note. It is intentionally kept as a single document while the design is still being reviewed. Once the architecture stabilizes, protocol, security, storage, and implementation details can be split into separate documents.

## 1. Goals

Floe Note is a privacy-oriented, local-first note application for one person using multiple devices.

The core goals are:

- Notes remain available offline.
- Devices synchronize directly over peer-to-peer connections when possible.
- The server coordinates peers but does not store note contents or project encryption keys.
- Concurrent edits are merged by a CRDT rather than by application-specific conflict resolution.
- Persistent data is encrypted at rest and in transit at the application layer.
- The architecture should remain usable from the web first, while allowing native wrappers later.
- Security-critical state is kept separate from collaborative document state.

### Non-goals for the initial design

The following are explicitly out of scope for the first version:

- multi-user collaboration;
- roles and permissions between different users;
- server-side document synchronization or document storage;
- a custom rich-text document format;
- folders, backlinks, full-text search, and other higher-level organization features;
- background synchronization when no application runtime is active.

If multi-user collaboration becomes a requirement, it should be treated as a separate project rather than an incremental extension of this security model.

## 2. Core invariants

The following decisions are considered architectural invariants unless there is a strong reason to revisit them.

1. A **Project** is the synchronization and cryptographic boundary.
2. A Project primarily owns a **set of documents**.
3. One **Document** is one independent **LoroDoc**.
4. Document bodies are Markdown stored in **LoroText**.
5. Collaborative metadata is stored in Loro containers, primarily **LoroMap**.
6. Collaborative conflict resolution is delegated to **Loro**.
7. Security authorization state is **not** a CRDT.
8. Project data is encrypted with a Project-level symmetric key.
9. Device authorization is represented by a signed, linearly ordered security history.
10. Cloudflare coordinates rendezvous and security-state ordering, but never receives plaintext project data or ProjectKeys.

## 3. System overview

```text
                         Cloudflare

                ProjectCoordinatorDO(P)
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

Project data:
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
ProjectId     -> UUIDv7
DocumentId    -> UUIDv7
DeviceId      -> UUIDv7
AttachmentId  -> UUIDv7
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

## 6. Project model

A Project is conceptually:

```text
Project
├── ProjectId
├── SecurityState
├── Manifest: LoroDoc
├── Documents
│   ├── DocumentId -> LoroDoc
│   └── ...
└── Attachments
    ├── AttachmentId -> encrypted blob
    └── ...
```

The Project itself is intentionally small. It does not contain all note contents in one CRDT document.

### 6.1 Project manifest

The Project manifest is a LoroDoc that tracks the document set.

Conceptually:

```text
Manifest
└── documents: LoroMap
    ├── DocumentId A -> active
    ├── DocumentId B -> deleted
    └── DocumentId C -> active
```

The manifest should contain as little duplicated document metadata as possible.

In particular, the document title should not be authoritative in both the manifest and the document itself. Local indexes may cache titles for efficient listing, but those indexes are derived state.

### 6.2 Deletion

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
- the project document manifest.

Security authorization is explicitly excluded from this rule and is handled separately.

## 9. Synchronization model

Synchronization operates at three object classes:

```text
Project Manifest
Document
Attachment
```

A typical synchronization flow is:

```text
1. synchronize Project manifest
2. discover differences in the document set
3. synchronize required Document Loro states
4. synchronize required attachments
```

Documents are independent synchronization units. Opening a Project does not require loading every document into memory.

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

## 10. Peer-to-peer topology

The initial topology can be a full mesh because the product is designed for one person's relatively small number of devices.

```text
A ----- B
| \   / |
|  \ /  |
|   X   |
|  / \  |
| /   \ |
C ----- D
```

Cloudflare is needed only to bootstrap connectivity.

Once one device has joined the existing peer network, already connected peers can introduce additional peers and relay WebRTC signaling messages over existing DataChannels.

For example:

```text
D joins through Cloudflare and reaches A.

D <-> A

A tells D about B and C.

D -> A -> B  (offer)
B -> A -> D  (answer / ICE)

D <-> B

The same process can be repeated for C.
```

The central signaling service remains available as a fallback.

## 11. Cloudflare coordination

The current design uses Cloudflare Workers and Durable Objects.

Each Project maps to one logical coordinator:

```text
ProjectId P
   |
   v
ProjectCoordinatorDO(P)
```

The Durable Object has two distinct responsibilities.

### 11.1 Persistent security coordination

Persistent state includes:

- the signed security transition log;
- the current materialized SecurityState;
- current sequence/head hash;
- current key epoch.

### 11.2 Ephemeral rendezvous and signaling

Ephemeral coordination includes:

- online device sessions;
- pending invitations;
- WebSocket rendezvous;
- initial WebRTC offer/answer/ICE forwarding.

WebSocket Hibernation should be used where appropriate so idle connections do not require an actively running object.

The Durable Object must not store:

- ProjectKeys;
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
│   └── ProjectKey delivery / wrapping
└── signing key pair
    └── SecurityTransition signatures
```

Encryption and signing keys are separated by purpose.

Device display names such as "Laptop" or "Phone" are not security-critical identity and should not be part of the signed authorization state unless needed later.

## 13. Project keys

Each Project has a symmetric ProjectKey.

```text
Project
├── keyEpoch = n
└── ProjectKey Kn
```

The ProjectKey encrypts:

- Project manifest persistence;
- Document persistence and synchronization payloads;
- attachments.

ProjectKeys are random symmetric keys. They are not derived from a user password.

The current intended AEAD is XChaCha20-Poly1305 through libsodium.

Encrypted envelopes should authenticate unencrypted routing metadata, such as:

- protocol version;
- ProjectId;
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
     ├── ProjectKey A
     ├── ProjectKey B
     └── ...
```

For the web implementation, WebAuthn PRF is the preferred mechanism for deriving/unlocking the vault key when supported.

A fallback strategy is still to be finalized.

For future native applications, the same abstraction can use platform key stores such as a system keychain/keystore.

### 14.1 Unlock lifetime

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

Higher-level application code should preferably request cryptographic operations through an abstraction rather than receiving raw ProjectKey bytes directly.

## 15. Security state

Authorization state is not a CRDT.

It is represented as a linearly ordered, signed transition history plus a materialized current state.

```text
CreateProject(A)
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
  projectId: ProjectId;
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

Presence in the current device set means authorized. Revoked devices do not need a `status: "revoked"` entry in the materialized state because revocation history remains available in the transition log.

## 16. Security transitions

The initial protocol has only three security transitions:

```text
CreateProject
AddDevice
RevokeDevice
```

Each transition includes at least:

- protocol version;
- ProjectId;
- sequence;
- previous transition hash;
- operation-specific fields;
- signer DeviceId, except where the initial transition defines the first device;
- signature.

### 16.1 CreateProject

The first transition creates the root of trust.

```text
CreateProject
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
├── next sequence
├── previousHash
├── new device identity/public keys
└── signerDeviceId
```

Adding a device does not require rotating the ProjectKey. The current ProjectKey is delivered to the newly authorized device after the transition has been committed.

### 16.3 RevokeDevice

```text
RevokeDevice
├── next sequence
├── previousHash
├── revoked DeviceId
├── newKeyEpoch = old + 1
└── signerDeviceId
```

Revocation and key-epoch advancement are one atomic security transition.

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
  append transition
  update materialized state
```

This prevents two concurrent security changes from silently creating divergent authorization histories.

The server determines ordering but cannot forge valid transitions because transitions are signed by authorized device keys.

Devices should remember the latest security sequence/head they have observed so obvious server-side rollback can be rejected.

## 18. Canonical security encoding

Signed security data must have one deterministic byte representation.

The current choice is:

```text
logical security object
        |
      normalize
        |
deterministic CBOR
        |
       bytes
        |
      hash/sign
```

Normalization includes rules such as sorting logically unordered device collections by DeviceId.

This avoids signature failures caused by semantically equivalent but byte-wise different serializations.

The exact CBOR library remains to be selected.

## 19. Invitation and pairing

Adding a device begins with a short-lived invitation.

The invitation server issues only a rendezvous identifier. The existing authorized device generates the secret locally.

```text
Existing device A:
  request InviteId from coordinator
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

The fragment should contain only capability secret material. ProjectKey, ProjectId, SDP, ICE candidates, and device keys do not belong in the fragment.

### 19.1 Pairing flow

```text
A creates invite
  |
B scans QR
  |
B claims InviteId through Cloudflare
  |
Cloudflare rendezvous connects A and B
  |
PairingSecret authenticates/protects temporary pairing session
  |
B generates DeviceId + device key pairs
  |
B sends public keys to A
  |
A submits AddDevice(B)
  |
Durable Object commits transition
  |
A verifies committed state
  |
A wraps/delivers current ProjectKey to B
  |
invite consumed
  |
normal P2P synchronization begins
```

Possessing an invite does not itself authorize a device. Authorization occurs only after the signed `AddDevice` transition is accepted by the sequencer.

Invitations should be:

- one-time;
- short-lived;
- atomically claimable;
- cancellable/expirable.

A state such as `waiting -> claimed -> consumed` is sufficient for the first version.

## 20. Key rotation and revocation

Revoking a device creates a new ProjectKey and increments the key epoch.

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

A revoked device may retain data and keys it obtained before revocation. Cryptography cannot make already disclosed plaintext disappear.

Therefore revocation means:

> A revoked device must not gain access to project data protected under future key epochs.

Existing data may be migrated lazily to the new key epoch instead of re-encrypting the entire Project immediately.

The exact old-key retention and lazy re-encryption policy remains to be specified.

## 21. Local persistence

The persistent source of truth on a device is encrypted serialized application state.

The intended storage implementation is IndexedDB through Dexie.

Conceptually:

```text
vault
  device-vault -> encrypted vault blob

projects
  ProjectId -> local project metadata

security
  ProjectId -> latest verified SecurityState
  ProjectId -> transition log cache

manifests
  ProjectId -> encrypted serialized Loro state

documents
  [ProjectId, DocumentId] -> encrypted serialized Loro state

attachments
  [ProjectId, AttachmentId] -> encrypted blob

indexes
  [ProjectId, DocumentId] -> derived title / updatedAt / etc.
```

Indexes are disposable derived data. They must be reconstructable from authoritative decrypted document state.

The implementation should include a storage schema version from the beginning.

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

The exact content-addressing/deduplication strategy is not yet decided.

## 23. Backup and project identity

Backup/restore and duplication have different identity semantics.

- **Restore from backup:** preserve ProjectId.
- **Duplicate/copy project:** generate a new ProjectId.

The long-term export format should be independent from the internal IndexedDB schema.

Recovery-key UX and the exact project-export format are still open design work.

## 24. Threat model

The initial security model assumes:

- Cloudflare is not trusted with project plaintext or project keys.
- Signaling/rendezvous information is not inherently trusted.
- Peer identity is verified using the authorized device keys in SecurityState.
- Device private keys and ProjectKeys are trusted while the Device Vault is unlocked.
- A revoked device may retain all information it obtained before revocation.
- Encryption at rest protects against direct extraction of stored encrypted project blobs.
- A compromised origin or malicious JavaScript executing inside an unlocked session is outside what storage encryption alone can prevent.
- Availability attacks by the coordination service are possible; confidentiality and authorization should not depend on trusting that service.

This threat model should be revisited before a security-sensitive public release.

## 25. Initial technology direction

These are implementation choices, not all architectural invariants.

| Layer | Current direction |
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
| Project-data AEAD | XChaCha20-Poly1305 |
| Security serialization | deterministic CBOR |
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
Document      Sync        ProjectCrypto
 |             |             |
Loro        Transport        Vault
               |
             WebRTC
```

React components should not directly manipulate IndexedDB, `RTCPeerConnection`, libsodium primitives, or raw ProjectKeys.

## 27. Open decisions

The following items are intentionally not yet fixed:

1. Exact recovery-key and disaster-recovery UX.
2. Browser fallback when WebAuthn PRF is unavailable.
3. Exact libsodium APIs for device key exchange/wrapping and transition signatures.
4. Exact deterministic-CBOR library and wire encoding details.
5. Exact old-ProjectKey retention and lazy re-encryption policy.
6. Attachment content-addressing and garbage collection.
7. Document tombstone garbage collection.
8. Stable export/archive format.
9. Background synchronization strategy.
10. Detailed network protocol messages and version-negotiation behavior.

These should be resolved independently without changing the core Project/Document/CRDT/security boundaries above.
