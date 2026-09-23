# Coordinator resilience and Project survivability

Status: design review. This document describes the intended resilience boundary and
evaluates alternative designs. It is not an implementation specification yet.

## 1. Problem statement

Floe Note is local-first, and Project plaintext and ProjectKeys are not stored by
the coordinator. However, the current authorization flow still makes the
coordinator an availability dependency for SecurityState freshness, invitation
bootstrap, signaling, and SecurityTransition serialization.

This creates an undesirable failure path:

```text
create/edit notes on Device A
        |
coordinator becomes unavailable
        |
Device A is now the only usable copy
        |
cannot authorize/transfer to Device B through the normal flow
        |
loss of Device A can become loss of the Project
```

The problem is not primarily that device-management UI becomes unavailable.
The problem is that failure of infrastructure which does not hold Project data
can prevent the user from preserving another usable copy of that data.

## 2. Core invariant

The design should preserve the following invariant:

> Failure or disappearance of a particular coordinator deployment must never
> prevent an unlocked authorized device from preserving a usable copy of its
> Project on another device or durable backup medium.

A weaker but related invariant is:

> A coordinator outage must not make already-local Project data unreadable or
> uneditable.

These are availability/data-survivability requirements. They do not imply that
all membership changes must be fully decentralized.

## 3. Current architecture

The coordinator currently has two different responsibilities.

### 3.1 Ephemeral connectivity

It provides:

- presence;
- peer discovery;
- invitation lookup;
- WebRTC signaling/rendezvous.

These functions help devices find and connect to one another, but do not contain
Project plaintext or ProjectKeys.

### 3.2 Persistent security coordination

It also stores and sequences:

- current materialized SecurityState;
- current sequence/head hash;
- key epoch;
- signed SecurityTransitions used for catch-up.

SecurityState is a linear signed history:

```text
CreateProject(A)
      |
      v
AddDevice(B)
      |
      v
RevokeDevice(B)
      |
      v
...
```

The coordinator is the serialization point. A transition is accepted only when
its `previousHash` equals the coordinator's current head.

This avoids silent authorization forks when multiple authorized devices mutate
membership concurrently.

## 4. Why the current failure mode exists

The current browser bootstrap treats the coordinator's current SecurityState as
part of opening Project security.

Even when a locally verified SecurityState is available, the application asks
the coordinator for its current state before treating local security as ready.
If the request fails, higher-level features which depend on
`localSecurityState` can become unavailable.

AddDevice is even more coordinator-dependent:

```text
pair Device B
    |
Device A signs AddDevice(B)
    |
coordinator commits transition
    |
ProjectKey is delivered to B
```

The current design intentionally does not deliver ProjectKey before commit.
Therefore an unavailable coordinator prevents the normal flow from creating a
second usable copy.

This behavior protects linear authorization history, but it couples data
survivability to control-plane availability.

## 5. What should remain coordinator-dependent

Not every coordinator dependency is a problem.

When more than one device is authorized, independent devices can concurrently
create incompatible transitions from the same head:

```text
             H7
            /  \
 AddDevice(C)   RevokeDevice(B)
      H8a           H8b
```

Resolving this generally requires a sequencer, consensus mechanism, or an
explicit fork-resolution protocol.

Floe Note should not add distributed consensus merely to remove this dependency.
For v1, ordinary membership changes with multiple authorized devices should
continue to require a coordinator.

The coordinator is therefore allowed to remain the normal serialization service.
It should not, however, be the only way to preserve the Project.

## 6. Design options

### Option A: only use cached SecurityState offline

A locally verified SecurityState is immediately usable. Coordinator freshness is
checked in the background.

Benefits:

- low implementation complexity;
- local Project settings and authorization information remain available;
- normal local editing is independent of coordinator availability.

Limit:

- does not by itself solve the one-device rescue problem;
- a new device still cannot receive ProjectKey through the normal AddDevice flow.

This should be implemented regardless of later choices.

### Option B: general offline membership mutations

Allow any authorized device to create AddDevice/RevokeDevice transitions while
the coordinator is unavailable, then reconcile later.

Benefits:

- maximum coordinator independence.

Costs:

- authorization forks become normal;
- requires fork detection and user-visible resolution;
- revocation/key-epoch forks are especially difficult because different branches
  can distribute different ProjectKeys;
- coordinator migration and rejoin semantics become substantially more complex.

This is intentionally out of scope for v1.

### Option C: provisional/recovery device role

Transfer Project data and ProjectKey to a new device without making it part of
canonical SecurityState. Promote it later after the coordinator returns.

Benefits:

- protects data even while membership is unavailable.

Costs:

- introduces another persistent authorization state besides SecurityState;
- every sync and UI path must understand "authorized" versus "provisional";
- promotion, revocation, and stale provisional copies need explicit semantics.

A general provisional-device abstraction is more complexity than the current
requirement justifies.

