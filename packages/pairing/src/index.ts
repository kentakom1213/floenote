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
  JoiningDeviceInfo,
} from "./device-bootstrap.js";

export {
  receiveProjectKeyDelivery,
  sendProjectKeyDelivery,
} from "./project-key-delivery.js";

export type {
  ProjectKeyDelivery,
  ReceiveProjectKeyDeliveryOptions,
  SendProjectKeyDeliveryOptions,
} from "./project-key-delivery.js";
