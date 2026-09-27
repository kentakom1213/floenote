import {
  createSessionId,
  type AuthorizedPresenceClient,
  type ReconnectTransportMode,
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
  mode: ReconnectTransportMode;
  signaling: WebRtcSignalingSession;
  syncEngine: ProjectSyncEngine;
  stopConnectionState: () => void;
  stopTransportStatus: () => void;
  connectionTimer: ReturnType<typeof setTimeout> | null;
  disconnectedTimer: ReturnType<typeof setTimeout> | null;
};

type PeerRetryState = {
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
};

export const AUTOMATIC_RECONNECT_RETRY_DELAYS_MS = [
  1_000,
  2_000,
  4_000,
  8_000,
  16_000,
  30_000,
] as const;

export const AUTOMATIC_DIRECT_FALLBACK_TIMEOUT_MS = 6_000;
export const AUTOMATIC_RECONNECT_CONNECTION_TIMEOUT_MS = 15_000;
export const AUTOMATIC_RECONNECT_DISCONNECTED_GRACE_MS = 5_000;

export type AutomaticPeerConnectionAttempt = {
  deviceId: DeviceId;
  mode: ReconnectTransportMode;
};

export type AutomaticPeerSyncStatus = {
  connectedDeviceIds: readonly DeviceId[];
  connectionAttempts: readonly AutomaticPeerConnectionAttempt[];
  error: string | null;
};

export type AutomaticPeerSyncManagerOptions = {
  coordinatorBaseUrl: string;
  project: NoteProject;
  localDeviceId: DeviceId;
  securityState: SecurityState;
  vaultSession: DeviceVaultSession;
  presence: AuthorizedPresenceClient;
  relayFallbackEnabled?: boolean;
  rtcConfigurationProvider?: (
    mode: ReconnectTransportMode,
  ) => Promise<RTCConfiguration | undefined>;
  onStatusChange: (status: AutomaticPeerSyncStatus) => void;
};

