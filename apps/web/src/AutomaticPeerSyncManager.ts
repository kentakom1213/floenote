import {
  createSessionId,
  type AuthorizedPresenceClient,
  type SessionId,
  WebRtcSignalingSession,
  type WebRtcSignalingRole,
} from "@floe-note/coordinator-client";
import type { NoteProject } from "@floe-note/document";
import type { DeviceId } from "@floe-note/domain";
import type { SecurityState } from "@floe-note/security";
import {
  EncryptedSyncTransport,
  ProjectSyncEngine,
} from "@floe-note/sync";
import { WebRtcTransport } from "@floe-note/transport/webrtc";
import type { DeviceVaultSession } from "@floe-note/vault";

import { createConsoleDebugLogger } from "./debug.js";

type AutomaticPeerConnection = {
  sessionId: SessionId;
  signaling: WebRtcSignalingSession;
  syncEngine: ProjectSyncEngine;
  stopConnectionState: () => void;
};

type PeerRetryState = {
  attempt: number;
  timer: ReturnType<typeof setTimeout>;
};

export const AUTOMATIC_RECONNECT_RETRY_DELAYS_MS = [
  1_000,
  2_000,
  4_000,
  8_000,
  16_000,
  30_000,
] as const;

export type AutomaticPeerSyncStatus = {
  connectedDeviceIds: readonly DeviceId[];
  error: string | null;
};

export type AutomaticPeerSyncManagerOptions = {
  coordinatorBaseUrl: string;
  project: NoteProject;
  localDeviceId: DeviceId;
  securityState: SecurityState;
  vaultSession: DeviceVaultSession;
  presence: AuthorizedPresenceClient;
  onStatusChange: (status: AutomaticPeerSyncStatus) => void;
};

export class AutomaticPeerSyncManager {
  readonly #coordinatorBaseUrl: string;
  readonly #project: NoteProject;
  readonly #localDeviceId: DeviceId;
  readonly #securityState: SecurityState;
  readonly #vaultSession: DeviceVaultSession;
  readonly #presence: AuthorizedPresenceClient;
  readonly #onStatusChange: (status: AutomaticPeerSyncStatus) => void;
  readonly #connections = new Map<DeviceId, AutomaticPeerConnection>();
  readonly #connectedDeviceIds = new Set<DeviceId>();
  readonly #retryStates = new Map<DeviceId, PeerRetryState>();
  #onlineDeviceIds: readonly DeviceId[] = [];
  #error: string | null = null;
  #stopped = false;

  constructor(options: AutomaticPeerSyncManagerOptions) {
    this.#coordinatorBaseUrl = options.coordinatorBaseUrl;
    this.#project = options.project;
    this.#localDeviceId = options.localDeviceId;
    this.#securityState = options.securityState;
    this.#vaultSession = options.vaultSession;
    this.#presence = options.presence;
    this.#onStatusChange = options.onStatusChange;
  }

