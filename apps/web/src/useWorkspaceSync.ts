import { useCallback, useEffect, useRef, useState } from "react";

import {
  AuthorizedPresenceClient,
  type AuthorizedPresenceConnectionState,
  type CreatedInvitation,
  type ReconnectTransportMode,
  type SessionId,
  type TurnCredentials,
} from "@floe-note/coordinator-client";
import type { NoteProject } from "@floe-note/document";
import type { DeviceId, DocumentId } from "@floe-note/domain";
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
import { resolveRelayRtcConfiguration } from "./turn-credentials.js";

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
  onDocumentVersionConfirmed?: (
    deviceId: DeviceId,
    documentId: DocumentId,
    frontiers: Uint8Array,
  ) => void;
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
  requestTurnCredentials: () => Promise<TurnCredentials>;
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
  onDocumentVersionConfirmed,
}: AuthorizedWorkspaceSyncOptions): AuthorizedWorkspaceSyncState {
  const [presenceState, setPresenceState] =
    useState<AuthorizedPresenceConnectionState>("idle");
  const [onlineDeviceIds, setOnlineDeviceIds] =
    useState<readonly DeviceId[]>([]);
  const [presenceError, setPresenceError] = useState<string | null>(null);
  const [automaticSyncStatus, setAutomaticSyncStatus] =
    useState<AutomaticPeerSyncStatus>(IDLE_AUTOMATIC_SYNC_STATUS);
  const [ownsAutomaticPeerSync, setOwnsAutomaticPeerSync] = useState(false);
  const [ownershipVersion, setOwnershipVersion] = useState(0);
  const ownershipVersionRef = useRef(0);
  const presenceRef = useRef<AuthorizedPresenceClient | null>(null);
  const [authenticatedPresence, setAuthenticatedPresence] =
    useState<AuthorizedPresenceClient | null>(null);
  const automaticPeerSyncRef = useRef<AutomaticPeerSyncManager | null>(null);
  const ownsAutomaticPeerSyncRef = useRef(false);
  const ownershipPhaseRef = useRef<
    "none" | "candidate" | "follower" | "owner"
  >("none");
  const releaseOwnershipRef = useRef<(() => void) | null>(null);
  const shouldQueueReconnectRef = useRef(automaticReconnectEnabled);
  const onlineDeviceIdsRef = useRef<readonly DeviceId[]>([]);
  const pendingReconnectSessionsRef = useRef(
    new Map<
      DeviceId,
      { sessionId: SessionId; transportMode: ReconnectTransportMode }
    >(),
  );

  shouldQueueReconnectRef.current = automaticReconnectEnabled;

  const stopAutomaticPeerSync = useCallback(() => {
    const manager = automaticPeerSyncRef.current;
    if (!manager) return;
    automaticPeerSyncRef.current = null;
    manager.stop();
    setAutomaticSyncStatus(IDLE_AUTOMATIC_SYNC_STATUS);
  }, []);

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
      if (!onlineDeviceIdSet.has(fromDeviceId)) continue;

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

  const requestTurnCredentials = useCallback(() => {
    const presence = presenceRef.current;
    if (!presence) return Promise.reject(new Error("Authorized presence is not available"));
    return presence.requestTurnCredentials();
  }, []);

  useEffect(() => {
    if (!project || !localDeviceId || !securityState || !vaultSession) {
      presenceRef.current = null;
      setAuthenticatedPresence(null);
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
    setAuthenticatedPresence(null);
    let hasAuthenticated = false;

    const stopState = presence.onStateChange((state) => {
      setPresenceState(state);
      if (state === "open" && !hasAuthenticated) {
        hasAuthenticated = true;
        // A first authenticated Presence message can be followed by a
        // reconnect session before React starts the Web Lock request.
        if (shouldQueueReconnectRef.current) {
          ownershipPhaseRef.current = "candidate";
        }
        setAuthenticatedPresence(presence);
      }
      if (state === "connecting" || state === "open") {
        setPresenceError(null);
      }
    });
    const stopDevices = presence.onOnlineDevicesChange((deviceIds) => {
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
          automaticPeerSync.acceptReconnectSession(
            fromDeviceId,
            sessionId,
            transportMode,
          );
          return;
        }

        if (
          (ownershipPhaseRef.current === "owner" ||
            ownershipPhaseRef.current === "candidate") &&
          shouldQueueReconnectRef.current
        ) {
          pendingReconnectSessionsRef.current.set(fromDeviceId, {
            sessionId,
            transportMode,
          });
        }
      },
    );
    const stopErrors = presence.onError((error) => {
      setPresenceError(error.message);
      if (error.message === "SecurityState changed") {
        ownershipPhaseRef.current = "none";
        pendingReconnectSessionsRef.current.clear();
        releaseOwnershipRef.current?.();
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
      setAuthenticatedPresence(null);
      presence.close();
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
    if (
      !automaticReconnectEnabled ||
      !project ||
      !localDeviceId ||
      !securityState ||
      securityState.workspaceId !== project.id ||
      !securityState.devices.some(
        (device) => device.deviceId === localDeviceId,
      ) ||
      !vaultSession
    ) {
      ownershipPhaseRef.current = "none";
      pendingReconnectSessionsRef.current.clear();
      return;
    }

    const presence = presenceRef.current;
    if (!presence || authenticatedPresence !== presence) return;

    const locks = navigator.locks;
    const lockName = `floe:peer-sync:${project.id}:${localDeviceId}`;
    let disposed = false;
    let active = true;
    let requestGeneration = 0;
    let abortController: AbortController | null = null;
    let releaseLock: (() => void) | null = null;

    const relinquish = () => {
      requestGeneration += 1;
      ownershipVersionRef.current += 1;
      abortController?.abort();
      abortController = null;
      ownershipPhaseRef.current = "none";
      ownsAutomaticPeerSyncRef.current = false;
      setOwnsAutomaticPeerSync(false);
      stopAutomaticPeerSync();
      pendingReconnectSessionsRef.current.clear();
      releaseLock?.();
      releaseLock = null;
    };
    releaseOwnershipRef.current = relinquish;

    const holdLock = async (generation: number) => {
      if (disposed || !active || generation !== requestGeneration) return;
      if (ownershipPhaseRef.current === "follower") {
        pendingReconnectSessionsRef.current.clear();
      }
      ownershipPhaseRef.current = "owner";
      ownsAutomaticPeerSyncRef.current = true;
      setOwnsAutomaticPeerSync(true);
      ownershipVersionRef.current += 1;
      setOwnershipVersion(ownershipVersionRef.current);

      await new Promise<void>((resolve) => {
        const release = () => {
          if (releaseLock !== release) return;
          releaseLock = null;
          resolve();
        };
        releaseLock = release;
        if (disposed || !active || generation !== requestGeneration) release();
      });
    };

    const onLockError = (error: unknown, generation: number) => {
      if (disposed || !active || generation !== requestGeneration) return;
      ownershipPhaseRef.current = "none";
      pendingReconnectSessionsRef.current.clear();
      setAutomaticSyncStatus({
        ...IDLE_AUTOMATIC_SYNC_STATUS,
        error:
          error instanceof Error
            ? error.message
            : "Failed to acquire automatic peer sync ownership",
      });
    };

    const requestOwnership = () => {
      if (disposed || !active) return;
      const generation = ++requestGeneration;
      ownershipPhaseRef.current = "candidate";

      if (!locks) {
        // Preserve single-tab behavior where Web Locks is unavailable.
        void holdLock(generation);
        return;
      }

      abortController = new AbortController();
      const signal = abortController.signal;
      // Classify a contended tab before it waits, so it cannot retain a
      // reconnect session and replay it after a later ownership handoff.
      void locks
        .request(lockName, { ifAvailable: true }, async (lock) => {
          if (disposed || !active || generation !== requestGeneration) return;
          if (lock) {
            await holdLock(generation);
            return;
          }

          ownershipPhaseRef.current = "follower";
          pendingReconnectSessionsRef.current.clear();
          void locks
            .request(lockName, { signal }, async () => {
              await holdLock(generation);
            })
            .catch((error: unknown) => onLockError(error, generation));
        })
        .catch((error: unknown) => onLockError(error, generation));
    };

    const suspend = () => {
      if (!active) return;
      active = false;
      relinquish();
    };
    const resume = () => {
      if (active) return;
      active = true;
      requestOwnership();
      presence.retryNow();
    };

    window.addEventListener("pagehide", suspend);
    window.addEventListener("pageshow", resume);
    document.addEventListener("freeze", suspend);
    document.addEventListener("resume", resume);
    requestOwnership();

    return () => {
      disposed = true;
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("freeze", suspend);
      document.removeEventListener("resume", resume);
      relinquish();
      if (releaseOwnershipRef.current === relinquish) {
        releaseOwnershipRef.current = null;
      }
    };
  }, [
    automaticReconnectEnabled,
    authenticatedPresence,
    localDeviceId,
    project,
    securityState,
    stopAutomaticPeerSync,
    vaultSession,
  ]);

  useEffect(() => {
    setAutomaticSyncStatus(IDLE_AUTOMATIC_SYNC_STATUS);
    if (
      ownershipVersion === 0 ||
      ownershipVersion !== ownershipVersionRef.current ||
      !ownsAutomaticPeerSyncRef.current ||
      !projectKeyReady ||
      !project ||
      !localDeviceId ||
      !securityState ||
      !vaultSession
    ) {
      return;
    }

    const presence = presenceRef.current;
    if (!presence) return;

    try {
      const automaticPeerSync = new AutomaticPeerSyncManager({
        coordinatorBaseUrl,
        project,
        localDeviceId,
        securityState,
        vaultSession,
        presence,
        relayFallbackEnabled: true,
        rtcConfigurationProvider: (mode) =>
          mode === "relay"
            ? resolveRelayRtcConfiguration(
                import.meta.env.DEV ? turnCredentialEndpoint : null,
                () => presence.requestTurnCredentials(),
              )
            : Promise.resolve(undefined),
        onStatusChange: setAutomaticSyncStatus,
        onDocumentVersionConfirmed,
      });
      automaticPeerSyncRef.current = automaticPeerSync;

      if (presence.state === "open") {
        const currentOnlineDeviceIds = onlineDeviceIdsRef.current;
        automaticPeerSync.updateOnlineDevices(currentOnlineDeviceIds);
        drainPendingReconnectSessions(automaticPeerSync, currentOnlineDeviceIds);
      }

      return () => {
        if (automaticPeerSyncRef.current === automaticPeerSync) {
          stopAutomaticPeerSync();
          pendingReconnectSessionsRef.current.clear();
        }
      };
    } catch (error) {
      stopAutomaticPeerSync();
      releaseOwnershipRef.current?.();
      setAutomaticSyncStatus({
        ...IDLE_AUTOMATIC_SYNC_STATUS,
        error:
          error instanceof Error
            ? error.message
            : "Failed to start automatic peer sync",
      });
    }
  }, [
    coordinatorBaseUrl,
    localDeviceId,
    onDocumentVersionConfirmed,
    ownershipVersion,
    project,
    projectKeyReady,
    securityState,
    stopAutomaticPeerSync,
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
    requestTurnCredentials,
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
      return;
    }

    const transport = new BroadcastChannelTransport(project.id);
    const encryptedTransport = new EncryptedSyncTransport(transport, {
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
    });
    const syncEngine = new WorkspaceSyncEngine(project, encryptedTransport, {
      relayScope: "local-tab",
    });
    syncEngine.start();

    return () => syncEngine.stop();
  }, [
    enabled,
    project,
    projectKeyReady,
    securityState,
    vaultSession,
  ]);
}
