# Floe Note Architecture

> Scope: single-user, multi-device, local-first Markdown notes.

This document records Floe Note's **design decisions (why)** and **invariants
(must)**. Source code and tests define **current implementation behavior (what)**.
An implementation that violates an invariant is a defect; the invariant is not
silently weakened to match the code. Detailed behavior belongs in the linked
specifications and implementation references, not in an inventory of current
classes, messages, or UI steps.

## 1. Overview and goals

Floe Note keeps each user's notes on their own devices. Authorized devices
exchange encrypted changes over peer-to-peer connections; a central coordinator
handles the small set of operations that require shared online authority.

The goals are:

- **Single-user, multi-device:** a Workspace belongs to one user operating
  multiple authorized devices.
- **Local-first:** previously stored notes remain readable and editable without
  a network connection or a coordinator.
- **Direct data synchronization:** WebRTC transports encrypted CRDT updates
  between devices; TURN relaying can assist when direct connectivity fails.
- **Application-layer E2EE:** note content is protected independently of WebRTC,
  TURN, and the coordinator.
- **Simple coordination:** centralize device membership, rendezvous, and
  signaling rather than building consensus into a personal note application.
- **Portable content:** an unlocked device can export ordinary Markdown and
  metadata without service cooperation.

Multi-user collaboration, server-side storage or synchronization of note
content, and background sync without an active application runtime are outside
this architecture. Multi-user collaboration would require a different security
model, not another role in the current one.

## 2. Core invariants

These are contracts for implementations and tests, not statements that every
current code path has already been verified.

1. A **Workspace** is the unit of synchronization, device authorization,
   encryption, and coordinator sequencing. There is no separate Project
   security identity.
2. A **Project** is a flat organizational unit inside one Workspace. Projects
   have no independent keys, membership, coordinator, or transport.
3. Every non-purged **Document** belongs to exactly one Project. Moving a
   Document changes membership, not Document identity.
4. Each Document is an independent **LoroDoc**. Its Markdown body is **LoroText**;
   collaborative document metadata and Workspace metadata use Loro containers.
5. **Loro** resolves concurrent content and metadata operations. Timestamps,
   device priority, and arrival order must not override Loro conflict semantics.
6. **SecurityState is not a CRDT**. Device authorization changes form one
   signed, verified, linearly ordered transition history.
7. Workspace content is encrypted with a symmetric **WorkspaceKey**, selected
   by the committed key epoch. Project boundaries do not change that key.
8. The coordinator can order authorized operations and disclose availability
   metadata, but **must not receive or persist plaintext Workspace content,
   plaintext WorkspaceKeys, or device private keys**.
9. Locally held encrypted content, a usable WorkspaceKey, and previously
   verified SecurityState must suffice for local read, edit, persistence, and
   export after Device Vault unlock. Coordinator availability must not gate
   those operations.
10. **Unlocking a Device Vault does not authorize a device**. Device identity,
    vault access, and Workspace membership are distinct.
11. A new device must not receive a WorkspaceKey or begin Workspace content
    synchronization until committed authorization and authenticated pairing
    have succeeded.
12. Revocation advances the Workspace key epoch atomically with the authorized
    device set. A revoked device must not obtain Workspace data protected
    under later epochs.
13. Persistent Workspace snapshots and normal sync traffic must be encrypted
    at the application layer. Encrypted routing context must be authenticated
    and bound to its Workspace and key epoch.
14. Security freshness must never be established by trusting an unverified
    coordinator snapshot or rolling back a locally verified security head.

Project-specific convergence and cryptographic verification rules below refine
these invariants.

## 3. System boundaries

```text
Web client / application
    |-- Workspace + independent Document LoroDocs
    |       |-- local encrypted persistence (Device Vault capability)
    |       `-- CRDT sync -- encrypted transport -- WebRTC / TURN -- peer
    |
    `-- Coordinator client -- Cloudflare Workers / Durable Objects
                                 (membership, invitations, presence, signaling)
```

