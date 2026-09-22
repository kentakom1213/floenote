# Floe Note Architecture

> Scope: single-user, multi-device, local-first note synchronization

This document defines the architecture of Floe Note. It focuses on stable system boundaries and protocol semantics rather than implementation history. Detailed protocol or subsystem specifications may be split into separate documents when they require independent treatment.

## 1. Goals

Floe Note is a privacy-oriented, local-first note application for one person using multiple devices.

The core goals are:

- Notes remain available offline.
- Project data synchronizes directly between devices over peer-to-peer connections.
- Central coordination is used where it keeps the protocol and implementation simple.
- The coordination service does not store note contents or project encryption keys.
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

1. A **Project** is the synchronization and cryptographic boundary.
2. A Project primarily owns a **set of documents**.
3. One **Document** is one independent **LoroDoc**.
4. Document bodies are Markdown stored in **LoroText**.
5. Collaborative metadata is stored in Loro containers, primarily **LoroMap**.
6. Collaborative conflict resolution is delegated to **Loro**.
7. Security authorization state is **not** a CRDT.
8. Project data is encrypted with a Project-level symmetric key.
9. Device authorization changes are represented by signed, linearly ordered security transitions.
10. Cloudflare coordinates signaling, rendezvous, invitations, and security-state ordering, but never receives plaintext project data or ProjectKeys.
11. Decentralization is not a goal by itself. Coordination remains centralized when decentralizing it would make the implementation or protocol less natural without improving the privacy boundary.

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

## 10. Peer-to-peer connectivity

WebRTC DataChannels carry project synchronization data directly between devices.

Floe Note does not require or maintain a particular peer-to-peer graph topology. In particular, it does not require a full mesh and does not implement peer-relayed signaling as part of the core protocol.

Each online device may maintain a signaling connection to the Project coordinator. WebRTC offer, answer, and ICE messages are relayed through Cloudflare.

```text
Device A ---- WebSocket ----┐
                            │
                     ProjectCoordinatorDO(P)
                            │
Device B ---- WebSocket ----┘

          signaling

              ↓

Device A ===== WebRTC ===== Device B

          project data
```

Additional device pairs can establish direct WebRTC connections as needed. The application should not add mesh-maintenance, leader-election, or peer-introduction protocols unless a concrete requirement later justifies them.


## 11. Cloudflare coordination

Cloudflare Workers and Durable Objects provide the coordination plane.

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

- the current materialized SecurityState;
- the current sequence/head hash;
- the current key epoch.

Security transitions are the update protocol, but the coordinator is not required to retain a permanent audit log of every accepted transition.

### 11.2 Ephemeral rendezvous and signaling

Ephemeral coordination includes:

- online device sessions;
- pending invitations;
- WebSocket rendezvous;
- WebRTC offer/answer/ICE forwarding.

Project-scoped signaling remains in `ProjectCoordinatorDO(ProjectId)`. Because a
join URL intentionally does not expose `ProjectId`, short-lived invitation
lookup is handled by a separate `InvitationCoordinatorDO(InviteId)`. That
object stores only the bootstrap mapping and lifecycle metadata needed to
resolve an invite:

```text
InviteId
  -> ProjectId
  -> SessionId
  -> waiting / claimed / consumed / cancelled / expired
  -> expiresAt
```

The invitation object is not an authorization authority. Claiming an invite
only resolves rendezvous information; device authorization still requires the
signed `AddDevice` flow.

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

Protocol version 1 uses libsodium-generated key pairs:

- device encryption keys: `crypto_box_keypair()` (Curve25519 public-key encryption key material);
- device signing keys: `crypto_sign_keypair()` (Ed25519 signatures).

Both key pairs are generated locally on the device. Only `DeviceId` and the
two public keys are sent over the authenticated pairing channel. Private keys
must never leave the device.

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

The web application requires WebAuthn support. Environments that cannot provide the required WebAuthn-based vault unlock are unsupported rather than routed through a separate password-based fallback.

WebAuthn PRF is used to derive or unlock the vault key. The vault boundary remains abstract so a native application can use an equivalent platform-backed mechanism without changing the Project or synchronization model.

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
XChaCha20-Poly1305. The initial payload contains the long-lived DeviceId and the
device encryption/signing key pairs. ProjectKeys will be added to the same
versioned vault boundary when Project encryption is implemented.

Creating a local Device Vault establishes a device identity, but does not by
itself authorize that device for any Project. Project authorization begins with
the signed SecurityState transitions.

The WebAuthn credential is a vault-unlock mechanism, not the Floe Note device
identity. A synchronized passkey may therefore be reused to unlock independent
local Device Vaults on multiple physical devices. Each local vault still creates
and stores its own DeviceId, device encryption key pair, and device signing key
pair. Reusing the same synchronized passkey does not copy or merge vault
contents and does not make two devices the same authorized device.

The current browser bootstrap creates a WebAuthn credential when no local vault
exists. A later UX may offer "use existing Floe Note passkey" so a discoverable
synchronized credential can be reused instead of creating another credential.

### 14.2 Unlock lifetime

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

It is represented by signed transitions that are applied in a single linear order to a materialized current state. A permanent server-side transition history is not required.

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

