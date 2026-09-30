import { useCallback, useEffect, useRef, useState } from "react";

import {
  AuthorizedPresenceClient,
  type AuthorizedPresenceConnectionState,
  type CreatedInvitation,
  type ReconnectTransportMode,
  type SessionId,
} from "@floe-note/coordinator-client";
import type { NoteProject } from "@floe-note/document";
import type { DeviceId } from "@floe-note/domain";
import type { SecurityState } from "@floe-note/security";
import {
  EncryptedSyncTransport,
  WorkspaceSyncEngine,
} from "@floe-note/sync";
import { BroadcastChannelTransport } from "@floe-note/transport/broadcast-channel";
import type { DeviceVaultSession } from "@floe-note/vault";

import {
  AutomaticPeerSyncManager,
  type AutomaticPeerSyncStatus,
} from "./AutomaticPeerSyncManager.js";
import { createConsoleDebugLogger } from "./debug.js";
import { resolveRelayRtcConfiguration } from "./turn-credentials.js";

const automaticSyncLogger = createConsoleDebugLogger("auto-sync-lifecycle");
const localTabSyncLogger = createConsoleDebugLogger("local-tab-sync");

function logAutomaticSync(
  event: string,
  details: Record<string, unknown> = {},
): void {
  automaticSyncLogger({ at: new Date().toISOString(), event, details });
}

function logLocalTabSync(
  event: string,
  details: Record<string, unknown> = {},
): void {
  localTabSyncLogger({ at: new Date().toISOString(), event, details });
}

type AuthorizedWorkspaceSyncOptions = {
  coordinatorBaseUrl: string;
  project: NoteProject | null;
  localDeviceId: DeviceId | null;
  securityState: SecurityState | null;
  projectKeyReady: boolean | null;
  vaultSession: DeviceVaultSession | null;
  automaticReconnectEnabled: boolean;
  turnCredentialEndpoint: string | null;
  onSecurityStateChanged: () => void;
};

export type AuthorizedWorkspaceSyncState = {
  presenceState: AuthorizedPresenceConnectionState;
  onlineDeviceIds: readonly DeviceId[];
  ownsAutomaticPeerSync: boolean;
  connectedDeviceIds: readonly DeviceId[];
  connectionAttempts: AutomaticPeerSyncStatus["connectionAttempts"];
  coordinationError: string | null;
  error: string | null;
  createInvitation: () => Promise<CreatedInvitation>;
};

const IDLE_AUTOMATIC_SYNC_STATUS: AutomaticPeerSyncStatus = {
  connectedDeviceIds: [],
  connectionAttempts: [],
  error: null,
};

