export { WorkspaceSyncEngine } from "./workspace-sync-engine.js";
export {
  decodeSyncMessage,
  encodeSyncMessage,
} from "./protocol.js";
export type {
  WorkspaceSyncEngineOptions,
  SyncDebugEvent,
  SyncDebugLogger,
} from "./workspace-sync-engine.js";
export type { SyncMessage } from "./protocol.js";

export { EncryptedSyncTransport } from "./encrypted-sync-transport.js";

export type {
  EncryptedSyncTransportDirection,
  EncryptedSyncTransportOptions,
  WorkspaceSyncCipher,
} from "./encrypted-sync-transport.js";
