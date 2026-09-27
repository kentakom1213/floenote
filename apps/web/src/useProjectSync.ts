import { useCallback, useEffect, useRef, useState } from "react";

import {
  AuthorizedPresenceClient,
  type AuthorizedPresenceConnectionState,
  type CreatedInvitation,
} from "@floe-note/coordinator-client";
import type { NoteProject } from "@floe-note/document";
import type { DeviceId } from "@floe-note/domain";
import type { SecurityState } from "@floe-note/security";
import {
  EncryptedSyncTransport,
  ProjectSyncEngine,
} from "@floe-note/sync";
import { BroadcastChannelTransport } from "@floe-note/transport/broadcast-channel";
import type { DeviceVaultSession } from "@floe-note/vault";

import {
  AutomaticPeerSyncManager,
  type AutomaticPeerSyncStatus,
} from "./AutomaticPeerSyncManager.js";
import { resolveRelayRtcConfiguration } from "./turn-credentials.js";

type AuthorizedProjectSyncOptions = {
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

export type AuthorizedProjectSyncState = {
  presenceState: AuthorizedPresenceConnectionState;
  onlineDeviceIds: readonly DeviceId[];
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

export function useAuthorizedProjectSync({
  coordinatorBaseUrl,
  project,
  localDeviceId,
  securityState,
  projectKeyReady,
  vaultSession,
  automaticReconnectEnabled,
  turnCredentialEndpoint,
  onSecurityStateChanged,
}: AuthorizedProjectSyncOptions): AuthorizedProjectSyncState {
  const [presenceState, setPresenceState] =
    useState<AuthorizedPresenceConnectionState>("idle");
  const [onlineDeviceIds, setOnlineDeviceIds] =
    useState<readonly DeviceId[]>([]);
  const [presenceError, setPresenceError] = useState<string | null>(null);
  const [automaticSyncStatus, setAutomaticSyncStatus] =
    useState<AutomaticPeerSyncStatus>(IDLE_AUTOMATIC_SYNC_STATUS);
  const presenceRef = useRef<AuthorizedPresenceClient | null>(null);
  const automaticPeerSyncRef = useRef<AutomaticPeerSyncManager | null>(null);

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
      projectId: project.id,
      deviceId: localDeviceId,
      securityHead: securityState.headHash,
      sign: (message) => vaultSession.sign(message),
    });
    presenceRef.current = presence;

    const stopState = presence.onStateChange((state) => {
      setPresenceState(state);
      if (state === "connecting" || state === "open") {
        setPresenceError(null);
      }
    });
    const stopDevices = presence.onOnlineDevicesChange((deviceIds) => {
      setOnlineDeviceIds(deviceIds);
      automaticPeerSyncRef.current?.updateOnlineDevices(deviceIds);
    });
    const stopReconnect = presence.onReconnectSession(
      (fromDeviceId, sessionId, transportMode) => {
        automaticPeerSyncRef.current?.acceptReconnectSession(
          fromDeviceId,
          sessionId,
          transportMode,
        );
      },
    );
    const stopErrors = presence.onError((error) => {
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

    window.addEventListener("online", retryPresenceNow);
    document.addEventListener("visibilitychange", retryPresenceWhenVisible);

    setPresenceError(null);
    presence.start();

    return () => {
      window.removeEventListener("online", retryPresenceNow);
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
    automaticPeerSyncRef.current?.stop();
    automaticPeerSyncRef.current = null;
    setAutomaticSyncStatus(IDLE_AUTOMATIC_SYNC_STATUS);

    if (
      !automaticReconnectEnabled ||
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

    const automaticPeerSync = new AutomaticPeerSyncManager({
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

    if (presence.state === "open") {
      automaticPeerSync.updateOnlineDevices(onlineDeviceIds);
    }

    return () => {
      if (automaticPeerSyncRef.current === automaticPeerSync) {
        automaticPeerSyncRef.current = null;
      }
      automaticPeerSync.stop();
      setAutomaticSyncStatus(IDLE_AUTOMATIC_SYNC_STATUS);
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
    const syncEngine = new ProjectSyncEngine(project, encryptedTransport);
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
