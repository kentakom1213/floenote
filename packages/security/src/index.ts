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
  createProjectTransitionToWire,
  parseCreateProjectWirePayload,
  parseSecurityStateWirePayload,
  securityStateToWire,
} from "./wire.js";

export type {
  CreateProjectWirePayload,
  SecurityStateWirePayload,
} from "./wire.js";
