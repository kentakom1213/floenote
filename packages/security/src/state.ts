import type { DeviceId, WorkspaceId } from "@floe-note/domain";

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
  workspaceId: WorkspaceId;
  sequence: number;
  headHash: Uint8Array;
  keyEpoch: number;
  devices: readonly AuthorizedDevice[];
};