export function useAuthorizedWorkspaceSync({
  coordinatorBaseUrl,
  project,
  localDeviceId,
  securityState,
  projectKeyReady,
  vaultSession,
  automaticReconnectEnabled,
  turnCredentialEndpoint,
  onSecurityStateChanged,
}: AuthorizedWorkspaceSyncOptions): AuthorizedWorkspaceSyncState {
  const [presenceState, setPresenceState] =
    useState<AuthorizedPresenceConnectionState>("idle");
  const [onlineDeviceIds, setOnlineDeviceIds] =
    useState<readonly DeviceId[]>([]);
  const [presenceError, setPresenceError] = useState<string | null>(null);
  const [automaticSyncStatus, setAutomaticSyncStatus] =
    useState<AutomaticPeerSyncStatus>(IDLE_AUTOMATIC_SYNC_STATUS);
  const [ownsAutomaticPeerSync, setOwnsAutomaticPeerSync] = useState(false);
  const presenceRef = useRef<AuthorizedPresenceClient | null>(null);
  const automaticPeerSyncRef = useRef<AutomaticPeerSyncManager | null>(null);
  const ownsAutomaticPeerSyncRef = useRef(false);
  const shouldQueueReconnectRef = useRef(automaticReconnectEnabled);
  const onlineDeviceIdsRef = useRef<readonly DeviceId[]>([]);
  const pendingReconnectSessionsRef = useRef(
    new Map<
      DeviceId,
      { sessionId: SessionId; transportMode: ReconnectTransportMode }
    >(),
  );

  shouldQueueReconnectRef.current = automaticReconnectEnabled;

  function drainPendingReconnectSessions(
    automaticPeerSync: AutomaticPeerSyncManager,
    deviceIds: readonly DeviceId[],
  ): void {
    const onlineDeviceIdSet = new Set(deviceIds);

    for (const [
      fromDeviceId,
      { sessionId, transportMode },
    ] of pendingReconnectSessionsRef.current) {
      pendingReconnectSessionsRef.current.delete(fromDeviceId);
      if (!onlineDeviceIdSet.has(fromDeviceId)) {
        logAutomaticSync("reconnect.discard-offline", { fromDeviceId });
        continue;
      }

      logAutomaticSync("reconnect.drain", { fromDeviceId, transportMode });
      automaticPeerSync.acceptReconnectSession(
        fromDeviceId,
        sessionId,
        transportMode,
      );
    }
  }

  const createInvitation = useCallback(() => {
    const presence = presenceRef.current;
    if (!presence) {
      return Promise.reject(
        new Error("Authorized presence is not available"),
      );
    }
    return presence.createInvitation();
  }, []);

  useEffect(() => {
    if (!project || !localDeviceId || !securityState || !vaultSession) {
      presenceRef.current = null;
      setPresenceState("idle");
      setOnlineDeviceIds([]);
      setPresenceError(null);
      return;
    }

    const presence = new AuthorizedPresenceClient({
      coordinatorBaseUrl,
      workspaceId: project.id,
      deviceId: localDeviceId,
      securityHead: securityState.headHash,
      sign: (message) => vaultSession.sign(message),
    });
    presenceRef.current = presence;

    const stopState = presence.onStateChange((state) => {
      logAutomaticSync("presence.state", {
        workspaceId: project.id,
        deviceId: localDeviceId,
        state,
      });
      setPresenceState(state);
      if (state === "connecting" || state === "open") {
        setPresenceError(null);
      }
    });
    const stopDevices = presence.onOnlineDevicesChange((deviceIds) => {
      logAutomaticSync("presence.devices", {
        workspaceId: project.id,
        deviceId: localDeviceId,
        onlineDeviceIds: deviceIds,
        owner: ownsAutomaticPeerSyncRef.current,
        managerReady: automaticPeerSyncRef.current !== null,
      });
      onlineDeviceIdsRef.current = deviceIds;
      setOnlineDeviceIds(deviceIds);

      const automaticPeerSync = automaticPeerSyncRef.current;
      if (!automaticPeerSync) return;

      automaticPeerSync.updateOnlineDevices(deviceIds);
      drainPendingReconnectSessions(automaticPeerSync, deviceIds);
    });
    const stopReconnect = presence.onReconnectSession(
      (fromDeviceId, sessionId, transportMode) => {
        const automaticPeerSync = automaticPeerSyncRef.current;
        if (automaticPeerSync) {
          logAutomaticSync("reconnect.accept", {
            fromDeviceId,
            transportMode,
          });
          automaticPeerSync.acceptReconnectSession(
            fromDeviceId,
            sessionId,
            transportMode,
          );
          return;
        }

        // Only the lock holder may retain a session during manager setup.
        // A follower must not replay a session after a later handoff.
        if (
          ownsAutomaticPeerSyncRef.current &&
          shouldQueueReconnectRef.current
        ) {
          logAutomaticSync("reconnect.queue-owner-initializing", {
            fromDeviceId,
            transportMode,
          });
          pendingReconnectSessionsRef.current.set(fromDeviceId, {
            sessionId,
            transportMode,
          });
        } else {
          logAutomaticSync("reconnect.discard-non-owner", {
            fromDeviceId,
            transportMode,
          });
        }
      },
    );
    const stopErrors = presence.onError((error) => {
      logAutomaticSync("presence.error", { message: error.message });
      setPresenceError(error.message);
      if (error.message === "SecurityState changed") {
        onSecurityStateChanged();
      }
    });

    const retryPresenceNow = () => presence.retryNow();
    const retryPresenceWhenVisible = () => {
      if (document.visibilityState === "visible") {
        presence.retryNow();
      }
    };
    const closePresenceOnPageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        presence.close();
      }
    };

    window.addEventListener("online", retryPresenceNow);
    window.addEventListener("pagehide", closePresenceOnPageHide);
    document.addEventListener("visibilitychange", retryPresenceWhenVisible);

    setPresenceError(null);
    presence.start();

    return () => {
      window.removeEventListener("online", retryPresenceNow);
      window.removeEventListener("pagehide", closePresenceOnPageHide);
      document.removeEventListener(
        "visibilitychange",
        retryPresenceWhenVisible,
      );
      stopState();
      stopDevices();
      stopReconnect();
      stopErrors();
      if (presenceRef.current === presence) {
        presenceRef.current = null;
      }
      presence.close();
      logAutomaticSync("presence.stop", {
        workspaceId: project.id,
        deviceId: localDeviceId,
      });
      onlineDeviceIdsRef.current = [];
      pendingReconnectSessionsRef.current.clear();
      setOnlineDeviceIds([]);
    };
  }, [
    coordinatorBaseUrl,
    localDeviceId,
    onSecurityStateChanged,
    project,
    securityState,
    vaultSession,
  ]);

  useEffect(() => {
    setAutomaticSyncStatus(IDLE_AUTOMATIC_SYNC_STATUS);

    if (!automaticReconnectEnabled) {
      logAutomaticSync("owner.ineligible", { reason: "automatic-reconnect-disabled" });
      pendingReconnectSessionsRef.current.clear();
      return;
    }

    if (
      !projectKeyReady ||
      !project ||
      !localDeviceId ||
      !securityState ||
      securityState.workspaceId !== project.id ||
      !securityState.devices.some(
        (device) => device.deviceId === localDeviceId,
      ) ||
      !vaultSession
    ) {
      logAutomaticSync("owner.ineligible", {
        workspaceId: project?.id ?? null,
        deviceId: localDeviceId,
        workspaceLoaded: project !== null,
        securityStateAvailable: securityState !== null,
        workspaceMatchesSecurityState:
          project !== null && securityState?.workspaceId === project.id,
        authorized:
          securityState?.devices.some(
            (device) => device.deviceId === localDeviceId,
          ) ?? false,
        workspaceKeyReady: projectKeyReady === true,
        vaultSessionAvailable: vaultSession !== null,
      });
      return;
    }

    const presence = presenceRef.current;
    if (!presence) {
      logAutomaticSync("owner.ineligible", { reason: "presence-unavailable" });
      return;
    }

    const startManager = () => {
      ownsAutomaticPeerSyncRef.current = true;
      let automaticPeerSync: AutomaticPeerSyncManager;
      try {
        automaticPeerSync = new AutomaticPeerSyncManager({
          coordinatorBaseUrl,
          project,
          localDeviceId,
          securityState,
          vaultSession,
          presence,
          relayFallbackEnabled: turnCredentialEndpoint !== null,
          rtcConfigurationProvider: (mode) =>
            mode === "relay"
              ? resolveRelayRtcConfiguration(turnCredentialEndpoint)
              : Promise.resolve(undefined),
          onStatusChange: setAutomaticSyncStatus,
        });
        automaticPeerSyncRef.current = automaticPeerSync;
        setOwnsAutomaticPeerSync(true);
        logAutomaticSync("manager.start", {
          workspaceId: project.id,
          deviceId: localDeviceId,
          presenceState: presence.state,
        });

        if (presence.state === "open") {
          const currentOnlineDeviceIds = onlineDeviceIdsRef.current;
          automaticPeerSync.updateOnlineDevices(currentOnlineDeviceIds);
          drainPendingReconnectSessions(
            automaticPeerSync,
            currentOnlineDeviceIds,
          );
        }
      } catch (error) {
        ownsAutomaticPeerSyncRef.current = false;
        setOwnsAutomaticPeerSync(false);
        automaticPeerSyncRef.current?.stop();
        automaticPeerSyncRef.current = null;
        pendingReconnectSessionsRef.current.clear();
        throw error;
      }

      return () => {
        logAutomaticSync("manager.stop", {
          workspaceId: project.id,
          deviceId: localDeviceId,
        });
        ownsAutomaticPeerSyncRef.current = false;
        setOwnsAutomaticPeerSync(false);
        if (automaticPeerSyncRef.current === automaticPeerSync) {
          automaticPeerSyncRef.current = null;
        }
        pendingReconnectSessionsRef.current.clear();
        automaticPeerSync.stop();
        setAutomaticSyncStatus(IDLE_AUTOMATIC_SYNC_STATUS);
      };
    };

    // Older browsers keep the existing single-tab behavior without election.
    const locks = navigator.locks;
    if (!locks) {
      logAutomaticSync("lock.unavailable", {
        workspaceId: project.id,
        deviceId: localDeviceId,
      });
      return startManager();
    }

    const abortController = new AbortController();
    let cancelled = false;
    let releaseLock: (() => void) | null = null;
    logAutomaticSync("lock.request", {
      workspaceId: project.id,
      deviceId: localDeviceId,
    });
    void locks
      .request(
        `floe:peer-sync:${project.id}:${localDeviceId}`,
        { signal: abortController.signal },
        async () => {
          if (cancelled) return;
          logAutomaticSync("lock.acquired", {
            workspaceId: project.id,
            deviceId: localDeviceId,
          });
          const stopManager = startManager();
          await new Promise<void>((resolve) => {
            releaseLock = () => {
              stopManager();
              logAutomaticSync("lock.release", {
                workspaceId: project.id,
                deviceId: localDeviceId,
              });
              resolve();
            };
            if (cancelled) releaseLock();
          });
        },
      )
      .catch((error: unknown) => {
        if (cancelled) return;
        logAutomaticSync("lock.error", {
          message: error instanceof Error ? error.message : String(error),
        });
        setAutomaticSyncStatus({
          ...IDLE_AUTOMATIC_SYNC_STATUS,
          error:
            error instanceof Error
              ? error.message
              : "Failed to acquire automatic peer sync ownership",
        });
      });

    return () => {
      cancelled = true;
      if (!releaseLock) {
        logAutomaticSync("lock.cancel-wait", {
          workspaceId: project.id,
          deviceId: localDeviceId,
        });
      }
      abortController.abort();
      releaseLock?.();
      pendingReconnectSessionsRef.current.clear();
    };
  }, [
    automaticReconnectEnabled,
    coordinatorBaseUrl,
    localDeviceId,
    project,
    projectKeyReady,
    securityState,
    turnCredentialEndpoint,
    vaultSession,
  ]);

  return {
    presenceState,
    onlineDeviceIds: presenceState === "open" ? onlineDeviceIds : [],
    ownsAutomaticPeerSync,
    connectedDeviceIds: automaticSyncStatus.connectedDeviceIds,
    connectionAttempts: automaticSyncStatus.connectionAttempts,
    coordinationError: presenceError,
    error: automaticSyncStatus.error,
    createInvitation,
  };
}