export class AutomaticPeerSyncManager {
  readonly #coordinatorBaseUrl: string;
  readonly #project: NoteProject;
  readonly #localDeviceId: DeviceId;
  readonly #securityState: SecurityState;
  readonly #vaultSession: DeviceVaultSession;
  readonly #presence: AuthorizedPresenceClient;
  readonly #relayFallbackEnabled: boolean;
  readonly #rtcConfigurationProvider: (
    mode: ReconnectTransportMode,
  ) => Promise<RTCConfiguration | undefined>;
  readonly #onStatusChange: (status: AutomaticPeerSyncStatus) => void;
  readonly #connections = new Map<DeviceId, AutomaticPeerConnection>();
  readonly #connectedDeviceIds = new Set<DeviceId>();
  readonly #retryStates = new Map<DeviceId, PeerRetryState>();
  readonly #pendingPeerIds = new Set<DeviceId>();
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
    this.#relayFallbackEnabled = options.relayFallbackEnabled ?? false;
    this.#rtcConfigurationProvider =
      options.rtcConfigurationProvider ?? (async () => undefined);
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
    transportMode: ReconnectTransportMode = "direct",
  ): void {
    if (this.#stopped || fromDeviceId === this.#localDeviceId) return;

    const authorized = this.#securityState.devices.some(
      (device) => device.deviceId === fromDeviceId,
    );
    if (!authorized) return;

    if (fromDeviceId >= this.#localDeviceId) return;

    void this.#startPeer(
      fromDeviceId,
      "join",
      sessionId,
      transportMode,
    ).catch(
      (error: unknown) => {
        this.#setError(
          error instanceof Error
            ? error.message
            : "Failed to prepare automatic peer connection",
        );
      },
    );
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
        this.#pendingPeerIds.has(peerDeviceId) ||
        this.#retryStates.has(peerDeviceId)
      ) {
        continue;
      }

      void this.#startHostReconnect(peerDeviceId, "direct");
    }
  }

  async #startHostReconnect(
    peerDeviceId: DeviceId,
    mode: ReconnectTransportMode,
  ): Promise<void> {
    if (
      !this.#shouldInitiate(peerDeviceId) ||
      this.#connections.has(peerDeviceId) ||
      this.#pendingPeerIds.has(peerDeviceId)
    ) {
      return;
    }

    const sessionId = createSessionId();
    let started: boolean;
    try {
      started = await this.#startPeer(
        peerDeviceId,
        "host",
        sessionId,
        mode,
      );
    } catch (error: unknown) {
      this.#setError(
        error instanceof Error
          ? error.message
          : "Failed to prepare automatic peer connection",
      );
      this.#scheduleRetry(peerDeviceId);
      return;
    }
    if (!started) return;

    try {
      this.#presence.sendReconnectSession(peerDeviceId, sessionId, mode);
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

  async #startPeer(
    peerDeviceId: DeviceId,
    role: WebRtcSignalingRole,
    sessionId: SessionId,
    mode: ReconnectTransportMode,
  ): Promise<boolean> {
    if (this.#stopped || this.#pendingPeerIds.has(peerDeviceId)) return false;

    const existing = this.#connections.get(peerDeviceId);
    if (existing?.sessionId === sessionId) return false;

    this.#pendingPeerIds.add(peerDeviceId);
    let configuration: RTCConfiguration | undefined;
    try {
      configuration = await this.#rtcConfigurationProvider(mode);
    } finally {
      this.#pendingPeerIds.delete(peerDeviceId);
    }

    if (
      this.#stopped ||
      !this.#onlineDeviceIds.includes(this.#localDeviceId) ||
      !this.#onlineDeviceIds.includes(peerDeviceId)
    ) {
      return false;
    }

    const latest = this.#connections.get(peerDeviceId);
    if (latest?.sessionId === sessionId) return false;
    if (latest) this.#stopPeer(peerDeviceId);

    if (mode === "relay") {
      if (!hasTurnServer(configuration)) {
        throw new Error("TURN relay configuration is unavailable on this device");
      }
      configuration = {
        ...configuration,
        iceTransportPolicy: "relay",
      };
    }

    const transport = new WebRtcTransport(
      this.#project.id,
      configuration,
      createConsoleDebugLogger(`auto-${role}-webrtc`),
    );
    const encryptedTransport = new EncryptedSyncTransport(
      transport,
      {
        encrypt: (plaintext) =>
          this.#vaultSession.encryptWorkspaceSyncPayload(
            this.#securityState.workspaceId,
            this.#securityState.keyEpoch,
            plaintext,
          ),
        decrypt: (envelope) =>
          this.#vaultSession.decryptWorkspaceSyncPayload(
            this.#securityState.workspaceId,
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
      workspaceId: this.#project.id,
      sessionId,
      transport,
      debugLogger: createConsoleDebugLogger(`auto-${role}-signal`),
    });

    const stopConnectionState = transport.onConnectionStateChange((state) => {
      const current = this.#connections.get(peerDeviceId);

      if (state === "connected") {
        if (current?.sessionId === sessionId) {
          this.#clearDisconnectedTimer(current);

          if (transport.dataChannelState === "open") {
            this.#markPeerConnected(peerDeviceId, current);
          }
        }
        return;
      }

      this.#connectedDeviceIds.delete(peerDeviceId);
      this.#emitStatus();

      if (state === "disconnected") {
        if (
          current?.sessionId === sessionId &&
          current.disconnectedTimer === null
        ) {
          current.disconnectedTimer = setTimeout(() => {
            const latest = this.#connections.get(peerDeviceId);
            if (
              latest?.sessionId === sessionId &&
              !this.#connectedDeviceIds.has(peerDeviceId)
            ) {
              this.#restartPeer(peerDeviceId, sessionId);
            }
          }, AUTOMATIC_RECONNECT_DISCONNECTED_GRACE_MS);
        }
        return;
      }

      if (current?.sessionId === sessionId) {
        this.#clearDisconnectedTimer(current);
      }

      if (state === "failed" || state === "closed") {
        queueMicrotask(() => this.#restartPeer(peerDeviceId, sessionId));
      }
    });

    const stopTransportStatus = transport.onStatusChange((status) => {
      const current = this.#connections.get(peerDeviceId);
      if (current?.sessionId !== sessionId) return;

      if (status.dataChannelState === "open") {
        this.#markPeerConnected(peerDeviceId, current);
        return;
      }

      if (status.dataChannelState !== "closed") return;

      this.#connectedDeviceIds.delete(peerDeviceId);
      this.#emitStatus();

      queueMicrotask(() => this.#restartPeer(peerDeviceId, sessionId));
    });

    const connection: AutomaticPeerConnection = {
      sessionId,
      mode,
      signaling,
      syncEngine,
      stopConnectionState,
      stopTransportStatus,
      connectionTimer: null,
      disconnectedTimer: null,
    };
    this.#connections.set(peerDeviceId, connection);
    this.#emitStatus();

    const connectionTimeoutMs =
      role === "host" &&
      mode === "direct" &&
      this.#relayFallbackEnabled
        ? AUTOMATIC_DIRECT_FALLBACK_TIMEOUT_MS
        : AUTOMATIC_RECONNECT_CONNECTION_TIMEOUT_MS;

    connection.connectionTimer = setTimeout(() => {
      const current = this.#connections.get(peerDeviceId);
      if (
        current?.sessionId === sessionId &&
        !this.#connectedDeviceIds.has(peerDeviceId)
      ) {
        this.#restartPeer(peerDeviceId, sessionId);
      }
    }, connectionTimeoutMs);

    syncEngine.start();
    signaling.start();
    return true;
  }

  #stopPeer(peerDeviceId: DeviceId): void {
    const connection = this.#connections.get(peerDeviceId);
    if (!connection) return;

    this.#connections.delete(peerDeviceId);
    this.#clearConnectionTimer(connection);
    this.#clearDisconnectedTimer(connection);
    connection.stopConnectionState();
    connection.stopTransportStatus();
    connection.signaling.stop();
    connection.syncEngine.stop();

    this.#connectedDeviceIds.delete(peerDeviceId);
    this.#emitStatus();
  }

  #restartPeer(peerDeviceId: DeviceId, sessionId: SessionId): void {
    const current = this.#connections.get(peerDeviceId);
    if (current?.sessionId !== sessionId) return;

    const shouldFallBackToRelay =
      current.mode === "direct" &&
      this.#relayFallbackEnabled &&
      this.#shouldInitiate(peerDeviceId);

    this.#stopPeer(peerDeviceId);

    if (shouldFallBackToRelay) {
      void this.#startHostReconnect(peerDeviceId, "relay");
      return;
    }

    this.#scheduleRetry(peerDeviceId);
  }

  #markPeerConnected(
    peerDeviceId: DeviceId,
    connection: AutomaticPeerConnection,
  ): void {
    this.#clearConnectionTimer(connection);
    this.#clearDisconnectedTimer(connection);
    this.#connectedDeviceIds.add(peerDeviceId);
    this.#clearRetry(peerDeviceId);
    this.#error = null;
    this.#emitStatus();
  }

  #clearConnectionTimer(connection: AutomaticPeerConnection): void {
    if (!connection.connectionTimer) return;
    clearTimeout(connection.connectionTimer);
    connection.connectionTimer = null;
  }

  #clearDisconnectedTimer(connection: AutomaticPeerConnection): void {
    if (!connection.disconnectedTimer) return;
    clearTimeout(connection.disconnectedTimer);
    connection.disconnectedTimer = null;
  }

  #scheduleRetry(peerDeviceId: DeviceId): void {
    if (!this.#shouldInitiate(peerDeviceId)) return;

    const retry = this.#retryStates.get(peerDeviceId);
    if (retry?.timer) return;

    const previousAttempt = retry?.attempt ?? 0;
    const delayIndex = Math.min(
      previousAttempt,
      AUTOMATIC_RECONNECT_RETRY_DELAYS_MS.length - 1,
    );
    const delayMs = AUTOMATIC_RECONNECT_RETRY_DELAYS_MS[delayIndex];

    const timer = setTimeout(() => {
      const current = this.#retryStates.get(peerDeviceId);
      if (!current || current.timer !== timer) return;

      current.timer = null;
      this.#startHostReconnect(peerDeviceId, "direct");
    }, delayMs);

    this.#retryStates.set(peerDeviceId, {
      attempt: previousAttempt + 1,
      timer,
    });
  }

  #clearRetry(peerDeviceId: DeviceId): void {
    const retry = this.#retryStates.get(peerDeviceId);
    if (!retry) return;

    if (retry.timer) clearTimeout(retry.timer);
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
      connectionAttempts: [...this.#connections.entries()]
        .map(([deviceId, connection]) => ({
          deviceId,
          mode: connection.mode,
        }))
        .sort((left, right) => left.deviceId.localeCompare(right.deviceId)),
      error: this.#error,
    });
  }
}

function hasTurnServer(configuration: RTCConfiguration | undefined): boolean {
  return (
    configuration?.iceServers?.some((server) => {
      const urls =
        typeof server.urls === "string" ? [server.urls] : server.urls;
      return urls.some(
        (url) => url.startsWith("turn:") || url.startsWith("turns:"),
      );
    }) ?? false
  );
}