| Boundary | Responsibility |
| --- | --- |
| **Web client** | Compose local editing, navigation, an unlocked vault session, synchronization, and online coordination. A failure of online coordination must not become a failure of local document access. |
| **Workspace / Document** | Own collaborative content, Document identity, Project membership, Loro merge semantics, and domain invariant repair. This layer is independent of a particular network transport. |
| **Local storage / Device Vault** | Store encrypted Loro snapshots and verified local security state; protect device private keys and epoch-scoped WorkspaceKeys. Storage consumes vault cryptographic capabilities rather than raw keys. |
| **CRDT synchronization** | Exchange Workspace manifest and Document state/updates without choosing application-level conflict winners. |
| **Encrypted transport** | Protect complete synchronization messages before they cross a WebRTC DataChannel or a local-tab transport. WebRTC encryption alone is not the Workspace trust boundary. |
| **Coordinator** | Sequence signed security transitions and coordinate authorization-gated presence, invitations, signaling, and opaque key envelopes. It is not a document store or a plaintext key custodian. |

The **control plane** is centralized; the **data plane** exchanges encrypted
Workspace content between devices. Peer topology is opportunistic rather than
a protocol guarantee: no full mesh, peer-relayed signaling, leader election,
or distributed membership consensus is required.

## 4. Data and synchronization model

A Workspace manifest is one collaborative LoroDoc for Project metadata and
lifecycle, Document lifecycle and Project membership, tag-color overrides, and
edit-history checkpoint references. Each Document has its own LoroDoc containing
its title, timestamps, tags, and Markdown body. The authoritative title
belongs to the Document; manifest or UI indexes must not become a second
authority for it. A Document's immutable identity is not derived from its
title or Project. Independent Document histories avoid
making the entire note collection one CRDT editing and history unit.

Long-lived Workspace, Project, Document, and Device identities use independently
generated UUIDv7 values; identity must not depend on mutable names. Short-lived
rendezvous and pairing capabilities use cryptographically random tokens instead.
Creation and modification timestamps are display/sort metadata, not causal
clocks or conflict-resolution authority.

**Project convergence.** Concurrent edits can archive a Project on one peer
while another creates or moves an active Document into it. After merging Loro
state, domain normalization must reactivate any Project containing an active
Document. The repair is idempotent and does not impose a minimum of one active
Project: a Workspace with zero active Projects is valid. Archived Projects
cannot be local creation/move targets. Deleted Documents keep tombstones and
Project membership so offline peers can learn the deletion and a restore can
return to the original Project, reactivating it if necessary. Purging and
long-term garbage collection are separate concerns.

**Synchronization.** The manifest and independent Document Loro states cross
the encrypted synchronization boundary. The CRDT engine must not need to know
whether the underlying transport is a remote WebRTC channel or same-browser
BroadcastChannel. In a live session, local and remote updates converge through
Loro; Project invariant repair is applied after merge, not as a competing
conflict resolver. An acknowledgement that another device observed a Document
version is replication metadata, not proof of permanent backup. Such
observations are device-local, not shared Workspace state.

**Edit history** uses references to retained Loro Document history rather
than duplicate note bodies in the Workspace manifest. Restoring a historical
version applies new CRDT operations instead of replacing shared history.
Editor-local Undo/Redo and cross-device edit history are different concepts.
See [edit-history.md](./edit-history.md).

**Search** is derived from unlocked local Workspace data; indexes are
disposable and must not be a second plaintext persistence authority.
See [global-search.md](./global-search.md).

**Portable export** is Project-scoped, unencrypted Markdown/JSON content
portability, not an encrypted Workspace backup or authorization-state restore.
Import into an existing Workspace creates new Project/Document identities
without changing its security boundary; onboarding from an import creates a
fresh Workspace security identity. Project contents can be exported locally
without a coordinator. See
[project-import-export.md](./project-import-export.md).

## 5. Security and trust model

### Device identity and vault

Every local device has distinct long-lived public-key pairs: **Curve25519**
encryption keys for sealed WorkspaceKey delivery and **Ed25519** signing keys
for security transitions and authorized-presence proofs. Private keys are
generated locally and must not leave the device. Display names are not
cryptographic identities.

A WorkspaceKey is a random 256-bit symmetric key, not a password-derived key.
The Device Vault holds key entries indexed by **(WorkspaceId, keyEpoch)** and
exposes scoped encrypt/decrypt and signing operations to higher layers. Only
the initial root device creates the first WorkspaceKey; another device must
obtain a missing key from an authorized device, never generate a substitute.

The browser requires **WebAuthn PRF** for Device Vault unlock, with no separate
password fallback. The PRF result is processed with **HKDF-SHA-256** and the
Floe Note vault domain-separation context to derive a 256-bit VaultKey; the
vault payload is protected by **XChaCha20-Poly1305**. Device signing/encryption
keys and WorkspaceKeys stay inside the encrypted vault at rest and the unlocked
session in memory. Keys must not be shared between tabs by the application.

