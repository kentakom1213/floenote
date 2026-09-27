import { useCallback, useEffect, useRef, useState } from "react";

import { sha256, verifyEd25519Signature } from "@floe-note/crypto";
import {
  createPairingSecret,
  createSessionId,
  InvitationClient,
  SecurityCoordinatorClient,
  WebRtcSignalingSession,
  type InviteId,
  type PairingSecret,
  type SessionId,
  type SignalingConnectionState,
} from "@floe-note/coordinator-client";
import type { NoteProject } from "@floe-note/document";
import type {
  DeviceId,
  DocumentId,
  WorkspaceId,
} from "@floe-note/domain";
import {
  authenticatePairingChannel,
  exchangeJoiningDeviceIdentity,
  sendWorkspaceKeyDelivery,
  type JoiningDeviceInfo,
} from "@floe-note/pairing";
import {
  attachAddDeviceSignature,
  attachCreateWorkspaceSignature,
  attachWorkspaceKeyRotationEnvelopeSignature,
  attachRevokeDeviceSignature,
  createUnsignedAddDeviceTransition,
  createUnsignedRevokeDeviceTransition,
  createUnsignedCreateWorkspaceTransition,
  deriveAddDeviceSecurityState,
  deriveInitialSecurityState,
  deriveRevokeDeviceSecurityState,
  encodeAddDeviceTransition,
  encodeCreateWorkspaceTransition,
  encodeRevokeDeviceTransition,
  encodeUnsignedWorkspaceKeyRotationEnvelope,
  encodeUnsignedAddDeviceTransition,
  encodeUnsignedCreateWorkspaceTransition,
  encodeUnsignedRevokeDeviceTransition,
  type SecurityState,
} from "@floe-note/security";
import {
  DexieWorkspaceStorage,
  type StoredWorkspaceSummary,
} from "@floe-note/storage";
import {
  EncryptedSyncTransport,
  WorkspaceSyncEngine,
} from "@floe-note/sync";
import { WebRtcTransport } from "@floe-note/transport/webrtc";
import {
  WebAuthnPrfDeviceVault,
  type DeviceVaultSession,
} from "@floe-note/vault";

import { useBrowserNavigation } from "./browser-navigation.js";
import {
  buildNoteUrl,
  buildTrashNoteUrl,
  buildTrashUrl,
  buildWorkspaceSettingsUrl,
  buildWorkspaceUrl,
  parseLocation,
  type BrowserRoute,
} from "./browser-route.js";
import { createConsoleDebugLogger } from "./debug.js";
import { DebugEnvironmentPanel } from "./DebugEnvironmentPanel.js";
import type {
  DeviceVaultUiState,
  LocalSecurityBootstrapUiState,
} from "./DeviceVaultPanel.js";
import {
  InvitationHostPanel,
  type DeviceAuthorizationUiState,
} from "./InvitationHostPanel.js";
import { AppSettingsView } from "./AppSettingsView.js";
import { InvitationJoinPage } from "./InvitationJoinPage.js";
import {
  closeOwnedDeviceVaultSession,
  type DeviceVaultSessionOwner,
} from "./device-vault-session-owner.js";
import { replaceInvitationUrlWithWorkspace } from "./invitation-url.js";
import { NoteWorkspace } from "./NoteWorkspace.js";
import { selectNextDocumentAfterDeletion } from "./sidebar-navigation.js";
import {
  clearAllLastDocumentPreferences,
  readLastDocumentId,
  writeLastDocumentId,
} from "./note-preference.js";
import { clearAllNoteRecency } from "./note-recency.js";
import { ProjectEmptyState } from "./ProjectEmptyState.js";
import { deriveEntrySurface } from "./onboarding-state.js";
import { exportProjectToBrowser } from "./portable-export-download.js";
import { importPortableProjectArchive } from "./portable-import-integration.js";
import { importMarkdownDirectory } from "./markdown-directory-import-integration.js";
import { ProjectSettingsView } from "./ProjectSettingsView.js";
import { resolveRootRoute } from "./root-route.js";
import { ProjectSwitcher } from "./ProjectSwitcher.js";
import {
  SyncStatus,
  type SyncDeviceUi,
} from "./SyncStatus.js";
import { deriveSyncUiState } from "./sync-ui-state.js";
import { clearThemePreference, useThemePreference } from "./theme.js";
import { SignaledJoinPage } from "./SignaledJoinPage.js";
import { resolveRtcConfiguration } from "./turn-credentials.js";
import {
  clearTurnCredentialEndpoint,
  readTurnCredentialEndpoint,
  useTurnCredentialEndpoint,
} from "./turn-preference.js";
import { clearSidebarPreference } from "./sidebar-preference.js";
import { storeVerifiedRotatedProjectKey } from "./project-key-recovery.js";
import {
  reconcileVerifiedSecurityState,
  securityStatesEqual,
} from "./security-reconciliation.js";
import { SignalingHostPanel } from "./SignalingHostPanel.js";
import { WebRtcDebugPanel } from "./WebRtcDebugPanel.js";
import { UnlockScreen } from "./UnlockScreen.js";
import { WebRtcJoinPage } from "./WebRtcJoinPage.js";
import {
  useAuthorizedWorkspaceSync,
  useEncryptedLocalTabSync,
} from "./useWorkspaceSync.js";

const workspaceStorage = new DexieWorkspaceStorage();
const deviceVault = new WebAuthnPrfDeviceVault();
const searchParams = new URLSearchParams(window.location.search);
const legacyDebugRoutesEnabled = import.meta.env.DEV;
const useManualWebRtc =
  legacyDebugRoutesEnabled && searchParams.get("transport") === "webrtc";
const useSignaledWebRtc =
  legacyDebugRoutesEnabled && searchParams.get("transport") === "signal";
const INVITATION_ICE_RESTART_RETRY_DELAYS_MS = [5_000, 5_000] as const;
const useAutomaticReconnect = !useManualWebRtc && !useSignaledWebRtc;
const useManualWebRtcJoin =
  legacyDebugRoutesEnabled && searchParams.get("join") === "webrtc";
const useSignaledWebRtcJoin =
  legacyDebugRoutesEnabled && searchParams.get("join") === "signal";

function readInvitationJoinRoute(): {
  inviteId: string;
  pairingSecret: string | null;
} | null {
  const match = /^\/join\/v1\/([0-9a-f]{32})$/i.exec(
    window.location.pathname,
  );
  const inviteId = match?.[1];
  if (!inviteId) return null;

  return {
    inviteId,
    pairingSecret: new URLSearchParams(
      window.location.hash.slice(1),
    ).get("s"),
  };
}
const coordinatorBaseUrl =
  import.meta.env.VITE_COORDINATOR_URL ?? "http://localhost:8787";
const securityCoordinator = new SecurityCoordinatorClient(coordinatorBaseUrl);

type OpenedProject = {
  project: NoteProject;
  isNew: boolean;
};

type InvitationHostState = {
  inviteId: InviteId;
  pairingSecret: PairingSecret;
  sessionId: SessionId;
  expiresAt: number;
};

export function App() {
  const [invitationJoinRoute, setInvitationJoinRoute] = useState(
    readInvitationJoinRoute,
  );
  const deviceVaultSessionOwner = useRef<DeviceVaultSession | null>(null);

  useEffect(() => {
    return () => {
      void closeOwnedDeviceVaultSession(deviceVaultSessionOwner);
    };
  }, []);

  function handoffJoinedDeviceVaultSession(
    session: DeviceVaultSession,
    workspaceId: WorkspaceId,
  ): void {
    if (deviceVaultSessionOwner.current) {
      throw new Error("A Device Vault session is already active");
    }

    replaceInvitationUrlWithWorkspace(window.history, workspaceId);
    deviceVaultSessionOwner.current = session;
    setInvitationJoinRoute(null);
  }

  if (invitationJoinRoute) {
    return (
      <InvitationJoinPage
        coordinatorBaseUrl={coordinatorBaseUrl}
        inviteId={invitationJoinRoute.inviteId}
        pairingSecret={invitationJoinRoute.pairingSecret}
        storage={workspaceStorage}
        turnCredentialEndpoint={readTurnCredentialEndpoint()}
        onSessionHandoff={handoffJoinedDeviceVaultSession}
      />
    );
  }

  if (useManualWebRtcJoin) {
    return <WebRtcJoinPage storage={workspaceStorage} />;
  }

  if (useSignaledWebRtcJoin) {
    return (
      <SignaledJoinPage
        storage={workspaceStorage}
        coordinatorBaseUrl={coordinatorBaseUrl}
        projectId={searchParams.get("project")}
        sessionId={searchParams.get("session")}
      />
    );
  }

  return <NoteApp deviceVaultSessionOwner={deviceVaultSessionOwner} />;
}