Presence in the current device set means authorized. Revoked devices do not need a `status: "revoked"` entry in the materialized state; removal from the authorized set is sufficient for authorization decisions.

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
  atomically commit the new head
  update materialized state
```

This prevents two concurrent security changes from silently creating divergent authorization histories.

The server determines ordering but cannot forge valid transitions because transitions are signed by authorized device keys.

Devices should remember the latest security sequence/head they have observed so obvious server-side rollback can be rejected.

## 18. Canonical security encoding

Signed security data must have one deterministic byte representation.

Protocol version 1 uses RFC 8949 deterministic CBOR. The implementation uses
`cborg` with `rfc8949EncodeOptions`.

For `CreateProject`, the signing and head-hash rules are:

```text
CreateProject without signature
        |
deterministic CBOR
        |
Ed25519 sign with initial device
        |
Signed CreateProject
        |
deterministic CBOR
        |
SHA-256
        |
SecurityState.headHash
```

The initial device is implicitly the signer of `CreateProject`; the transition
does not carry a separate `signerDeviceId`. The signature covers every other
field in the transition, including the initial device public identity.

Normalization includes rules such as sorting logically unordered device
collections by DeviceId before encoding when such collections are introduced.
`CreateProject` contains only one device and therefore needs no collection
sorting.

A locally generated and verified `CreateProject` is only a bootstrap
candidate. It is not persisted as the authoritative `SecurityState` until the
Project coordinator accepts and commits it. This keeps locally constructed but
uncommitted security state distinct from committed authorization state.

The HTTP transport representation is separate from the signed representation.
Security transitions and SecurityState are carried as JSON with binary fields
encoded as canonical base64url strings. The Project coordinator parses and
validates that logical object, reconstructs the deterministic CBOR signing
bytes, verifies the Ed25519 signature, recomputes the signed-transition
SHA-256 head hash, and derives the materialized SecurityState itself.

For the initial `CreateProject`, `ProjectCoordinatorDO(ProjectId)` atomically
stores the resulting materialized state only when no state exists yet. Repeating
the exact same CreateProject is idempotent and returns the existing state.
Attempting to initialize the same ProjectId with a different head is rejected.

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
PairingSecret mutually authenticates temporary pairing channel
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

Before an existing device signs `AddDevice`, the application should require
explicit local confirmation of the candidate device. The confirmation UI may
later include non-authoritative connection metadata such as the source IP
observed by Cloudflare during invite claim. Such metadata is only contextual
information for the user and is not part of device identity or the signed
SecurityTransition.

Before any Project synchronization or device-key exchange, both peers authenticate
the WebRTC pairing channel using `PairingSecret`. The initial protocol uses
HMAC-SHA-256 challenge-response with fresh nonces from both peers. The proof
transcript binds the InviteId, ProjectId, SessionId, both nonces, and prover role,
so a proof from another invitation or signaling session cannot be replayed.
Pairing authentication is separate from device authorization: a peer that knows
the PairingSecret is still not an authorized Project device until `AddDevice`
has been committed.

Before authorization succeeds, the joining device must not adopt the claimed
Project as its persistent local Project. It may construct an in-memory
`NoteProject` keyed by the claimed ProjectId for the temporary pairing flow,
but the existing local default Project and persistent project storage remain
unchanged. Persistent adoption happens only after authorization and ProjectKey
delivery succeed.

Invitations should be:

- one-time;
- short-lived;
- atomically claimable;
- cancellable/expirable.

The first version uses `waiting -> claimed -> consumed`, with
`cancelled` and `expired` as terminal states. Claim is atomic: once one
device has claimed an InviteId, another claimant must not receive its ProjectId
or SessionId.

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
  ProjectId -> latest verified head

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

Each attachment is addressed by its UUIDv7 `AttachmentId` and maps to an encrypted blob. Content-addressing, deduplication, and attachment garbage collection are outside the core design.

## 23. Backup and project identity

Floe Note does not define a standalone key-recovery mechanism without project data. If every device and every copy of the project data are lost, recovering only encryption keys would not recover the Project.

Backup and export are therefore treated as a separate data-backup concern rather than as part of the device-pairing or authorization protocol.

Identity semantics are:

- **Restore from backup:** preserve ProjectId.
- **Duplicate/copy project:** generate a new ProjectId.

A future backup format must contain the data and cryptographic material required for restoration and should remain independent from the internal IndexedDB schema.


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
| Project-data AEAD | XChaCha20-Poly1305 |
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
Document      Sync        ProjectCrypto
 |             |             |
Loro        Transport        Vault
               |
             WebRTC
```

React components should not directly manipulate IndexedDB, `RTCPeerConnection`, libsodium primitives, or raw ProjectKeys.

## 27. Open decisions

The following details can be specified independently without changing the core Project, Document, synchronization, and security boundaries:

1. Exact libsodium APIs and envelope format for ProjectKey wrapping.
2. Canonical payload details and validation rules for `AddDevice` and `RevokeDevice`.
3. Old-ProjectKey retention and migration of ciphertext after key rotation.
4. Document tombstone garbage collection.
5. Stable backup/export archive format.
6. Background synchronization strategy.
7. Detailed synchronization message formats and protocol-version negotiation.

These details should be introduced only when required by an implementation or product requirement.