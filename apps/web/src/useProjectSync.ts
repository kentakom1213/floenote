import { useEffect, useState } from "react";

import {
  AuthorizedPresenceClient,
  type AuthorizedPresenceConnectionState,
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

  useEffect(() => {
    if (!project || !localDeviceId || !securityState || !vaultSession) {
      setPresenceState("idle");
      setOnlineDeviceIds([]);
      setPresenceError(null);
      setAutomaticSyncStatus(IDLE_AUTOMATIC_SYNC_STATUS);
      return;
    }

    const presence = new AuthorizedPresenceClient({
      coordinatorBaseUrl,
      projectId: project.id,
      deviceId: localDeviceId,
      securityHead: securityState.headHash,
      sign: (message) => vaultSession.sign(message),
    });

    const automaticPeerSync =
      automaticReconnectEnabled && projectKeyReady
        ? new AutomaticPeerSyncManager({
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
          })
        : null;

    const stopState = presence.onStateChange((state) => {
      setPresenceState(state);
      if (state === "connecting" || state === "open") {
        setPresenceError(null);
      }
    });
    const stopDevices = presence.onOnlineDevicesChange((deviceIds) => {
      setOnlineDeviceIds(deviceIds);
      automaticPeerSync?.updateOnlineDevices(deviceIds);
    });
    const stopReconnect = presence.onReconnectSession(
      (fromDeviceId, sessionId, transportMode) => {
        automaticPeerSync?.acceptReconnectSession(
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
    setAutomaticSyncStatus(IDLE_AUTOMATIC_SYNC_STATUS);
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
      automaticPeerSync?.stop();
      presence.close();
      setOnlineDeviceIds([]);
      setAutomaticSyncStatus(IDLE_AUTOMATIC_SYNC_STATUS);
    };
  }, [
    automaticReconnectEnabled,
    coordinatorBaseUrl,
    localDeviceId,
    onSecurityStateChanged,
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
        vaultSession.encryptProjectSyncPayload(
          securityState.projectId,
          securityState.keyEpoch,
          plaintext,
        ),
      decrypt: (envelope) =>
        vaultSession.decryptProjectSyncPayload(
          securityState.projectId,
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
