export { SECURITY_PROTOCOL_VERSION } from "./state.js";

export type {
  AuthorizedDevice,
  DevicePublicIdentity,
  SecurityProtocolVersion,
  SecurityState,
} from "./state.js";

export type {
  AddDeviceTransition,
  CreateWorkspaceTransition,
  UnsignedAddDeviceTransition,
  UnsignedRevokeDeviceTransition,
  RevokeDeviceTransition,
  SecurityTransition,
} from "./transition.js";

export {
  SECURITY_HEAD_HASH_BYTES,
  SECURITY_SIGNATURE_BYTES,
  attachCreateWorkspaceSignature,
  createUnsignedCreateWorkspaceTransition,
  deriveInitialSecurityState,
  encodeCreateWorkspaceTransition,
  encodeUnsignedCreateWorkspaceTransition,
} from "./create-workspace.js";

export type { UnsignedCreateWorkspaceTransition } from "./transition.js";

export {
  addDeviceTransitionToWire,
  createWorkspaceTransitionToWire,
  parseAddDeviceWirePayload,
  parseCreateWorkspaceWirePayload,
  parseRevokeDeviceWirePayload,
  parseSecurityStateWirePayload,
  parseSecurityTransitionWirePayload,
  revokeDeviceTransitionToWire,
  securityStateToWire,
  securityTransitionToWire,
} from "./wire.js";

export type {
  AddDeviceWirePayload,
  CreateWorkspaceWirePayload,
  RevokeDeviceWirePayload,
  SecurityStateWirePayload,
  SecurityTransitionWirePayload,
} from "./wire.js";

export {
  attachAddDeviceSignature,
  createUnsignedAddDeviceTransition,
  deriveAddDeviceSecurityState,
  encodeAddDeviceTransition,
  encodeUnsignedAddDeviceTransition,
} from "./add-device.js";

export {
  attachRevokeDeviceSignature,
  createUnsignedRevokeDeviceTransition,
  deriveRevokeDeviceSecurityState,
  encodeRevokeDeviceTransition,
  encodeUnsignedRevokeDeviceTransition,
} from "./revoke-device.js";

export {
  AUTHORIZED_PRESENCE_CHALLENGE_BYTES,
  assertAuthorizedPresenceSignature,
  encodeAuthorizedPresenceProof,
} from "./authorized-presence.js";

export type { AuthorizedPresenceProof } from "./authorized-presence.js";

export {
  attachWorkspaceKeyRotationEnvelopeSignature,
  encodeUnsignedWorkspaceKeyRotationEnvelope,
} from "./key-rotation-envelope.js";

export type {
  WorkspaceKeyRotationEnvelope,
  UnsignedWorkspaceKeyRotationEnvelope,
} from "./key-rotation-envelope.js";