function NoteApp({
  deviceVaultSessionOwner,
}: {
  deviceVaultSessionOwner: DeviceVaultSessionOwner;
}) {
  const [themePreference, setThemePreference] = useThemePreference();
  const [turnCredentialEndpoint, setTurnCredentialEndpoint] =
    useTurnCredentialEndpoint();
  const [openedProject, setOpenedProject] = useState<OpenedProject | null>(null);
  const [projectSummaries, setProjectSummaries] = useState<
    readonly StoredWorkspaceSummary[]
  >([]);
  const [projectCatalogReady, setProjectCatalogReady] = useState(false);
  const [projectSwitching, setProjectSwitching] = useState(false);
  const [mainView, setMainView] = useState<
    "note" | "trash" | "app-settings" | "project-settings"
  >("note");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<DocumentId | null>(null);
  const [focusTitleDocumentId, setFocusTitleDocumentId] =
    useState<DocumentId | null>(null);
  const [webRtcTransport, setWebRtcTransport] =
    useState<WebRtcTransport | null>(null);
  const [signalingState, setSignalingState] =
    useState<SignalingConnectionState>("idle");
  const [signalSessionId] = useState(() => createSessionId());
  const [invitationHostActive, setInvitationHostActive] = useState(false);
  const [invitationHost, setInvitationHost] =
    useState<InvitationHostState | null>(null);
  const [joiningDevice, setJoiningDevice] =
    useState<JoiningDeviceInfo | null>(null);
  const [deviceAuthorizationState, setDeviceAuthorizationState] =
    useState<DeviceAuthorizationUiState>("waiting");
  const [coordinationError, setCoordinationError] = useState<string | null>(
    null,
  );
  const deviceVaultSessionRef = deviceVaultSessionOwner;
  const securityMutationInFlightRef = useRef(false);
  const invitationSyncEngineRef = useRef<WorkspaceSyncEngine | null>(null);
  const [deviceVaultState, setDeviceVaultState] =
    useState<DeviceVaultUiState>("checking");
  const [localDeviceId, setLocalDeviceId] = useState<DeviceId | null>(null);
  const [localDeviceName, setLocalDeviceName] = useState<string | null>(null);
  const [deviceVaultError, setDeviceVaultError] = useState<string | null>(null);
  const [localSecurityBootstrapState, setLocalSecurityBootstrapState] =
    useState<LocalSecurityBootstrapUiState>("waiting");
  const [localSecurityState, setLocalSecurityState] =
    useState<SecurityState | null>(null);
  const [localSecurityError, setLocalSecurityError] =
    useState<string | null>(null);
  const [securityCoordinationState, setSecurityCoordinationState] = useState<
    "checking" | "ready" | "error"
  >("checking");
  const [securityCoordinationError, setSecurityCoordinationError] =
    useState<string | null>(null);
  const [localProjectKeyReady, setLocalProjectKeyReady] =
    useState<boolean | null>(null);
  const [securityRefreshToken, setSecurityRefreshToken] = useState(0);
  const [workspaceKeyDeliveryState, setWorkspaceKeyDeliveryState] = useState<
    "waiting" | "delivering" | "delivered" | "error"
  >("waiting");
  const {
    route: browserRoute,
    routeError,
    setRouteError,
    pushRoute,
    replaceRoute,
  } = useBrowserNavigation();
  const [trashDocumentId, setTrashDocumentId] = useState<DocumentId | null>(null);

  const project = openedProject?.project ?? null;

  useEffect(() => {
    let cancelled = false;
    const existingSession = deviceVaultSessionRef.current;

    if (existingSession) {
      void adoptDeviceVaultSession(existingSession).catch((error: unknown) => {
        if (!cancelled) {
          setDeviceVaultState("error");
          setDeviceVaultError(
            error instanceof Error
              ? error.message
              : "Failed to adopt Device Vault session",
          );
        }
      });

      return () => {
        cancelled = true;
      };
    }

    void deviceVault
      .hasVault()
      .then((exists) => {
        if (!cancelled) {
          setDeviceVaultState(exists ? "locked" : "missing");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDeviceVaultState("error");
          setDeviceVaultError(
            error instanceof Error
              ? error.message
              : "Failed to inspect Device Vault",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (
      !project ||
      !localDeviceId ||
      deviceVaultState !== "unlocked"
    ) {
      setLocalSecurityBootstrapState("waiting");
      setLocalSecurityState(null);
      setLocalSecurityError(null);
      setSecurityCoordinationState("checking");
      setSecurityCoordinationError(null);
      setLocalProjectKeyReady(null);
      return;
    }

    const session = deviceVaultSessionRef.current;
    if (!session) return;

    let cancelled = false;
    setLocalSecurityBootstrapState("committing");
    setLocalSecurityState(null);
    setLocalSecurityError(null);
    setSecurityCoordinationState("checking");
    setSecurityCoordinationError(null);
    setLocalProjectKeyReady(null);

    void (async () => {
      const storedState = await workspaceStorage.loadSecurityState(project.id);
      if (storedState) {
        if (
          !storedState.devices.some(
            (device) => device.deviceId === localDeviceId,
          )
        ) {
          throw new Error(
            "This Device Vault identity is not authorized by the locally verified SecurityState",
          );
        }

        const cachedProjectKeyReady = await ensureInitialProjectKey(
          session,
          storedState,
          localDeviceId,
        );

        if (cachedProjectKeyReady && !cancelled) {
          setLocalSecurityState(storedState);
          setLocalSecurityBootstrapState("committed");
          setLocalProjectKeyReady(true);
        }

        try {
          const verifiedState = await reconcileVerifiedSecurityState(
            securityCoordinator,
            storedState,
          );

          if (
            !verifiedState.devices.some(
              (device) => device.deviceId === localDeviceId,
            )
          ) {
            throw new Error(
              "This device is no longer authorized by the coordinator SecurityState",
            );
          }

          let projectKeyReady = await ensureInitialProjectKey(
            session,
            verifiedState,
            localDeviceId,
          );

          if (!projectKeyReady && verifiedState.keyEpoch > 1) {
            const envelope = await securityCoordinator.getWorkspaceKeyEnvelope(
              verifiedState.workspaceId,
              verifiedState.keyEpoch,
              localDeviceId,
            );
            await storeVerifiedRotatedProjectKey(
              session,
              verifiedState,
              localDeviceId,
              envelope,
            );
            projectKeyReady = true;
          }

          if (!projectKeyReady) {
            throw new Error(
              "Current WorkspaceKey is not available on this device",
            );
          }

          if (!securityStatesEqual(storedState, verifiedState)) {
            await workspaceStorage.saveCommittedSecurityState(verifiedState);
          }

          if (!cancelled) {
            setLocalSecurityState(verifiedState);
            setLocalSecurityBootstrapState("committed");
            setLocalProjectKeyReady(true);
            setSecurityCoordinationState("ready");
            setSecurityCoordinationError(null);
          }
        } catch (error: unknown) {
          if (cancelled) return;

          if (cachedProjectKeyReady) {
            setSecurityCoordinationState("error");
            setSecurityCoordinationError(
              error instanceof Error
                ? error.message
                : "Could not refresh Workspace coordination state",
            );
            return;
          }

          throw error;
        }
        return;
      }

      const identity = session.publicIdentity;
      if (identity.deviceId !== localDeviceId) {
        throw new Error("Unlocked Device Vault identity changed unexpectedly");
      }

      const unsignedTransition = createUnsignedCreateWorkspaceTransition(
        project.id,
        identity,
      );
      const signingBytes =
        encodeUnsignedCreateWorkspaceTransition(unsignedTransition);
      const signature = await session.sign(signingBytes);
      const transition = attachCreateWorkspaceSignature(
        unsignedTransition,
        signature,
      );

      const verified = await verifyEd25519Signature(
        signingBytes,
        transition.signature,
        transition.initialDevice.signingPublicKey,
      );
      if (!verified) {
        throw new Error("CreateWorkspace signature verification failed");
      }

      const headHash = await sha256(
        encodeCreateWorkspaceTransition(transition),
      );
      const candidateState = deriveInitialSecurityState(
        transition,
        headHash,
      );
      const committedState = await securityCoordinator.commitCreateWorkspace(
        project.id,
        transition,
      );

      if (!securityStatesEqual(candidateState, committedState)) {
        throw new Error(
          "Coordinator committed a SecurityState that does not match CreateWorkspace",
        );
      }

      await workspaceStorage.saveCommittedSecurityState(committedState);
      const projectKeyReady = await ensureInitialProjectKey(
        session,
        committedState,
        localDeviceId,
      );

      if (!cancelled) {
        setLocalSecurityState(committedState);
        setLocalSecurityBootstrapState("committed");
        setLocalProjectKeyReady(projectKeyReady);
        setSecurityCoordinationState("ready");
        setSecurityCoordinationError(null);
      }
    })().catch((error: unknown) => {
      if (cancelled) return;
      const message =
        error instanceof Error
          ? error.message
          : "Failed to create local SecurityState";
      setLocalSecurityBootstrapState("error");
      setLocalSecurityState(null);
      setLocalSecurityError(message);
      setSecurityCoordinationState("error");
      setSecurityCoordinationError(message);
      setLocalProjectKeyReady(null);
    });

    return () => {
      cancelled = true;
    };
  }, [deviceVaultState, localDeviceId, project, securityRefreshToken]);

  const handleSecurityStateChanged = useCallback(() => {
    if (!securityMutationInFlightRef.current) {
      setSecurityRefreshToken((value) => value + 1);
    }
  }, []);

  const automaticReconnectEnabled =
    useAutomaticReconnect && !invitationHostActive;

  const authorizedSync = useAuthorizedWorkspaceSync({
    coordinatorBaseUrl,
    project,
    localDeviceId,
    securityState: localSecurityState,
    projectKeyReady: localProjectKeyReady,
    vaultSession: deviceVaultSessionRef.current,
    automaticReconnectEnabled,
    turnCredentialEndpoint,
    onSecurityStateChanged: handleSecurityStateChanged,
  });

  useEncryptedLocalTabSync({
    enabled: automaticReconnectEnabled,
    project,
    securityState: localSecurityState,
    projectKeyReady: localProjectKeyReady,
    vaultSession: deviceVaultSessionRef.current,
  });

  useEffect(() => {
    if (!project) return;

    return project.subscribe(() => {
      const session = deviceVaultSessionRef.current;
      if (session) {
        syncLocalDeviceName(project, session);
      }
      setRevision((value) => value + 1);
    });
  }, [project]);

  useEffect(() => {
    if (
      !project ||
      !localSecurityState ||
      !localProjectKeyReady ||
      deviceVaultState !== "unlocked"
    ) {
      return;
    }

    const session = deviceVaultSessionRef.current;
    if (!session) return;

    return workspaceStorage.watchWorkspace(
      project,
      session,
      localSecurityState.keyEpoch,
    );
  }, [
    deviceVaultState,
    localProjectKeyReady,
    localSecurityState,
    project,
  ]);

  useEffect(() => {
    if (!project) return;

    setCoordinationError(null);
    setJoiningDevice(null);
    setDeviceAuthorizationState("waiting");
    setWorkspaceKeyDeliveryState("waiting");
    invitationSyncEngineRef.current?.stop();
    invitationSyncEngineRef.current = null;

    if (invitationHostActive) {
      let disposed = false;
      let cleanup: (() => void) | null = null;
      let invitationTransport: WebRtcTransport | null = null;

      void (async () => {
        try {
          const pairingSecret = createPairingSecret();
          const invitation = await authorizedSync.createInvitation();
          if (disposed) return;

          const transport = new WebRtcTransport(
            project.id,
            await resolveRtcConfiguration(turnCredentialEndpoint),
            createConsoleDebugLogger("invite-host-webrtc"),
          );
          invitationTransport = transport;
          setWebRtcTransport(transport);

          const abortPairing = new AbortController();

          const signaling = new WebRtcSignalingSession({
            role: "host",
            coordinatorBaseUrl,
            workspaceId: project.id,
            sessionId: invitation.sessionId,
            transport,
            debugLogger: createConsoleDebugLogger("invite-host-signal"),
            iceRestartRetryDelaysMs: INVITATION_ICE_RESTART_RETRY_DELAYS_MS,
          });
          const stopSignalingState =
            signaling.onConnectionStateChange(setSignalingState);
          let cleanedUp = false;
          cleanup = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            abortPairing.abort();
            stopSignalingState();
            signaling.stop();

            const syncEngine = invitationSyncEngineRef.current;
            invitationSyncEngineRef.current = null;
            if (syncEngine) {
              syncEngine.stop();
            } else {
              transport.close();
            }
            invitationTransport = null;
          };

          signaling.start();

          void authenticatePairingChannel({
            role: "host",
            inviteId: invitation.inviteId,
            workspaceId: project.id,
            sessionId: invitation.sessionId,
            pairingSecret,
            transport,
            signal: abortPairing.signal,
          })
            .then(() =>
              exchangeJoiningDeviceIdentity({
                role: "host",
                transport,
                signal: abortPairing.signal,
              }),
            )
            .then((identity) => {
              if (disposed) return;
              setJoiningDevice(identity);
              setDeviceAuthorizationState("ready");
            })
            .catch((error: unknown) => {
              if (disposed || abortPairing.signal.aborted) return;
              cleanup?.();
              cleanup = null;
              setWebRtcTransport(null);
              setCoordinationError(
                error instanceof Error
                  ? error.message
                  : "Pairing bootstrap failed",
              );
            });

          setInvitationHost({
            inviteId: invitation.inviteId,
            pairingSecret,
            sessionId: invitation.sessionId,
            expiresAt: invitation.expiresAt,
          });
        } catch (caught: unknown) {
          if (cleanup) {
            cleanup();
            cleanup = null;
          } else {
            invitationTransport?.close();
            invitationTransport = null;
          }
          setWebRtcTransport(null);

          if (!disposed) {
            setCoordinationError(
              caught instanceof Error
                ? caught.message
                : "Failed to create invitation",
            );
          }
        }
      })();

      return () => {
        disposed = true;
        if (cleanup) {
          cleanup();
          cleanup = null;
        } else {
          invitationTransport?.close();
          invitationTransport = null;
        }
        setInvitationHost(null);
      };
    }

    if (useManualWebRtc || useSignaledWebRtc) {
      const transport = new WebRtcTransport(
        project.id,
        undefined,
        createConsoleDebugLogger(
          useSignaledWebRtc ? "signal-host-webrtc" : "webrtc",
        ),
      );
      setWebRtcTransport(transport);

      const syncEngine = new WorkspaceSyncEngine(project, transport, {
        debugLogger: createConsoleDebugLogger(
          useSignaledWebRtc ? "signal-host-sync" : "sync",
        ),
      });
      syncEngine.start();

      if (!useSignaledWebRtc) {
        return () => syncEngine.stop();
      }

      const signaling = new WebRtcSignalingSession({
        role: "host",
        coordinatorBaseUrl,
        workspaceId: project.id,
        sessionId: signalSessionId,
        transport,
        debugLogger: createConsoleDebugLogger("signal-host"),
      });
      const stopSignalingState =
        signaling.onConnectionStateChange(setSignalingState);
      signaling.start();

      return () => {
        stopSignalingState();
        signaling.stop();
        syncEngine.stop();
      };
    }

    setWebRtcTransport(null);
    setSignalingState("idle");
    return;
  }, [
    authorizedSync.createInvitation,
    invitationHostActive,
    project,
    signalSessionId,
    turnCredentialEndpoint,
  ]);

  useEffect(() => {
    if (
      !invitationHostActive ||
      workspaceKeyDeliveryState !== "delivered" ||
      !webRtcTransport
    ) {
      return;
    }

    if (webRtcTransport.dataChannelState === "closed") {
      exitInvitationHost(true);
      return;
    }

    let dataChannelWasOpen = webRtcTransport.dataChannelState === "open";
    return webRtcTransport.onStatusChange((status) => {
      if (status.dataChannelState === "open") {
        dataChannelWasOpen = true;
        return;
      }

      if (dataChannelWasOpen && status.dataChannelState === "closed") {
        exitInvitationHost(true);
      }
    });
  }, [
    invitationHostActive,
    workspaceKeyDeliveryState,
    webRtcTransport,
  ]);

  useEffect(() => {
    if (deviceVaultState !== "unlocked" || !projectCatalogReady) return;

    if (browserRoute.kind === "not-found") {
      setRouteError(true);
      return;
    }

    if (browserRoute.kind === "invitation") return;

    if (browserRoute.kind === "device-settings") {
      setRouteError(false);
      setMainView("app-settings");
      setTrashDocumentId(null);
      return;
    }

    if (browserRoute.kind === "root") {
      setRouteError(false);

      const rootResolution = resolveRootRoute(
        project,
        projectSummaries,
        project ? readLastDocumentId(project.id) : null,
      );

      if (rootResolution.kind === "open-workspace") {
        if (!projectSwitching) {
          void selectProject(rootResolution.workspaceId, false).catch(() => {
            setRouteError(true);
          });
        }
        return;
      }

      if (rootResolution.kind === "empty") return;

      setSelectedId(rootResolution.noteId);
      writeLastDocumentId(rootResolution.workspaceId, rootResolution.noteId);
      setMainView("note");
      setTrashDocumentId(null);
      replaceRoute(
        rootResolution.noteId
          ? buildNoteUrl(rootResolution.workspaceId, rootResolution.noteId)
          : buildWorkspaceUrl(rootResolution.workspaceId),
      );
      return;
    }

    const requestedWorkspaceId = workspaceIdFromRoute(browserRoute);
    if (!requestedWorkspaceId) return;

    if (!projectSummaries.some((summary) => summary.id === requestedWorkspaceId)) {
      setRouteError(true);
      return;
    }

    if (!project || requestedWorkspaceId !== project.id) {
      setRouteError(false);
      if (!projectSwitching) {
        void selectProject(requestedWorkspaceId, false).catch(() => {
          setRouteError(true);
        });
      }
      return;
    }

    setRouteError(false);

    if (browserRoute.kind === "workspace") {
      const rememberedId = readLastDocumentId(project.id);
      const nextId =
        rememberedId && project.getDocument(rememberedId)
          ? rememberedId
          : project.listDocuments()[0]?.id ?? null;

      setSelectedId(nextId);
      writeLastDocumentId(project.id, nextId);
      setMainView("note");
      setTrashDocumentId(null);

      if (nextId) {
        replaceRoute(buildNoteUrl(project.id, nextId));
      }
      return;
    }

    if (browserRoute.kind === "workspace-settings") {
      setMainView("project-settings");
      setTrashDocumentId(null);
      return;
    }

    if (browserRoute.kind === "trash") {
      setMainView("trash");
      setTrashDocumentId(null);
      return;
    }

    if (browserRoute.kind === "trash-note") {
      if (!project.getDeletedDocument(browserRoute.noteId)) {
        setRouteError(true);
        return;
      }

      setMainView("trash");
      setTrashDocumentId(browserRoute.noteId);
      return;
    }

    if (browserRoute.kind === "note") {
      if (project.getDocument(browserRoute.noteId)) {
        setSelectedId(browserRoute.noteId);
        writeLastDocumentId(project.id, browserRoute.noteId);
        setMainView("note");
        setTrashDocumentId(null);
        return;
      }

      if (project.getDeletedDocument(browserRoute.noteId)) {
        replaceRoute(buildTrashNoteUrl(project.id, browserRoute.noteId));
        return;
      }

      setRouteError(true);
    }
  }, [
    browserRoute,
    deviceVaultState,
    project,
    projectCatalogReady,
    projectSummaries,
    projectSwitching,
    replaceRoute,
  ]);

  if (loadError) {
    return (
      <main className="empty-state">
        <p>Could not open local storage.</p>
        <p>{loadError}</p>
      </main>
    );
  }

  if (routeError && deviceVaultState === "unlocked") {
    return (
      <main className="not-found-screen">
        <div className="not-found-drift" aria-hidden="true">
          <span className="not-found-floe not-found-floe-large">◆</span>
          <span className="not-found-floe not-found-floe-medium">◆</span>
          <span className="not-found-floe not-found-floe-small">◆</span>
        </div>

        <section
          className="not-found-card"
          aria-labelledby="not-found-title"
        >
          <p className="not-found-eyebrow">404 · Drifted off course</p>
          <h1 id="not-found-title">Page not found</h1>
          <p className="not-found-copy">
            This Workspace or note is not available on this device, or the
            address may have changed.
          </p>
          <button
            className="not-found-action"
            type="button"
            onClick={() => pushRoute("/")}
          >
            <span aria-hidden="true">◆</span>
            Back to Floe Note
          </button>
        </section>
      </main>
    );
  }

  const entrySurface = deriveEntrySurface(
    deviceVaultState,
    project !== null,
  );
  const recoveringRootProject =
    deviceVaultState === "unlocked" &&
    projectCatalogReady &&
    project === null &&
    browserRoute.kind === "root" &&
    projectSummaries.length > 0;

  if (entrySurface === "checking" || recoveringRootProject) {
    return (
      <main className="onboarding-loading-screen" aria-live="polite">
        <img src="/favicon.svg" alt="" aria-hidden="true" />
        <span>Floe Note</span>
      </main>
    );
  }

  if (entrySurface === "unlock") {
    return (
      <UnlockScreen
        state={deviceVaultState}
        error={deviceVaultError}
        onUnlock={unlockDevice}
        onResetDevice={resetLockedDevice}
      />
    );
  }

  if (entrySurface === "onboarding") {
    if (deviceVaultState === "unlocked" && !projectCatalogReady) {
      return (
        <main className="onboarding-loading-screen" aria-live="polite">
          <img src="/favicon.svg" alt="" aria-hidden="true" />
          <span>Loading local Workspaces…</span>
        </main>
      );
    }

    return (
      <ProjectEmptyState
        vaultState={deviceVaultState}
        vaultError={deviceVaultError}
        theme={themePreference}
        coordinatorBaseUrl={coordinatorBaseUrl}
        localDeviceId={localDeviceId}
        localDeviceName={localDeviceName}
        turnCredentialEndpoint={turnCredentialEndpoint}
        onCreateWithExistingPasskey={createDeviceWithExistingPasskey}
        onCreateWithNewPasskey={createDeviceWithNewPasskey}
        onRenameDevice={renameLocalDevice}
        onThemeChange={setThemePreference}
        onTurnCredentialEndpointChange={setTurnCredentialEndpoint}
        onEraseDevice={eraseFloeFromThisDevice}
        onCreateProject={createProject}
        onImportFloeExport={importFloeExport}
        onImportMarkdownDirectory={importMarkdownDirectoryFiles}
      />
    );
  }

  if (!project) {
    return null;
  }

  const activeProject = project;
  const selectedDocument = selectedId
    ? activeProject.getDocument(selectedId)
    : undefined;

  async function adoptDeviceVaultSession(
    session: DeviceVaultSession,
  ): Promise<void> {
    const previous = deviceVaultSessionRef.current;
    if (previous !== session) {
      deviceVaultSessionRef.current = session;
      if (previous) await previous.close();
    }

    const summaries = await workspaceStorage.listWorkspaces(session);
    const requestedRoute = parseLocation();
    const requestedWorkspaceId = workspaceIdFromRoute(requestedRoute);
    let result: OpenedProject | null = null;

    if (requestedRoute.kind === "not-found") {
      setRouteError(true);
    } else if (requestedWorkspaceId) {
      if (summaries.some((summary) => summary.id === requestedWorkspaceId)) {
        result = await workspaceStorage.openWorkspace(
          requestedWorkspaceId,
          session,
        );

        if (
          requestedRoute.kind === "note" &&
          !result.project.getDocument(requestedRoute.noteId)
        ) {
          if (result.project.getDeletedDocument(requestedRoute.noteId)) {
            replaceRoute(
              buildTrashNoteUrl(requestedWorkspaceId, requestedRoute.noteId),
            );
          } else {
            setRouteError(true);
          }
        } else if (
          requestedRoute.kind === "trash-note" &&
          !result.project.getDeletedDocument(requestedRoute.noteId)
        ) {
          setRouteError(true);
        }
      } else {
        setRouteError(true);
      }
    } else {
      result = await workspaceStorage.openLastWorkspace(session);
    }

    if (result) {
      syncLocalDeviceName(result.project, session);

      if (
        requestedRoute.kind === "note" &&
        requestedRoute.workspaceId === result.project.id &&
        result.project.getDocument(requestedRoute.noteId)
      ) {
        setSelectedId(requestedRoute.noteId);
        writeLastDocumentId(result.project.id, requestedRoute.noteId);
      } else if (
        requestedRoute.kind === "root" ||
        (requestedRoute.kind === "workspace" &&
          requestedRoute.workspaceId === result.project.id)
      ) {
        const rememberedId = readLastDocumentId(result.project.id);
        const initialDocumentId =
          rememberedId && result.project.getDocument(rememberedId)
            ? rememberedId
            : result.project.listDocuments()[0]?.id ?? null;
        setSelectedId(initialDocumentId);
        writeLastDocumentId(result.project.id, initialDocumentId);
      }
    }
    setOpenedProject(result);
    setProjectSummaries(
      result ? withActiveProjectSummary(summaries, result.project) : summaries,
    );
    setProjectCatalogReady(true);
    setLocalDeviceId(session.publicIdentity.deviceId);
    setLocalDeviceName(session.displayName);
    setDeviceVaultState("unlocked");
  }

  async function openDeviceVault(
    open: () => Promise<DeviceVaultSession>,
  ): Promise<void> {
    if (deviceVaultState === "unlocking" || deviceVaultState === "unlocked") {
      return;
    }

    setDeviceVaultState("unlocking");
    setDeviceVaultError(null);

    try {
      await adoptDeviceVaultSession(await open());
    } catch (error: unknown) {
      setDeviceVaultState("error");
      setDeviceVaultError(
        error instanceof Error ? error.message : "Failed to unlock Device Vault",
      );
      throw error;
    }
  }

  async function unlockDevice(): Promise<void> {
    try {
      await openDeviceVault(() => deviceVault.unlock());
    } catch {
      // UnlockScreen renders the recoverable error state.
    }
  }

  async function createFirstTimeDevice(
    create: () => Promise<DeviceVaultSession>,
  ): Promise<void> {
    if (deviceVaultState !== "missing") return;

    setDeviceVaultError(null);
    try {
      await adoptDeviceVaultSession(await create());
    } catch (error: unknown) {
      setDeviceVaultState("missing");
      setDeviceVaultError(
        error instanceof Error
          ? error.message
          : "Failed to secure this device",
      );
      throw error;
    }
  }

  async function createDeviceWithExistingPasskey(
    displayName: string,
  ): Promise<void> {
    await createFirstTimeDevice(() =>
      deviceVault.createWithExistingPasskey(displayName),
    );
  }

  async function createDeviceWithNewPasskey(
    displayName: string,
  ): Promise<void> {
    await createFirstTimeDevice(() =>
      deviceVault.createWithNewPasskey(displayName),
    );
  }

  async function unlockOrCreateDevice(
    displayName?: string,
  ): Promise<void> {
    if (await deviceVault.hasVault()) {
      await unlockDevice();
      return;
    }

    await createDeviceWithNewPasskey(displayName ?? "My device");
  }

  async function resetLockedDevice(): Promise<void> {
    const previous = deviceVaultSessionRef.current;
    deviceVaultSessionRef.current = null;
    if (previous) await previous.close();

    await workspaceStorage.eraseAllLocalData();
    await deviceVault.eraseVault();
    clearAllLastDocumentPreferences();

    window.location.replace("/");
  }

  async function selectProject(
    projectId: WorkspaceId,
    updateHistory = true,
  ): Promise<void> {
    if (projectId === project?.id || projectSwitching) return;

    const session = deviceVaultSessionRef.current;
    if (!session) {
      throw new Error("Device Vault must be unlocked before switching Workspace");
    }

    setProjectSwitching(true);

    try {
      const result = await workspaceStorage.openWorkspace(projectId, session);
      syncLocalDeviceName(result.project, session);
      const summaries = await workspaceStorage.listWorkspaces(session);
      resetProjectSecurityUiState();
      setMainView("note");
      setOpenedProject(result);
      setProjectSummaries(
        withActiveProjectSummary(summaries, result.project),
      );
      setProjectCatalogReady(true);
      if (updateHistory) pushRoute(buildWorkspaceUrl(result.project.id));
    } finally {
      setProjectSwitching(false);
    }
  }

  async function createProject(name: string): Promise<void> {
    if (projectSwitching) return;

    const session = deviceVaultSessionRef.current;
    if (!session) {
      throw new Error("Device Vault must be unlocked before creating a Workspace");
    }

    setProjectSwitching(true);

    try {
      const result = await workspaceStorage.createWorkspace(name);
      const document = result.project.createDocument("Welcome to Floe Note");
      syncLocalDeviceName(result.project, session);
      const summaries = await workspaceStorage.listWorkspaces(session);
      resetProjectSecurityUiState();
      setSelectedId(document.id);
      setFocusTitleDocumentId(null);
      writeLastDocumentId(result.project.id, document.id);
      setMainView("note");
      pushRoute(buildNoteUrl(result.project.id, document.id));
      setOpenedProject(result);
      setProjectSummaries(
        withActiveProjectSummary(summaries, result.project),
      );
      setProjectCatalogReady(true);
    } finally {
      setProjectSwitching(false);
    }
  }

  async function importFloeExport(archive: Uint8Array): Promise<void> {
    if (projectSwitching) {
      throw new Error("Another Workspace operation is already in progress");
    }

    const session = deviceVaultSessionRef.current;
    if (!session) {
      throw new Error("Device Vault must be unlocked before importing a Workspace");
    }

    setProjectSwitching(true);

    try {
      const result = await importPortableProjectArchive(archive, {
        session,
        coordinator: securityCoordinator,
        storage: workspaceStorage,
      });
      const summaries = await workspaceStorage.listWorkspaces(session);
      resetProjectSecurityUiState();
      setMainView("note");
      pushRoute(buildWorkspaceUrl(result.project.id));
      setOpenedProject(result);
      setProjectSummaries(
        withActiveProjectSummary(summaries, result.project),
      );
      setProjectCatalogReady(true);
    } finally {
      setProjectSwitching(false);
    }
  }

  async function importMarkdownDirectoryFiles(
    files: readonly File[],
  ): Promise<void> {
    if (projectSwitching) {
      throw new Error("Another Workspace operation is already in progress");
    }

    const session = deviceVaultSessionRef.current;
    if (!session) {
      throw new Error("Device Vault must be unlocked before importing a Workspace");
    }

    setProjectSwitching(true);

    try {
      const result = await importMarkdownDirectory(files, {
        session,
        coordinator: securityCoordinator,
        storage: workspaceStorage,
      });
      const summaries = await workspaceStorage.listWorkspaces(session);
      resetProjectSecurityUiState();
      setMainView("note");
      pushRoute(buildWorkspaceUrl(result.project.id));
      setOpenedProject(result);
      setProjectSummaries(
        withActiveProjectSummary(summaries, result.project),
      );
      setProjectCatalogReady(true);
    } finally {
      setProjectSwitching(false);
    }
  }

  async function removeActiveProjectFromDevice(): Promise<void> {
    const session = deviceVaultSessionRef.current;
    if (!session || !project) {
      throw new Error("Workspace and Device Vault must be available");
    }

    const projectId = project.id;
    setProjectSwitching(true);
    setProjectCatalogReady(false);
    setSelectedId(null);
    setOpenedProject(null);
    resetProjectSecurityUiState();

    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    try {
      const nextWorkspaceId = await workspaceStorage.removeWorkspace(projectId);
      await session.removeWorkspaceKeys(projectId);
      writeLastDocumentId(projectId, null);

      const summaries = await workspaceStorage.listWorkspaces(session);
      if (nextWorkspaceId) {
        const next = await workspaceStorage.openWorkspace(nextWorkspaceId, session);
        setOpenedProject(next);
        setProjectSummaries(
          withActiveProjectSummary(summaries, next.project),
        );
        replaceRoute(buildWorkspaceUrl(next.project.id));
      } else {
        setProjectSummaries(summaries);
        replaceRoute("/");
      }
      setMainView("note");
      setProjectCatalogReady(true);
    } catch (error) {
      const recovered = await workspaceStorage.openLastWorkspace(session).catch(
        () => null,
      );
      const summaries = await workspaceStorage.listWorkspaces(session).catch(
        () => [],
      );
      setOpenedProject(recovered);
      setProjectSummaries(
        recovered
          ? withActiveProjectSummary(summaries, recovered.project)
          : summaries,
      );
      setProjectCatalogReady(true);
      throw error;
    } finally {
      setProjectSwitching(false);
    }
  }

  async function eraseFloeFromThisDevice(): Promise<void> {
    const session = deviceVaultSessionRef.current;

    setProjectCatalogReady(false);
    setSelectedId(null);
    setOpenedProject(null);
    resetProjectSecurityUiState();

    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    try {
      deviceVaultSessionRef.current = null;
      if (session) await session.close();

      await workspaceStorage.eraseAllLocalData();
      await deviceVault.eraseVault();
      clearThemePreference();
      clearTurnCredentialEndpoint();
      clearAllLastDocumentPreferences();
      clearAllNoteRecency();
      clearSidebarPreference();

      window.location.replace("/");
    } catch (error) {
      setDeviceVaultState("locked");
      setProjectCatalogReady(true);
      throw error;
    }
  }

  async function renameLocalDevice(displayName: string): Promise<void> {
    const session = deviceVaultSessionRef.current;
    if (!session || !localDeviceId || !project) {
      throw new Error("Device Vault and Workspace must be available");
    }

    await session.renameDevice(displayName);
    project.setDeviceDisplayName(localDeviceId, session.displayName);
    setLocalDeviceName(session.displayName);
  }

  function resetProjectSecurityUiState(): void {
    setLocalSecurityBootstrapState("waiting");
    setLocalSecurityState(null);
    setLocalSecurityError(null);
    setSecurityCoordinationState("checking");
    setSecurityCoordinationError(null);
    setLocalProjectKeyReady(null);
    setCoordinationError(null);
  }

  function exitInvitationHost(refreshSecurity = false): void {
    if (refreshSecurity) {
      setSecurityRefreshToken((value) => value + 1);
    }
    setInvitationHostActive(false);
    setWebRtcTransport(null);
    setSignalingState("idle");
    setMainView("project-settings");
  }

  async function authorizeJoiningDevice(): Promise<void> {
    if (!joiningDevice) {
      setCoordinationError("No joining device is ready for authorization");
      return;
    }

    if (!localSecurityState) {
      setCoordinationError("Committed SecurityState is not available");
      return;
    }

    const session = deviceVaultSessionRef.current;
    if (!session) {
      setCoordinationError("Device Vault must be unlocked before authorization");
      return;
    }

    if (
      !session.hasWorkspaceKey(
        localSecurityState.workspaceId,
        localSecurityState.keyEpoch,
      )
    ) {
      setCoordinationError(
        "Current WorkspaceKey is not available on this authorized device",
      );
      return;
    }

    setDeviceAuthorizationState("authorizing");
    setCoordinationError(null);

    const alreadyAuthorized = localSecurityState.devices.find(
      (device) => device.deviceId === joiningDevice.deviceId,
    );
    if (alreadyAuthorized) {
      if (
        !bytesEqual(
          alreadyAuthorized.encryptionPublicKey,
          joiningDevice.encryptionPublicKey,
        ) ||
        !bytesEqual(
          alreadyAuthorized.signingPublicKey,
          joiningDevice.signingPublicKey,
        )
      ) {
        setDeviceAuthorizationState("error");
        setCoordinationError(
          "Joining DeviceId is already authorized with different public keys",
        );
        return;
      }

      activeProject.setDeviceDisplayName(
        joiningDevice.deviceId,
        joiningDevice.displayName,
      );
      setDeviceAuthorizationState("authorized");
      await deliverWorkspaceKey(localSecurityState);
      return;
    }

    securityMutationInFlightRef.current = true;
    try {
      let committedState: SecurityState;

      try {
        const signerIdentity = session.publicIdentity;
        const authorizedSigner = localSecurityState.devices.find(
          (device) => device.deviceId === signerIdentity.deviceId,
        );
        if (
          !authorizedSigner ||
          !bytesEqual(
            authorizedSigner.encryptionPublicKey,
            signerIdentity.encryptionPublicKey,
          ) ||
          !bytesEqual(
            authorizedSigner.signingPublicKey,
            signerIdentity.signingPublicKey,
          )
        ) {
          throw new Error(
            "Unlocked Device Vault identity does not match authorized SecurityState",
          );
        }

        const unsignedTransition = createUnsignedAddDeviceTransition(
          localSecurityState,
          joiningDevice,
          signerIdentity.deviceId,
        );
        const signingBytes =
          encodeUnsignedAddDeviceTransition(unsignedTransition);
        const signature = await session.sign(signingBytes);
        const transition = attachAddDeviceSignature(
          unsignedTransition,
          signature,
        );

        const verified = await verifyEd25519Signature(
          signingBytes,
          transition.signature,
          authorizedSigner.signingPublicKey,
        );
        if (!verified) {
          throw new Error("AddDevice signature verification failed");
        }

        const headHash = await sha256(encodeAddDeviceTransition(transition));
        const candidateState = deriveAddDeviceSecurityState(
          localSecurityState,
          transition,
          headHash,
        );
        committedState = await securityCoordinator.commitAddDevice(
          activeProject.id,
          transition,
        );

        if (!securityStatesEqual(candidateState, committedState)) {
          throw new Error(
            "Coordinator committed a SecurityState that does not match AddDevice",
          );
        }

        await workspaceStorage.saveCommittedSecurityState(committedState);
        activeProject.setDeviceDisplayName(
          joiningDevice.deviceId,
          joiningDevice.displayName,
        );
        setLocalSecurityState(committedState);
        setDeviceAuthorizationState("authorized");
      } catch (error: unknown) {
        setDeviceAuthorizationState("error");
        setCoordinationError(
          error instanceof Error ? error.message : "Failed to authorize device",
        );
        return;
      }

      await deliverWorkspaceKey(committedState);
    } finally {
      securityMutationInFlightRef.current = false;
    }
  }

  async function revokeDevice(revokedDeviceId: DeviceId): Promise<void> {
    if (securityMutationInFlightRef.current) {
      const error = new Error("A security update is already in progress");
      setCoordinationError(error.message);
      throw error;
    }
    if (!localSecurityState || !localDeviceId) {
      const error = new Error("Committed SecurityState is not available");
      setCoordinationError(error.message);
      throw error;
    }
    if (revokedDeviceId === localDeviceId) {
      const error = new Error("This device cannot revoke itself");
      setCoordinationError(error.message);
      throw error;
    }

    const session = deviceVaultSessionRef.current;
    if (!session) {
      const error = new Error("Device Vault must be unlocked before revocation");
      setCoordinationError(error.message);
      throw error;
    }

    securityMutationInFlightRef.current = true;
    try {
      setCoordinationError(null);
      const signer = localSecurityState.devices.find(
        (device) => device.deviceId === localDeviceId,
      );
      if (!signer) {
        throw new Error("This device is not authorized to revoke another device");
      }

      const unsignedTransition = createUnsignedRevokeDeviceTransition(
        localSecurityState,
        revokedDeviceId,
        localDeviceId,
      );
      const signingBytes =
        encodeUnsignedRevokeDeviceTransition(unsignedTransition);
      const signature = await session.sign(signingBytes);
      const transition = attachRevokeDeviceSignature(
        unsignedTransition,
        signature,
      );

      const verified = await verifyEd25519Signature(
        signingBytes,
        transition.signature,
        signer.signingPublicKey,
      );
      if (!verified) {
        throw new Error("RevokeDevice signature verification failed");
      }

      const headHash = await sha256(encodeRevokeDeviceTransition(transition));
      const candidateState = deriveRevokeDeviceSecurityState(
        localSecurityState,
        transition,
        headHash,
      );

      const preparedEnvelopes = await session.prepareWorkspaceKeyRotation(
        candidateState.workspaceId,
        candidateState.keyEpoch,
        candidateState.headHash,
        candidateState.devices,
      );

      const keyEnvelopes = await Promise.all(
        preparedEnvelopes.map(async (prepared) => {
          const unsignedEnvelope = {
            protocolVersion: 1 as const,
            workspaceId: candidateState.workspaceId,
            keyEpoch: candidateState.keyEpoch,
            securityHead: candidateState.headHash,
            recipientDeviceId: prepared.recipientDeviceId,
            sealedEnvelope: prepared.sealedEnvelope,
            signerDeviceId: localDeviceId,
          };
          const envelopeSignature = await session.sign(
            encodeUnsignedWorkspaceKeyRotationEnvelope(unsignedEnvelope),
          );
          return attachWorkspaceKeyRotationEnvelopeSignature(
            unsignedEnvelope,
            envelopeSignature,
          );
        }),
      );

      const committedState = await securityCoordinator.commitRevokeDevice(
        candidateState.workspaceId,
        transition,
        keyEnvelopes,
      );
      if (!securityStatesEqual(candidateState, committedState)) {
        throw new Error(
          "Coordinator committed a SecurityState that does not match RevokeDevice",
        );
      }

      const localEnvelope = await securityCoordinator.getWorkspaceKeyEnvelope(
        committedState.workspaceId,
        committedState.keyEpoch,
        localDeviceId,
      );
      await storeVerifiedRotatedProjectKey(
        session,
        committedState,
        localDeviceId,
        localEnvelope,
      );

      await workspaceStorage.saveCommittedSecurityState(committedState);
      setLocalSecurityState(committedState);
      setLocalProjectKeyReady(true);
    } catch (error: unknown) {
      const normalized =
        error instanceof Error ? error : new Error("Failed to revoke device");
      setCoordinationError(normalized.message);
      setSecurityRefreshToken((value) => value + 1);
      throw normalized;
    } finally {
      securityMutationInFlightRef.current = false;
    }
  }

  async function retryWorkspaceKeyDelivery(): Promise<void> {
    if (!localSecurityState) {
      setCoordinationError("Committed SecurityState is not available");
      return;
    }
    await deliverWorkspaceKey(localSecurityState);
  }

  async function deliverWorkspaceKey(
    committedState: SecurityState,
  ): Promise<void> {
    if (!joiningDevice || !webRtcTransport || !invitationHost) {
      setWorkspaceKeyDeliveryState("error");
      setCoordinationError("Pairing session is not available for WorkspaceKey delivery");
      return;
    }

    const session = deviceVaultSessionRef.current;
    if (!session) {
      setWorkspaceKeyDeliveryState("error");
      setCoordinationError("Device Vault must be unlocked for WorkspaceKey delivery");
      return;
    }

    const authorizedRecipient = committedState.devices.find(
      (device) => device.deviceId === joiningDevice.deviceId,
    );
    if (
      !authorizedRecipient ||
      !bytesEqual(
        authorizedRecipient.encryptionPublicKey,
        joiningDevice.encryptionPublicKey,
      ) ||
      !bytesEqual(
        authorizedRecipient.signingPublicKey,
        joiningDevice.signingPublicKey,
      )
    ) {
      setWorkspaceKeyDeliveryState("error");
      setCoordinationError(
        "Committed SecurityState does not match the joining device",
      );
      return;
    }

    setWorkspaceKeyDeliveryState("delivering");
    setCoordinationError(null);

    try {
      const sealedEnvelope = await session.sealWorkspaceKeyForRecipient(
        committedState.workspaceId,
        committedState.keyEpoch,
        joiningDevice.deviceId,
        joiningDevice.encryptionPublicKey,
        committedState.headHash,
      );

      await sendWorkspaceKeyDelivery({
        transport: webRtcTransport,
        securityState: committedState,
        recipientDeviceId: joiningDevice.deviceId,
        sealedEnvelope,
      });

      startInvitationEncryptedSync(committedState);

      try {
        await new InvitationClient(coordinatorBaseUrl).consumeInvite(
          invitationHost.inviteId,
        );
      } catch (error: unknown) {
        console.warn(
          error instanceof Error
            ? `WorkspaceKey stored, but invite consume failed: ${error.message}`
            : "WorkspaceKey stored, but invite consume failed",
        );
      }

      setWorkspaceKeyDeliveryState("delivered");
    } catch (error: unknown) {
      setWorkspaceKeyDeliveryState("error");
      setCoordinationError(
        error instanceof Error ? error.message : "Failed to deliver WorkspaceKey",
      );
    }
  }

  function startInvitationEncryptedSync(
    committedState: SecurityState,
  ): void {
    if (invitationSyncEngineRef.current) return;

    const session = deviceVaultSessionRef.current;
    if (!session || !webRtcTransport) {
      setCoordinationError(
        "Vault session and WebRTC transport are required for initial sync",
      );
      return;
    }

    const encryptedTransport = new EncryptedSyncTransport(
      webRtcTransport,
      {
        encrypt: (plaintext) =>
          session.encryptWorkspaceSyncPayload(
            committedState.workspaceId,
            committedState.keyEpoch,
            plaintext,
          ),
        decrypt: (envelope) =>
          session.decryptWorkspaceSyncPayload(
            committedState.workspaceId,
            committedState.keyEpoch,
            envelope,
          ),
      },
      {
        onError: (error, direction) => {
          setCoordinationError(
            `Encrypted initial sync ${direction} failed: ${error.message}`,
          );
        },
      },
    );

    const syncEngine = new WorkspaceSyncEngine(
      activeProject,
      encryptedTransport,
      {
        debugLogger: createConsoleDebugLogger("invite-host-encrypted-sync"),
      },
    );
    invitationSyncEngineRef.current = syncEngine;
    syncEngine.start();
  }

  function createDocument() {
    const document = activeProject.createDocument();
    setSelectedId(document.id);
    setFocusTitleDocumentId(document.id);
    writeLastDocumentId(activeProject.id, document.id);
    setMainView("note");
    pushRoute(buildNoteUrl(activeProject.id, document.id));
  }

  function deleteDocument(documentId: DocumentId) {
    const before = activeProject.listDocuments();
    const deletedIndex = before.findIndex(
      (summary) => summary.id === documentId,
    );
    if (deletedIndex < 0) return;

    activeProject.deleteDocument(documentId);

    if (documentId !== selectedId) return;

    const remaining = activeProject.listDocuments();
    const nextId = selectNextDocumentAfterDeletion(
      before,
      remaining,
      documentId,
    );

    setSelectedId(nextId);
    setFocusTitleDocumentId(null);
    writeLastDocumentId(activeProject.id, nextId);
    replaceRoute(
      nextId
        ? buildNoteUrl(activeProject.id, nextId)
        : buildWorkspaceUrl(activeProject.id),
    );
  }

  const syncUiState = deriveSyncUiState({
    presenceState: authorizedSync.presenceState,
    onlineDeviceIds: authorizedSync.onlineDeviceIds,
    connectedDeviceIds: authorizedSync.connectedDeviceIds,
    localDeviceId,
    error: authorizedSync.error,
  });

  const projectCoordinationState: "checking" | "ready" | "error" =
    securityCoordinationState !== "ready"
      ? securityCoordinationState
      : authorizedSync.presenceState === "open"
        ? "ready"
        : authorizedSync.presenceState === "idle" ||
            authorizedSync.presenceState === "connecting" ||
            authorizedSync.presenceState === "authenticating"
          ? "checking"
          : "error";
  const projectCoordinationError =
    securityCoordinationError ??
    authorizedSync.coordinationError ??
    (projectCoordinationState === "error"
      ? "Coordinator connection is unavailable"
      : null);

  const connectedDeviceIds = new Set(authorizedSync.connectedDeviceIds);
  const onlineDeviceIds = new Set(authorizedSync.onlineDeviceIds);
  const authorizedDeviceIds =
    localSecurityState?.devices.map((device) => device.deviceId) ??
    (localDeviceId ? [localDeviceId] : []);

  const syncDevices: SyncDeviceUi[] = authorizedDeviceIds
    .flatMap((deviceId): SyncDeviceUi[] => {
      const isCurrent = deviceId === localDeviceId;
      const state: SyncDeviceUi["state"] = isCurrent
        ? "this-device"
        : connectedDeviceIds.has(deviceId)
          ? "connected"
          : onlineDeviceIds.has(deviceId)
            ? "online"
            : "offline";

      return [
        {
          deviceId,
          name:
            activeProject.getDeviceDisplayName(deviceId) ??
            (isCurrent
              ? localDeviceName ?? "This device"
              : "Unnamed device"),
          state,
        },
      ];
    })
    .sort((left, right) => {
      const rank = { "this-device": 0, connected: 1, online: 2, offline: 3 } as const;
      return rank[left.state] - rank[right.state];
    });

  const projectItems = withActiveProjectSummary(
    projectSummaries,
    activeProject,
  ).map((summary) => ({
    id: summary.id,
    name: summary.name,
    isCurrent: summary.id === activeProject.id,
  }));

  const projectControl = (
    <ProjectSwitcher
      projects={projectItems}
      disabled={projectSwitching}
      onSelectProject={selectProject}
      onCreateProject={createProject}
      onImportFloeExport={importFloeExport}
      onImportMarkdownDirectory={importMarkdownDirectoryFiles}
    />
  );

  const settingsScopeNavigation = (
    <nav className="settings-scope-nav" aria-label="Settings sections">
      <button
        type="button"
        aria-current={mainView === "app-settings" ? "page" : undefined}
        onClick={() => {
          if (mainView === "app-settings") return;
          setMainView("app-settings");
          pushRoute("/settings");
        }}
      >
        General
      </button>
      <button
        type="button"
        aria-current={mainView === "project-settings" ? "page" : undefined}
        onClick={() => {
          if (mainView === "project-settings") return;
          setMainView("project-settings");
          pushRoute(buildWorkspaceSettingsUrl(activeProject.id));
        }}
      >
        {activeProject.name}
      </button>
    </nav>
  );

  const invitationContent =
    invitationHostActive ? (
      invitationHost && webRtcTransport ? (
        <InvitationHostPanel
          inviteId={invitationHost.inviteId}
          pairingSecret={invitationHost.pairingSecret}
          expiresAt={invitationHost.expiresAt}
          transport={webRtcTransport}
          signalingState={signalingState}
          joiningDeviceId={joiningDevice?.deviceId ?? null}
          joiningDeviceName={joiningDevice?.displayName ?? null}
          authorizationState={deviceAuthorizationState}
          workspaceKeyDeliveryState={workspaceKeyDeliveryState}
          error={coordinationError}
          onConfirm={authorizeJoiningDevice}
          onRetryWorkspaceKeyDelivery={retryWorkspaceKeyDelivery}
          onCancel={async () => {
            try {
              await new InvitationClient(coordinatorBaseUrl).cancelInvite(
                invitationHost.inviteId,
              );
            } catch (error: unknown) {
              console.warn(
                error instanceof Error
                  ? `Invitation cancel failed: ${error.message}`
                  : "Invitation cancel failed",
              );
            } finally {
              exitInvitationHost();
            }
          }}
        />
      ) : coordinationError ? (
        <section className="invitation-host-view">
          <header className="settings-header invitation-host-header">
            <p className="settings-eyebrow">Devices</p>
            <h1>Add a device</h1>
            <p>Device invitations require the coordinator.</p>
          </header>
          <div className="project-security-inline-error">
            <p>{coordinationError}</p>
            <button
              className="dialog-secondary-button"
              type="button"
              onClick={() => exitInvitationHost()}
            >
              Back to Workspace
            </button>
          </div>
        </section>
      ) : (
        <section className="invitation-host-view">
          <header className="settings-header invitation-host-header">
            <p className="settings-eyebrow">Devices</p>
            <h1>Add a device</h1>
            <p>Creating a secure invitation…</p>
          </header>
        </section>
      )
    ) : undefined;

  const mainContent =
    invitationContent ?? (mainView === "app-settings" ? (
      <AppSettingsView
        theme={themePreference}
        coordinatorBaseUrl={coordinatorBaseUrl}
        localDeviceId={localDeviceId}
        localDeviceName={localDeviceName}
        turnCredentialEndpoint={turnCredentialEndpoint}
        onRenameDevice={renameLocalDevice}
        onThemeChange={setThemePreference}
        onTurnCredentialEndpointChange={setTurnCredentialEndpoint}
        onEraseDevice={eraseFloeFromThisDevice}
        scopeNavigation={settingsScopeNavigation}
      />
        ) : mainView === "project-settings" ? (
      <ProjectSettingsView
        projectId={activeProject.id}
        projectName={activeProject.name}
        localDeviceId={localDeviceId}
        authorizedDevices={localSecurityState?.devices ?? null}
        onlineDeviceIds={authorizedSync.onlineDeviceIds}
        connectedDeviceIds={authorizedSync.connectedDeviceIds}
        connectionAttempts={authorizedSync.connectionAttempts}
        securityState={
          localSecurityBootstrapState === "error"
            ? "error"
            : localSecurityState
              ? "ready"
              : "loading"
        }
        securityError={localSecurityError}
        coordinationState={projectCoordinationState}
        coordinationError={projectCoordinationError}
        getDeviceDisplayName={(deviceId) =>
          activeProject.getDeviceDisplayName(deviceId)
        }
        onRenameProject={(name) => activeProject.renameProject(name)}
        onExportProject={async () => {
          exportProjectToBrowser(activeProject);
        }}
        onRemoveProjectFromDevice={removeActiveProjectFromDevice}
        onAddDevice={() => {
          setInvitationHostActive(true);
        }}
        onRetrySecurity={() =>
          setSecurityRefreshToken((value) => value + 1)
        }
        onRemoveDevice={revokeDevice}
        scopeNavigation={settingsScopeNavigation}
      />
    ) : undefined);

  const debugSidebarControls = import.meta.env.DEV ? (
    <>
      <DebugEnvironmentPanel coordinatorBaseUrl={coordinatorBaseUrl} />
      {useSignaledWebRtc && webRtcTransport ? (
        <SignalingHostPanel
          projectId={activeProject.id}
          sessionId={signalSessionId}
          transport={webRtcTransport}
          signalingState={signalingState}
        />
      ) : useManualWebRtc && webRtcTransport ? (
        <WebRtcDebugPanel
          projectId={activeProject.id}
          transport={webRtcTransport}
        />
      ) : null}
    </>
  ) : null;

  function openProjectDeviceSettings(): void {
    setMainView("project-settings");
    pushRoute(buildWorkspaceSettingsUrl(activeProject.id));
    window.setTimeout(() => {
      document
        .getElementById("workspace-devices")
        ?.scrollIntoView({ block: "start" });
    }, 0);
  }

  const sidebarFooter = (
    <>
      {debugSidebarControls}
      {coordinationError && !invitationHostActive ? (
        <p className="webrtc-error">{coordinationError}</p>
      ) : null}
      <div className="sidebar-footer-row">
        <SyncStatus
          state={syncUiState}
          devices={syncDevices}
          canAddDevice={
            localSecurityState !== null && projectCoordinationState === "ready"
          }
          onAddDevice={() => {
            setMainView("project-settings");
            pushRoute(buildWorkspaceSettingsUrl(activeProject.id));
            setInvitationHostActive(true);
          }}
          onManageDevices={openProjectDeviceSettings}
        />
        <button
          className="footer-action"
          type="button"
          onClick={() => {
            setMainView("app-settings");
            pushRoute("/settings");
          }}
        >
          Settings
        </button>
      </div>
    </>
  );

  return (
    <NoteWorkspace
      project={activeProject}
      selectedId={selectedId}
      selectedDocument={selectedDocument}
      projectControl={projectControl}
      sidebarFooter={sidebarFooter}
      mainContent={mainContent}
      trashActive={mainView === "trash"}
      trashDocumentId={trashDocumentId}
      focusTitleDocumentId={focusTitleDocumentId}
      onTitleFocusHandled={() => setFocusTitleDocumentId(null)}
      onCreateDocument={createDocument}
      onSelectDocument={(documentId) => {
        setSelectedId(documentId);
        setFocusTitleDocumentId(null);
        writeLastDocumentId(activeProject.id, documentId);
        setMainView("note");
        pushRoute(buildNoteUrl(activeProject.id, documentId));
      }}
      onRenameDocument={(title) => {
        if (selectedDocument) {
          activeProject.renameDocument(selectedDocument.id, title);
        }
      }}
      onDeleteDocument={deleteDocument}
      onRestoreDocument={(documentId) => {
        const document = activeProject.getDeletedDocument(documentId);
        if (!document) return;

        activeProject.restoreDocument(documentId);
        setSelectedId(documentId);
        setFocusTitleDocumentId(null);
        writeLastDocumentId(activeProject.id, documentId);
        setMainView("note");
        setTrashDocumentId(null);
        replaceRoute(buildNoteUrl(activeProject.id, documentId));
      }}
      onPurgeDocument={(documentId) => {
        activeProject.purgeDocument(documentId);
        if (trashDocumentId === documentId) {
          setTrashDocumentId(null);
          replaceRoute(buildTrashUrl(activeProject.id));
        }
      }}
      onOpenTrash={() => {
        setFocusTitleDocumentId(null);
        setMainView("trash");
        pushRoute(buildTrashUrl(activeProject.id));
      }}
      onSelectTrashDocument={(documentId) => {
        setMainView("trash");
        setTrashDocumentId(documentId);
        if (documentId) {
          pushRoute(buildTrashNoteUrl(activeProject.id, documentId));
        }
      }}
    />
  );
}


function syncLocalDeviceName(
  project: NoteProject,
  session: DeviceVaultSession,
): void {
  const deviceId = session.publicIdentity.deviceId;
  if (project.getDeviceDisplayName(deviceId) !== session.displayName) {
    project.setDeviceDisplayName(deviceId, session.displayName);
  }
}

function withActiveProjectSummary(
  summaries: readonly StoredWorkspaceSummary[],
  activeProject: NoteProject,
): readonly StoredWorkspaceSummary[] {
  const existing = summaries.find(
    (summary) => summary.id === activeProject.id,
  );

  const normalized = summaries.map((summary) => ({
    ...summary,
    name:
      summary.id === activeProject.id
        ? activeProject.name
        : summary.name,
    isActive: summary.id === activeProject.id,
  }));

  if (existing) return normalized;

  return [
    ...normalized,
    {
      id: activeProject.id,
      name: activeProject.name,
      createdAt: Date.now(),
      isActive: true,
    },
  ];
}

async function ensureInitialProjectKey(
  session: DeviceVaultSession,
  state: SecurityState,
  localDeviceId: DeviceId,
): Promise<boolean> {
  if (session.hasWorkspaceKey(state.workspaceId, state.keyEpoch)) {
    return true;
  }

  const localDevice = state.devices.find(
    (device) => device.deviceId === localDeviceId,
  );
  if (
    state.keyEpoch === 1 &&
    localDevice?.addedAtSequence === 0
  ) {
    await session.createWorkspaceKeyIfMissing(state.workspaceId, state.keyEpoch);
    return true;
  }

  return false;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function workspaceIdFromRoute(route: BrowserRoute): WorkspaceId | null {
  switch (route.kind) {
    case "workspace":
    case "note":
    case "workspace-settings":
    case "trash":
    case "trash-note":
      return route.workspaceId;
    default:
      return null;
  }
}
