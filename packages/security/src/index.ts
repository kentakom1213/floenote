export { SECURITY_PROTOCOL_VERSION } from "./state.js";

export type {
  AuthorizedDevice,
  DevicePublicIdentity,
  SecurityProtocolVersion,
  SecurityState,
} from "./state.js";

export type {
  AddDeviceTransition,
  CreateProjectTransition,
  UnsignedAddDeviceTransition,
  RevokeDeviceTransition,
  SecurityTransition,
} from "./transition.js";

export {
  SECURITY_HEAD_HASH_BYTES,
  SECURITY_SIGNATURE_BYTES,
  attachCreateProjectSignature,
  createUnsignedCreateProjectTransition,
  deriveInitialSecurityState,
  encodeCreateProjectTransition,
  encodeUnsignedCreateProjectTransition,
} from "./create-project.js";

export type { UnsignedCreateProjectTransition } from "./transition.js";

export {
  addDeviceTransitionToWire,
  createProjectTransitionToWire,
  parseAddDeviceWirePayload,
  parseCreateProjectWirePayload,
  parseSecurityStateWirePayload,
  securityStateToWire,
} from "./wire.js";

export type {
  AddDeviceWirePayload,
  CreateProjectWirePayload,
  SecurityStateWirePayload,
} from "./wire.js";

export {
  attachAddDeviceSignature,
  createUnsignedAddDeviceTransition,
  deriveAddDeviceSecurityState,
  encodeAddDeviceTransition,
  encodeUnsignedAddDeviceTransition,
} from "./add-device.js";

export {
  AUTHORIZED_PRESENCE_CHALLENGE_BYTES,
  assertAuthorizedPresenceSignature,
  encodeAuthorizedPresenceProof,
} from "./authorized-presence.js";

export type { AuthorizedPresenceProof } from "./authorized-presence.js";