  updateOnlineDevices(deviceIds: readonly DeviceId[]): void {
    if (this.#stopped) return;

    const authorized = new Set(
      this.#securityState.devices.map((device) => device.deviceId),
    );
    this.#onlineDeviceIds = [...new Set(deviceIds)]
      .filter((deviceId) => authorized.has(deviceId))
      .sort();

    this.#reconcile();
  }

  acceptReconnectSession(
    fromDeviceId: DeviceId,
    sessionId: SessionId,
  ): void {
    if (this.#stopped || fromDeviceId === this.#localDeviceId) return;

    const authorized = this.#securityState.devices.some(
      (device) => device.deviceId === fromDeviceId,
    );
    if (!authorized) return;

    if (fromDeviceId >= this.#localDeviceId) return;

    this.#startPeer(fromDeviceId, "join", sessionId);
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;

    for (const peerDeviceId of [...this.#connections.keys()]) {
      this.#stopPeer(peerDeviceId);
    }
    for (const peerDeviceId of [...this.#retryStates.keys()]) {
      this.#clearRetry(peerDeviceId);
    }
    this.#connectedDeviceIds.clear();
    this.#emitStatus();
  }

  #reconcile(): void {
    const desired = new Set(
      this.#onlineDeviceIds.filter(
        (deviceId) => deviceId !== this.#localDeviceId,
      ),
    );

    for (const peerDeviceId of [...this.#connections.keys()]) {
      if (!desired.has(peerDeviceId)) {
        this.#stopPeer(peerDeviceId);
      }
    }
    for (const peerDeviceId of [...this.#retryStates.keys()]) {
      if (!desired.has(peerDeviceId)) {
        this.#clearRetry(peerDeviceId);
      }
    }

    if (!this.#onlineDeviceIds.includes(this.#localDeviceId)) {
      for (const peerDeviceId of [...this.#retryStates.keys()]) {
        this.#clearRetry(peerDeviceId);
      }
      return;
    }

    for (const peerDeviceId of desired) {
      if (
        this.#localDeviceId >= peerDeviceId ||
        this.#connections.has(peerDeviceId) ||
        this.#retryStates.has(peerDeviceId)
      ) {
        continue;
      }

      this.#startHostReconnect(peerDeviceId);
    }
  }

  #startHostReconnect(peerDeviceId: DeviceId): void {
    if (!this.#shouldInitiate(peerDeviceId) || this.#connections.has(peerDeviceId)) {
      return;
    }

    const sessionId = createSessionId();
    this.#startPeer(peerDeviceId, "host", sessionId);

    try {
      this.#presence.sendReconnectSession(peerDeviceId, sessionId);
    } catch (error: unknown) {
      this.#stopPeer(peerDeviceId);
      this.#setError(
        error instanceof Error
          ? error.message
          : "Failed to announce automatic reconnect session",
      );
      this.#scheduleRetry(peerDeviceId);
    }
  }

  #startPeer(
    peerDeviceId: DeviceId,
    role: WebRtcSignalingRole,
    sessionId: SessionId,
  ): void {
    if (this.#stopped) return;

    const existing = this.#connections.get(peerDeviceId);
    if (existing?.sessionId === sessionId) return;
    if (existing) this.#stopPeer(peerDeviceId);

    const transport = new WebRtcTransport(
      this.#project.id,
      undefined,
      createConsoleDebugLogger(`auto-${role}-webrtc`),
    );
    const encryptedTransport = new EncryptedSyncTransport(
      transport,
      {
        encrypt: (plaintext) =>
          this.#vaultSession.encryptProjectSyncPayload(
            this.#securityState.projectId,
            this.#securityState.keyEpoch,
            plaintext,
          ),
        decrypt: (envelope) =>
          this.#vaultSession.decryptProjectSyncPayload(
            this.#securityState.projectId,
            this.#securityState.keyEpoch,
            envelope,
          ),
      },
      {
        onError: (error, direction) => {
          this.#setError(
            `Automatic encrypted sync ${direction} failed: ${error.message}`,
          );
        },
      },
    );
    const syncEngine = new ProjectSyncEngine(
      this.#project,
      encryptedTransport,
      {
        debugLogger: createConsoleDebugLogger(`auto-${role}-sync`),
      },
    );
    const signaling = new WebRtcSignalingSession({
      role,
      coordinatorBaseUrl: this.#coordinatorBaseUrl,
      projectId: this.#project.id,
      sessionId,
      transport,
      debugLogger: createConsoleDebugLogger(`auto-${role}-signal`),
    });

    const stopConnectionState = transport.onConnectionStateChange((state) => {
      if (state === "connected") {
        this.#connectedDeviceIds.add(peerDeviceId);
        this.#clearRetry(peerDeviceId);
        this.#error = null;
        this.#emitStatus();
        return;
      }

      this.#connectedDeviceIds.delete(peerDeviceId);
      this.#emitStatus();

      if (state === "failed" || state === "closed") {
        queueMicrotask(() => {
          const current = this.#connections.get(peerDeviceId);
          if (current?.sessionId === sessionId) {
            this.#stopPeer(peerDeviceId);
            this.#scheduleRetry(peerDeviceId);
          }
        });
      }
    });

    this.#connections.set(peerDeviceId, {
      sessionId,
      signaling,
      syncEngine,
      stopConnectionState,
    });

    syncEngine.start();
    signaling.start();
  }

  #stopPeer(peerDeviceId: DeviceId): void {
    const connection = this.#connections.get(peerDeviceId);
    if (!connection) return;

    this.#connections.delete(peerDeviceId);
    connection.stopConnectionState();
    connection.signaling.stop();
    connection.syncEngine.stop();

    if (this.#connectedDeviceIds.delete(peerDeviceId)) {
      this.#emitStatus();
    }
  }

  #scheduleRetry(peerDeviceId: DeviceId): void {
    if (!this.#shouldInitiate(peerDeviceId)) return;

    const previousAttempt = this.#retryStates.get(peerDeviceId)?.attempt ?? 0;
    if (this.#retryStates.has(peerDeviceId)) return;

    const delayIndex = Math.min(
      previousAttempt,
      AUTOMATIC_RECONNECT_RETRY_DELAYS_MS.length - 1,
    );
    const delayMs = AUTOMATIC_RECONNECT_RETRY_DELAYS_MS[delayIndex];

    const timer = setTimeout(() => {
      const retry = this.#retryStates.get(peerDeviceId);
      if (!retry || retry.timer !== timer) return;

      this.#retryStates.delete(peerDeviceId);
      this.#startHostReconnect(peerDeviceId);
    }, delayMs);

    this.#retryStates.set(peerDeviceId, {
      attempt: previousAttempt + 1,
      timer,
    });
  }

  #clearRetry(peerDeviceId: DeviceId): void {
    const retry = this.#retryStates.get(peerDeviceId);
    if (!retry) return;

    clearTimeout(retry.timer);
    this.#retryStates.delete(peerDeviceId);
  }

  #shouldInitiate(peerDeviceId: DeviceId): boolean {
    return (
      !this.#stopped &&
      this.#localDeviceId < peerDeviceId &&
      this.#onlineDeviceIds.includes(this.#localDeviceId) &&
      this.#onlineDeviceIds.includes(peerDeviceId)
    );
  }

  #setError(error: string): void {
    this.#error = error;
    this.#emitStatus();
  }

  #emitStatus(): void {
    this.#onStatusChange({
      connectedDeviceIds: [...this.#connectedDeviceIds].sort(),
      error: this.#error,
    });
  }
}
