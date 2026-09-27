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
  receiveWorkspaceKeyDelivery,
  sendWorkspaceKeyDelivery,
} from "./workspace-key-delivery.js";

export type {
  WorkspaceKeyDelivery,
  ReceiveWorkspaceKeyDeliveryOptions,
  SendWorkspaceKeyDeliveryOptions,
} from "./workspace-key-delivery.js";