A WebAuthn credential is an unlock credential, **not** the authorized Floe Note
DeviceId. A synchronized passkey can unlock independently created device
vaults; their DeviceIds, private keys, and Workspace authorizations remain
distinct. An existing authorized DeviceId is unusable without its local vault
secrets, and an unlocked but revoked device is not authorized merely because
its passkey works. Losing the only usable vault or content copy can permanently
lose access; passkey synchronization is not WorkspaceKey recovery.

### Signed authorization state

The current SecurityState binds the protocol version, WorkspaceId, monotonic
sequence, **headHash**, **keyEpoch**, and authorized DeviceIds with their public
encryption/signing keys and addition sequences. Authorized membership is the
current set; a revoked device is removed, not merely marked inactive.

The only membership operations in this model are:

- **CreateWorkspace:** initial trusted device, sequence 0, no previous hash,
  key epoch 1. A local candidate is not committed authorization until accepted
  by the coordinator.
- **AddDevice:** signed by a device authorized in the preceding state; advances
  sequence, links the previous head, and adds a previously unauthorized DeviceId
  and its public keys. It does **not** rotate the key epoch.
- **RevokeDevice:** signed by an authorized device, targeting another authorized
  device (self-revocation is forbidden); advances sequence and **keyEpoch by
  exactly one**, removing the target in the same transition.

**Signature and head contract.** Protocol v1 signs the RFC 8949
deterministic-CBOR encoding of the complete unsigned transition with Ed25519.
The initial device implicitly signs CreateWorkspace; later transitions
identify their signer. The new headHash is **SHA-256 over the deterministic-CBOR
encoding of the complete signed transition**. Logically unordered authorized
device collections are normalized by DeviceId. JSON/base64url transport
representations are not signature bytes. Verification must check signature,
signer authorization in the *previous* state, transition-specific conditions,
sequence, previousHash, and recomputed headHash.

The coordinator atomically orders and commits only valid head-extending
transitions. It must reject conflicting heads and cannot forge a transition
without an authorized private signing key. To catch up, a client must verify
**every** missing signed transition from its locally verified head, derive the
resulting state, and confirm it equals the coordinator's current materialized
state before adopting it. Missing/pruned transitions fail closed; a lower or
conflicting coordinator head must never replace the local verified head.
Locally available Workspace content remains accessible during such online
coordination failures.

A Workspace-scoped presence/control connection must also prove current
authorization: a fresh coordinator challenge is signed with the device key,
binding WorkspaceId, DeviceId, the current security head, and the challenge.
The coordinator verifies this against current membership; knowledge of
WorkspaceId, an invite, or a stale socket alone cannot authorize control-plane
mutations.

### Pairing and WorkspaceKey delivery

A new device is invited through a short-lived, single-claim capability. An
authorized inviter generates a random **256-bit PairingSecret** locally;
the server-visible **InviteId** and signaling **SessionId** are independent
random 128-bit tokens. Only the PairingSecret goes in the URL fragment
(`#s=...`), not the HTTP request; the URL must not embed WorkspaceKeys or
device private keys. Claiming the invitation only establishes rendezvous.

Before the joining device sends its public identity or receives Workspace
secrets, both peers must authenticate their temporary pairing channel with
**HMAC-SHA-256 challenge-response** and fresh nonces from both peers. The proof
transcript binds InviteId, WorkspaceId, SessionId, both nonces, and prover role;
proofs from other invitations or sessions must not be reusable. The inviter
explicitly confirms the joining device's identity before signing AddDevice.

Only **after AddDevice is committed** may the inviter seal the current
WorkspaceKey to the new device's encryption public key using
`crypto_box_seal`. The encrypted envelope binds protocol version,
WorkspaceId, keyEpoch, recipient DeviceId, the committed SecurityState head,
and the key. The recipient checks those fields, stores both the key and
matching committed SecurityState durably, and only then acknowledges storage.
The invitation is consumed only after that acknowledgement; persistent
Workspace adoption and content sync must not precede successful delivery.

A sealed box **does not authenticate its sender**. The sender context instead
comes from the PairingSecret-authenticated channel and committed authorization.
An interrupted delivery may resume for the same DeviceId **only** when both
stored public keys match; it must not submit another AddDevice transition.
A reused DeviceId with different keys is rejected.

### Revocation and key epochs

