import type { DeviceId, ProjectId } from "@floe-note/domain";

import type {
  DevicePublicIdentity,
  SecurityProtocolVersion,
} from "./state.js";

type SignedTransitionBase = {
  protocolVersion: SecurityProtocolVersion;
  projectId: ProjectId;
  signature: Uint8Array;
};

export type CreateProjectTransition = SignedTransitionBase & {
  type: "create-project";
  sequence: 0;
  previousHash: null;
  keyEpoch: 1;
  initialDevice: DevicePublicIdentity;
};

export type AddDeviceTransition = SignedTransitionBase & {
  type: "add-device";
  sequence: number;
  previousHash: Uint8Array;
  newDevice: DevicePublicIdentity;
  signerDeviceId: DeviceId;
};

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
