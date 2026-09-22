import type { DeviceId, ProjectId } from "@floe-note/domain";

export const SECURITY_PROTOCOL_VERSION = 1 as const;

export type SecurityProtocolVersion = typeof SECURITY_PROTOCOL_VERSION;

export type DevicePublicIdentity = {
  deviceId: DeviceId;
  encryptionPublicKey: Uint8Array;
  signingPublicKey: Uint8Array;
};

export type AuthorizedDevice = DevicePublicIdentity & {
  addedAtSequence: number;
};

export type SecurityState = {
  protocolVersion: SecurityProtocolVersion;
  projectId: ProjectId;
  sequence: number;
  headHash: Uint8Array;
  keyEpoch: number;
  devices: readonly AuthorizedDevice[];
};
