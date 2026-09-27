import type { DeviceId, WorkspaceId } from "@floe-note/domain";

import type {
  DevicePublicIdentity,
  SecurityProtocolVersion,
} from "./state.js";

type TransitionBase = {
  protocolVersion: SecurityProtocolVersion;
  workspaceId: WorkspaceId;
};

type SignedTransitionBase = TransitionBase & {
  signature: Uint8Array;
};

export type UnsignedCreateWorkspaceTransition = TransitionBase & {
  type: "create-workspace";
  sequence: 0;
  previousHash: null;
  keyEpoch: 1;
  initialDevice: DevicePublicIdentity;
};

export type CreateWorkspaceTransition = UnsignedCreateWorkspaceTransition &
  SignedTransitionBase;

export type UnsignedAddDeviceTransition = TransitionBase & {
  type: "add-device";
  sequence: number;
  previousHash: Uint8Array;
  newDevice: DevicePublicIdentity;
  signerDeviceId: DeviceId;
};

export type AddDeviceTransition = UnsignedAddDeviceTransition &
  SignedTransitionBase;

export type UnsignedRevokeDeviceTransition = TransitionBase & {
  type: "revoke-device";
  sequence: number;
  previousHash: Uint8Array;
  revokedDeviceId: DeviceId;
  newKeyEpoch: number;
  signerDeviceId: DeviceId;
};

export type RevokeDeviceTransition = UnsignedRevokeDeviceTransition &
  SignedTransitionBase;

export type SecurityTransition =
  | CreateWorkspaceTransition
  | AddDeviceTransition
  | RevokeDeviceTransition;