### Option D: single-authority rescue AddDevice

Permit an offline rescue transition only when the latest locally verified
SecurityState contains exactly one authorized device and that device is the
local signer.

```text
SecurityState: { A }

A --manual/direct pairing--> B

A signs AddDevice(B)
        |
        +-- persist signed transition locally
        +-- derive candidate state { A, B }
        +-- transfer current ProjectKey and Project snapshot to B
        |
coordinator unavailable
```

The important observation is that there is only one authorized signing
authority in this state. There is no independent authorized Device B/C which can
concurrently produce a competing transition.

The implementation still needs to prevent two local browser contexts for the
same Device Vault from racing. A local single-writer mechanism such as
`navigator.locks` plus transactional IndexedDB is sufficient; this is not
distributed consensus.

If a coordinator later contains an unexpected newer/conflicting head, the
pending transition must not be silently forced onto it. The conflict is surfaced
and normal authorization is repaired. The Project data already copied to the
second device remains preserved.

This solves the most dangerous failure path without supporting arbitrary offline
membership mutation.

### Option E: portable Project backup

Export a self-contained Project package which contains enough encrypted data and
cryptographic material to restore access later.

Benefits:

- independent of WebRTC and coordinator availability;
- useful for backup even when networking works;
- gives a final escape hatch from browser/storage failures.

Costs:

- requires a stable export format;
- exported ProjectKey material must itself be protected;
- restore semantics and credential/key wrapping need design;
- overlaps with, but is not identical to, passkey recovery.

This is valuable, but should remain a separate backup feature rather than being
used to complicate Device authorization.

## 7. Recommended minimal v1 resilience model

The recommended v1 stops before general offline membership or automatic
coordinator migration.

### 7.1 Locally authoritative verified state

Once a SecurityState has been cryptographically verified and persisted locally,
it can be used immediately after Device Vault unlock.

Coordinator freshness checking happens asynchronously.

The UI may indicate that coordinator freshness is unknown, but local data access
must continue.

A coordinator response with a lower sequence/head remains a rollback error. A
higher state must still be verified from signed transitions before adoption.

### 7.2 Locally authoritative genesis

`CreateProject` is special: it has a single root signer and no predecessor.

The root Device should be able to persist the signed CreateProject transition,
initial SecurityState, and ProjectKey locally before coordinator registration
succeeds.

The coordinator then registers/mirrors this already-authenticated genesis when
available.

This removes a coordinator dependency from the first usable copy of a Project.

### 7.3 Retain signed SecurityTransitions on devices

Today the coordinator retains transition history, while local Project storage is
primarily centered on the materialized SecurityState.

For Project survivability, each device should retain the signed transition chain
it has verified.

This is expected to be small because membership changes are rare compared with
note edits.

Local retention provides three useful properties:

1. authorization state can be independently re-verified from CreateProject;
2. a new device can receive a self-contained authorization history during
   pairing;
3. future coordinator replacement can bootstrap from client-held signed history
   rather than trusting an opaque materialized state.

This does not require a permanent server-side audit log.

### 7.4 Single-authority rescue pairing

When all of the following are true:

- the Device Vault is unlocked;
- the local SecurityState and transition chain are verified;
- the local device is authorized;
- the current authorized-device set contains exactly one device;
- coordinator-backed AddDevice is unavailable;

the application may offer an explicit rescue transfer.

The rescue flow creates the normal signed `AddDevice` transition locally. It
does not introduce a new `ProvisionalDevice` protocol type.

The transition is marked locally as pending coordinator publication. Both
devices persist the signed transition and derived candidate SecurityState.

After the joining device identity has been authenticated through the pairing
channel, the existing device may deliver the current ProjectKey and a complete
Project snapshot.

This is an explicit exception to the normal "deliver ProjectKey only after
coordinator commit" ordering. It is limited to the single-authority rescue case.

### 7.5 Coordinator-independent rendezvous for rescue

A rescue path cannot rely on the unavailable coordinator for signaling.

v1 only needs one fallback transport. It does not need automatic LAN discovery or
a second signaling service.

The simplest existing direction is manual WebRTC signaling:

```text
A creates pairing material / offer
          |
      copy / QR
          |
B creates answer
          |
      copy / QR
          |
direct encrypted DataChannel
```

The user is explicitly performing a rescue operation, so a less convenient
manual flow is acceptable.

### 7.6 Reconciliation after coordinator recovery

When the configured coordinator becomes reachable again:

- if its head equals the pending transition's previous head, submit and commit
  the transition normally;
- if it already contains the same transition/head, mark the transition
  published;
- if it contains a different newer head, do not merge automatically.

A conflict must be surfaced.

The important guarantee is that coordinator conflict may delay canonical
membership, but does not destroy the copied Project data.

## 8. What happens with multiple devices during an outage

Suppose SecurityState already contains A and B.

If the coordinator disappears:

```text
local read/edit                     allowed
direct connection already alive    allowed
manual data export                 allowed when implemented
view cached authorized devices     allowed
AddDevice(C)                        coordinator required
RevokeDevice                        coordinator required
key-epoch rotation                  coordinator required
```

This is intentional.

At this point the Project already has redundancy across authorized devices.
Avoiding authorization forks is more valuable than making every membership
operation offline-capable.

If the state later returns to exactly one authorized device through a committed
revocation, that remaining device again qualifies for the single-authority
rescue rule.

## 9. Coordinator replacement

Coordinator replacement is desirable, but it is not required to solve the core
data-survivability problem.

The current implementation uses one build-time
`VITE_COORDINATOR_URL`, so coordinator location is not currently replaceable at
runtime.

A future replaceable-coordinator design should treat the endpoint as local
connection configuration rather than Project identity:

```text
ProjectId P
verified signed transition chain
Project data / ProjectKeys
        |
        +--> preferred coordinator URL A

later:
        +--> preferred coordinator URL B
```

A new coordinator can bootstrap only from cryptographically verifiable Project
history, not from an unsigned materialized SecurityState supplied by a client.

Retaining the signed transition chain locally is therefore a prerequisite for a
clean migration protocol.

Migration still has stale/fork concerns. For example, an old authorized device
may hold an older but valid chain. Devices must never accept a coordinator state
older than their latest locally verified head, and divergent heads must fail
closed rather than being automatically merged.

Automatic fork resolution, quorum voting, distributed leader election, and
cross-coordinator consensus are explicitly not part of v1.

## 10. Failure scenarios under the recommended model

### Scenario 1: coordinator unavailable immediately after Project creation

A has:

- signed CreateProject;
- locally verified SecurityState;
- ProjectKey;
- Project data.

A remains usable.

A can rescue-transfer to B using the single-authority path and manual signaling.
Loss of the coordinator alone does not trap the only Project copy.

### Scenario 2: coordinator unavailable with A and B already authorized

Both devices retain usable local state.

If they can still communicate directly, synchronization continues. If they
cannot rediscover each other, manual reconnect may be used later.

New membership changes wait for coordinator availability. Data is already
redundant.

### Scenario 3: coordinator permanently disappears

Existing Project data remains usable.

A single-authority Project can still create a rescue copy.

Normal multi-device membership changes remain unavailable until either a
coordinator is restored or a future coordinator-migration feature is used.

Permanent coordinator replacement is therefore a service-continuity feature,
not a prerequisite for avoiding immediate data loss.

### Scenario 4: server and client heads diverge after an offline rescue

No automatic merge occurs.

Both local copies retain Project data and the rescue ProjectKey.

The application reports an authorization-history conflict and requires a normal
repair/re-pairing flow once an authoritative head is selected.

Data survivability takes precedence over pretending the membership mutation was
successfully published.

## 11. Complexity assessment

The design remains reasonably small if v1 is limited to:

- cached locally verified SecurityState;
- locally persisted CreateProject;
- locally retained signed transition history;
- one manual coordinator-independent pairing mechanism;
- offline AddDevice only from a single-authorized-device state;
- a pending-publication flag for that transition;
- no automatic fork merge.

These concepts reuse existing primitives: DeviceId, SecurityState,
SecurityTransition, pairing authentication, ProjectKey delivery, WebRTC, and
local storage.

The design becomes substantially more complex if v1 additionally attempts any
of the following:

- AddDevice/RevokeDevice from arbitrary multi-device states while offline;
- automatic merge of divergent SecurityState histories;
- a general provisional-device authorization class;
- automatic coordinator failover;
- quorum or consensus among devices;
- peer-relayed signaling/mesh repair;
- backup-key recovery mixed into the membership protocol.

Those features should be deferred until a concrete product requirement demands
them.

## 12. Proposed implementation order

1. Make cached verified SecurityState usable when the coordinator is
   unavailable.
2. Persist the signed CreateProject transition and treat genesis as locally
   valid before coordinator registration.
3. Persist verified SecurityTransitions locally.
4. Define a small local `pendingSecurityTransition` representation.
5. Implement manual rescue pairing for the single-authority case.
6. Reuse the existing AddDevice validation and ProjectKey delivery primitives.
7. Publish pending transitions when the coordinator becomes reachable.
8. Add portable Project export/backup separately.
9. Add coordinator migration only if/when service replacement becomes a product
   requirement.

## 13. Decision summary

The coordinator should remain the normal sequencer for membership, but it must
not be a single point of Project survivability.

The minimal design does **not** make SecurityState a CRDT and does **not** make
all membership operations decentralized.

Instead, it exploits a narrow case where offline authorization is naturally
safe enough to be useful: a Project with exactly one authorized device.

This removes the dangerous "one local copy + coordinator outage = cannot make a
second copy" failure path while keeping the existing linear SecurityState model
and avoiding a general distributed-consensus problem.