Revocation creates a **new random WorkspaceKey** for the next key epoch.
The revoking device seals a separate envelope to **each remaining authorized
device (including itself)**, bound to WorkspaceId, recipient DeviceId, new
keyEpoch, and the *rotation-time* SecurityState head. It signs each sealed
envelope with its Ed25519 device key. The coordinator verifies the
RevokeDevice transition, the complete recipient set, and the envelope
signatures, then atomically commits the state transition and opaque envelopes.
It must never see the plaintext key.

A recipient verifies the signed envelope, authorized signer, recipient,
Workspace, epoch, and authenticated **rotation-time** head before opening and
storing the key. A later AddDevice may advance the latest security head without
changing the epoch; it must not invalidate a correct rotation envelope merely
because the latest head differs.

Old epoch keys can be retained for decrypting and migrating already-local
storage. **Live synchronization must reject payloads from any epoch other than
the current committed keyEpoch.** Revocation protects data encrypted under
later epochs, not plaintext, keys, or ciphertext already disclosed to a
revoked device. It does not remotely erase that device.

### Encrypted data boundaries

All normal Workspace synchronization messages, including type and DocumentId,
are encrypted as complete payloads with **XChaCha20-Poly1305** before
transmission over WebRTC or BroadcastChannel. The protocol v1 sync envelope
identifies its format and key epoch and uses a fresh nonce. Its AEAD associated
data binds a domain-separation value, **WorkspaceId**, and **keyEpoch**. A
message valid for one Workspace must not authenticate in another. A recipient
accepts only the committed live key epoch.

Encrypted local manifest and Document snapshots use a separate versioned
storage envelope (`FLST`, version 1), a fresh 24-byte nonce, and
XChaCha20-Poly1305. Authenticated context binds the domain, WorkspaceId,
keyEpoch, record kind, and for document/replication-observation records the
corresponding DocumentId or DeviceId/DocumentId tuple. Epoch tags permit
decryption of retained old-epoch storage when the vault still has that key;
network sync never gets that exception.

Persistent note bodies, titles, and manifest contents are encrypted. IndexedDB
record identities (such as WorkspaceId and DocumentId), counts, ciphertext
sizes, and epochs may remain observable. Verified SecurityState and local
Workspace discovery metadata are outside the encrypted Loro snapshots; this
must not be mistaken for plaintext note-content storage. Unlocked derived
indexes must remain disposable rather than become an unencrypted second copy
of Workspace content.

### Trust assumptions and limitations

- The coordinator, signaling path, and TURN relay may observe routing,
  authorized-presence, connection, and timing metadata. They are **not**
  trusted with Workspace plaintext or keys; they can still deny service.
- Application-layer encryption does not protect against a malicious origin,
  compromised JavaScript within an unlocked session, a compromised authorized
  device, or a device deliberately leaking its WorkspaceKey.
- Sealed key delivery lacks sender authentication on its own and forward
  secrecy against later compromise of the recipient's device encryption
  private key. Pairing/channel authentication and signed authorization are
  separate necessary checks.
- A shared WorkspaceKey authenticates knowledge of the current key, **not a
  particular sender DeviceId**. Per-sync-message device signatures are not
  provided.
- Valid encrypted sync ciphertext is not rejected solely because it has been
  replayed. CRDT update deduplication reduces the effect of duplicate updates,
  but replayed control traffic may cause redundant work.
- The key epoch, ciphertext sizes and timing, local storage identifiers, and
  WebRTC metadata are not concealed by the content encryption.
- Signed-transition catch-up depends on a complete verifiable chain. Lost
  vault credentials, lost content copies, or unavailable key-delivery recovery
  can cause irreversible loss of access. Portable export is not a cryptographic
  Workspace restore.

These are explicit limits on security claims, not permissions to bypass the
authentication, authorization, or key-epoch contracts.

## 6. Coordinator and offline behavior

Cloudflare Workers and Durable Objects provide **centralized online authority**
for SecurityState sequencing, device discovery/presence, one-time invitations,
WebRTC signaling, and opaque rotation envelopes. Centralizing these operations
prevents concurrent membership forks and avoids device-to-device consensus,
quorums, or offline key-epoch reconciliation. The coordinator must not serve
as a fallback note-content repository.

Coordinator access is required to commit Workspace creation, add or revoke
devices, rotate keys, discover new peers, and establish new signaling sessions.
These operations must not be fabricated locally or queued as provisional
authorization states during an outage. An already-established DataChannel may
continue to carry encrypted updates without the coordinator; reconnecting
ordinarily requires online signaling.

