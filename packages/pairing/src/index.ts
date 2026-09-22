export {
  authenticatePairingChannel,
  PAIRING_PROTOCOL_VERSION,
} from "./pairing-authentication.js";

export type {
  PairingAuthenticationOptions,
  PairingRole,
} from "./pairing-authentication.js";

export { exchangeJoiningDeviceIdentity } from "./device-bootstrap.js";

export type {
  DeviceBootstrapOptions,
  DeviceBootstrapRole,
} from "./device-bootstrap.js";
