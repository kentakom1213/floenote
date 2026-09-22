import type { DeviceId, ProjectId } from "@floe-note/domain";

import type {
  DevicePublicIdentity,
  SecurityProtocolVersion,
} from "./state.js";

type TransitionBase = {
  protocolVersion: SecurityProtocolVersion;
  projectId: ProjectId;
};

type SignedTransitionBase = TransitionBase & {
  signature: Uint8Array;
};

export type UnsignedCreateProjectTransition = TransitionBase & {
  type: "create-project";
  sequence: 0;
  previousHash: null;
  keyEpoch: 1;
  initialDevice: DevicePublicIdentity;
};

export type CreateProjectTransition = UnsignedCreateProjectTransition &
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

export type RevokeDeviceTransition = SignedTransitionBase & {
  type: "revoke-device";
  sequence: number;
  previousHash: Uint8Array;
  revokedDeviceId: DeviceId;
  newKeyEpoch: number;
  signerDeviceId: DeviceId;
};

export type SecurityTransition =
  | CreateProjectTransition
  | AddDeviceTransition
  | RevokeDeviceTransition;