On an existing device, unlock and locally verified state are sufficient to
open and use locally stored notes while freshness reconciliation proceeds.
Coordination errors can disable device management or peer discovery but must
not invalidate local editing or unlocked Project export. This boundary
protects **local data ownership**, not availability of peer synchronization.

Connection setup may use direct WebRTC or TURN transport, but relay selection
does not affect content encryption or membership authority. Detailed connection
behavior and operational configuration belong in [turn.md](./turn.md);
coordinator failure modes belong in
[coordinator-resilience.md](./coordinator-resilience.md).

## 7. Design decisions and non-goals

| Decision | Rationale and accepted trade-off |
| --- | --- |
| **Workspace identity separate from Projects** | One security domain per person makes key rotation, membership, and transport comprehensible. Project organization can change without changing cryptographic identity. The trade-off is that Project isolation is organizational, not cryptographic. |
| **One LoroDoc per Document** | Independent histories and updates avoid coupling every note edit to a single giant document. Workspace-wide membership still converges through the manifest. |
| **Loro for content, a sequencer for security** | CRDTs merge offline content edits, but concurrent membership changes can create irreconcilable authorization and key-epoch forks. Signed linear transitions trade offline device administration for one authoritative history. |
| **Central control plane, peer data plane** | Central coordination simplifies discovery and authorization without giving the server custody of plaintext notes. This accepts dependence on the coordinator for starting connections, but not for using already-local data. |
| **Application-layer E2EE, not transport-only security** | Neither signaling infrastructure nor TURN transport is in the Workspace content trust boundary. The Device Vault remains the key custodian. |
| **Portable content distinct from backup/recovery** | Human-readable Markdown/JSON enables exit without the service; it deliberately omits cryptographic identity and historic security state. Treating that export as restorable Workspace credentials would make false recovery promises. |

Floe Note does not pursue multi-user roles, decentralized membership consensus,
mandatory full-mesh connectivity, peer-relayed signaling, server-stored note
snapshots, or generalized recovery machinery. Attachments and a full
identity-preserving backup/restore protocol do not acquire detailed designs
merely because the architecture could accommodate them. Future work must
preserve the Workspace trust boundary before introducing new storage or
synchronization surfaces.

## 8. Implementation references

The linked documents specify focused product and operational behavior;
implementation code and tests remain authoritative for their current mechanics.

- **Workspace, Projects, Documents, Loro invariants:**
  [Project/domain code](../packages/document/src/project.ts),
  [Document code](../packages/document/src/document.ts),
  [Project membership tests](../packages/document/test/project-membership.test.ts),
  [Project persistence tests](../packages/storage/test/project-persistence.test.ts).
- **Sync and encrypted transport:**
  [WorkspaceSyncEngine](../packages/sync/src/workspace-sync-engine.ts),
  [encrypted transport](../packages/sync/src/encrypted-sync-transport.ts),
  [sync tests](../packages/sync/test/workspace-sync-engine.test.ts),
  [workspace crypto](../packages/crypto/src/workspace-sync-crypto.ts).
- **Security transitions and encoding:**
  [transition definitions](../packages/security/src/transition.ts),
  [security state](../packages/security/src/state.ts),
  [transition tests](../packages/security/test/security-transitions.test.ts),
  [authorized presence](../packages/security/src/authorized-presence.ts).
- **Pairing, key delivery, and rotation:**
  [pairing authentication](../packages/pairing/src/pairing-authentication.ts),
  [key delivery](../packages/pairing/src/workspace-key-delivery.ts),
  [rotation envelopes](../packages/security/src/key-rotation-envelope.ts),
  [device bootstrap](../packages/pairing/src/device-bootstrap.ts).
- **Vault, encryption, and local storage:**
  [WebAuthn PRF vault](../packages/vault/src/web-authn-prf-device-vault.ts),
  [vault cryptography](../packages/crypto/src/device-vault-crypto.ts),
  [storage cryptography](../packages/crypto/src/workspace-storage-crypto.ts),
  [encrypted IndexedDB storage](../packages/storage/src/dexie-workspace-storage.ts),
  [vault tests](../packages/vault/test/device-vault.test.ts).
- **Coordinator and offline behavior:**
  [coordinator implementation](../apps/coordinator/src/index.ts),
  [coordinator resilience](./coordinator-resilience.md),
  [TURN relay](./turn.md).
- **Content and UI specifications:**
  [portable Project import/export](./project-import-export.md),
  [edit history](./edit-history.md),
  [global search](./global-search.md),
  [PWA and offline shell](./pwa.md).