type LocalTabSyncOptions = {
  enabled: boolean;
  project: NoteProject | null;
  securityState: SecurityState | null;
  projectKeyReady: boolean | null;
  vaultSession: DeviceVaultSession | null;
};

export function useEncryptedLocalTabSync({
  enabled,
  project,
  securityState,
  projectKeyReady,
  vaultSession,
}: LocalTabSyncOptions): void {
  useEffect(() => {
    if (
      !enabled ||
      !project ||
      !securityState ||
      !projectKeyReady ||
      !vaultSession
    ) {
      logLocalTabSync("local.ineligible", {
        enabled,
        workspaceId: project?.id ?? null,
        securityStateAvailable: securityState !== null,
        workspaceKeyReady: projectKeyReady === true,
        vaultSessionAvailable: vaultSession !== null,
      });
      return;
    }

    logLocalTabSync("local.start", { workspaceId: project.id });
    const transport = new BroadcastChannelTransport(project.id);
    const encryptedTransport = new EncryptedSyncTransport(
      transport,
      {
        encrypt: (plaintext) =>
          vaultSession.encryptWorkspaceSyncPayload(
            securityState.workspaceId,
            securityState.keyEpoch,
            plaintext,
          ),
        decrypt: (envelope) =>
          vaultSession.decryptWorkspaceSyncPayload(
            securityState.workspaceId,
            securityState.keyEpoch,
            envelope,
          ),
      },
      {
        onError: (error, direction) => {
          logLocalTabSync("crypto.error", {
            workspaceId: project.id,
            direction,
            message: error.message,
          });
        },
      },
    );
    const syncEngine = new WorkspaceSyncEngine(project, encryptedTransport, {
      relayScope: "local-tab",
      debugLogger: localTabSyncLogger,
    });
    syncEngine.start();

    return () => {
      logLocalTabSync("local.stop", { workspaceId: project.id });
      syncEngine.stop();
    };
  }, [
    enabled,
    project,
    projectKeyReady,
    securityState,
    vaultSession,
  ]);
}
