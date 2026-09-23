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
  ProjectId,
} from "@floe-note/domain";
import {
  authenticatePairingChannel,
  exchangeJoiningDeviceIdentity,
  sendProjectKeyDelivery,
  type JoiningDeviceInfo,
} from "@floe-note/pairing";
import {
  attachAddDeviceSignature,
  attachCreateProjectSignature,
  attachProjectKeyRotationEnvelopeSignature,
  attachRevokeDeviceSignature,
  createUnsignedAddDeviceTransition,
  createUnsignedRevokeDeviceTransition,
  createUnsignedCreateProjectTransition,
  deriveAddDeviceSecurityState,
  deriveInitialSecurityState,
  deriveRevokeDeviceSecurityState,
  encodeAddDeviceTransition,
  encodeCreateProjectTransition,
  encodeRevokeDeviceTransition,
  encodeUnsignedProjectKeyRotationEnvelope,
  encodeUnsignedAddDeviceTransition,
  encodeUnsignedCreateProjectTransition,
  encodeUnsignedRevokeDeviceTransition,
  type ProjectKeyRotationEnvelope,
  type SecurityState,
} from "@floe-note/security";
import {
  DexieProjectStorage,
  type StoredProjectSummary,
} from "@floe-note/storage";
import { ProjectSyncEngine } from "@floe-note/sync";
import { WebRtcTransport } from "@floe-note/transport/webrtc";
import {
  WebAuthnPrfDeviceVault,
  type DeviceVaultSession,
} from "@floe-note/vault";

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
import { NoteWorkspace } from "./NoteWorkspace.js";
import {
  clearAllLastDocumentPreferences,
  readLastDocumentId,
  writeLastDocumentId,
} from "./note-preference.js";
import { ProjectEmptyState } from "./ProjectEmptyState.js";
import { exportProjectToBrowser } from "./portable-export-download.js";
import { importPortableProjectArchive } from "./portable-import-integration.js";
import { ProjectSettingsView } from "./ProjectSettingsView.js";
import { ProjectSwitcher } from "./ProjectSwitcher.js";
import {
  SyncStatus,
  type SyncDeviceUi,
} from "./SyncStatus.js";
import { deriveSyncUiState } from "./sync-ui-state.js";
import { clearThemePreference, useThemePreference } from "./theme.js";
import { SignaledJoinPage } from "./SignaledJoinPage.js";
import { clearSidebarPreference } from "./sidebar-preference.js";
import {
  reconcileVerifiedSecurityState,
  securityStatesEqual,
} from "./security-reconciliation.js";
import { SignalingHostPanel } from "./SignalingHostPanel.js";
import { WebRtcDebugPanel } from "./WebRtcDebugPanel.js";
import { UnlockScreen } from "./UnlockScreen.js";
import { WebRtcJoinPage } from "./WebRtcJoinPage.js";
import {
  useAuthorizedProjectSync,
  useEncryptedLocalTabSync,
} from "./useProjectSync.js";

const projectStorage = new DexieProjectStorage();
const deviceVault = new WebAuthnPrfDeviceVault();
const searchParams = new URLSearchParams(window.location.search);
const legacyDebugRoutesEnabled = import.meta.env.DEV;
const useManualWebRtc =
  legacyDebugRoutesEnabled && searchParams.get("transport") === "webrtc";
const useSignaledWebRtc =
  legacyDebugRoutesEnabled && searchParams.get("transport") === "signal";
const useInvitationWebRtc = searchParams.get("transport") === "invite";
const useAutomaticReconnect =
  !useManualWebRtc && !useSignaledWebRtc && !useInvitationWebRtc;
const useManualWebRtcJoin =
  legacyDebugRoutesEnabled && searchParams.get("join") === "webrtc";
const useSignaledWebRtcJoin =
  legacyDebugRoutesEnabled && searchParams.get("join") === "signal";
const invitationPathMatch = /^\/join\/v1\/([0-9a-f]{32})$/i.exec(
  window.location.pathname,
);
const pairingSecretFromFragment = new URLSearchParams(
  window.location.hash.slice(1),
).get("s");
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
  const invitationId = invitationPathMatch?.[1];
  if (invitationId) {
    return (
      <InvitationJoinPage
        coordinatorBaseUrl={coordinatorBaseUrl}
        inviteId={invitationId}
        pairingSecret={pairingSecretFromFragment}
        storage={projectStorage}
      />
    );
  }

  if (useManualWebRtcJoin) {
    return <WebRtcJoinPage storage={projectStorage} />;
  }

  if (useSignaledWebRtcJoin) {
    return (
      <SignaledJoinPage
        storage={projectStorage}
        coordinatorBaseUrl={coordinatorBaseUrl}
        projectId={searchParams.get("project")}
        sessionId={searchParams.get("session")}
      />
    );
  }

  return <NoteApp />;
}

function NoteApp() {
  const [themePreference, setThemePreference] = useThemePreference();
  const [openedProject, setOpenedProject] = useState<OpenedProject | null>(null);
  const [projectSummaries, setProjectSummaries] = useState<
    readonly StoredProjectSummary[]
  >([]);
  const [projectCatalogReady, setProjectCatalogReady] = useState(false);
  const [projectSwitching, setProjectSwitching] = useState(false);
  const [mainView, setMainView] = useState<
    "note" | "app-settings" | "project-settings"
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
  const [invitationHost, setInvitationHost] =
    useState<InvitationHostState | null>(null);
  const [joiningDevice, setJoiningDevice] =
    useState<JoiningDeviceInfo | null>(null);
  const [deviceAuthorizationState, setDeviceAuthorizationState] =
    useState<DeviceAuthorizationUiState>("waiting");
  const [coordinationError, setCoordinationError] = useState<string | null>(
    null,
  );
  const deviceVaultSessionRef = useRef<DeviceVaultSession | null>(null);
  const securityMutationInFlightRef = useRef(false);
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
  const [projectKeyDeliveryState, setProjectKeyDeliveryState] = useState<
    "waiting" | "delivering" | "delivered" | "error"
  >("waiting");

  const project = openedProject?.project ?? null;

  useEffect(() => {
    let cancelled = false;

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
      const session = deviceVaultSessionRef.current;
      deviceVaultSessionRef.current = null;
      if (session) void session.close();
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
      const storedState = await projectStorage.loadSecurityState(project.id);
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
            const envelope = await securityCoordinator.getProjectKeyEnvelope(
              verifiedState.projectId,
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
              "Current ProjectKey is not available on this device",
            );
          }

          if (!securityStatesEqual(storedState, verifiedState)) {
            await projectStorage.saveCommittedSecurityState(verifiedState);
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
                : "Could not refresh Project coordination state",
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

      const unsignedTransition = createUnsignedCreateProjectTransition(
        project.id,
        identity,
      );
      const signingBytes =
        encodeUnsignedCreateProjectTransition(unsignedTransition);
      const signature = await session.sign(signingBytes);
      const transition = attachCreateProjectSignature(
        unsignedTransition,
        signature,
      );

      const verified = await verifyEd25519Signature(
        signingBytes,
        transition.signature,
        transition.initialDevice.signingPublicKey,
      );
      if (!verified) {
        throw new Error("CreateProject signature verification failed");
      }

      const headHash = await sha256(
        encodeCreateProjectTransition(transition),
      );
      const candidateState = deriveInitialSecurityState(
        transition,
        headHash,
      );
      const committedState = await securityCoordinator.commitCreateProject(
        project.id,
        transition,
      );

      if (!securityStatesEqual(candidateState, committedState)) {
        throw new Error(
          "Coordinator committed a SecurityState that does not match CreateProject",
        );
      }

      await projectStorage.saveCommittedSecurityState(committedState);
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

  const automaticReconnectEnabled = useAutomaticReconnect;

  const authorizedSync = useAuthorizedProjectSync({
    coordinatorBaseUrl,
    project,
    localDeviceId,
    securityState: localSecurityState,
    projectKeyReady: localProjectKeyReady,
    vaultSession: deviceVaultSessionRef.current,
    automaticReconnectEnabled,
    onSecurityStateChanged: handleSecurityStateChanged,
  });

  useEncryptedLocalTabSync({
    enabled: useAutomaticReconnect,
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

    return projectStorage.watchProject(
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
    setProjectKeyDeliveryState("waiting");

    if (useInvitationWebRtc) {
      let disposed = false;
      let cleanup: (() => void) | null = null;
      const invitationClient = new InvitationClient(coordinatorBaseUrl);

      void (async () => {
        try {
          const pairingSecret = createPairingSecret();
          const invitation = await invitationClient.createInvite(project.id);
          if (disposed) return;

          const transport = new WebRtcTransport(
            project.id,
            undefined,
            createConsoleDebugLogger("invite-host-webrtc"),
          );
          setWebRtcTransport(transport);

          const abortPairing = new AbortController();

          const signaling = new WebRtcSignalingSession({
            role: "host",
            coordinatorBaseUrl,
            projectId: project.id,
            sessionId: invitation.sessionId,
            transport,
            debugLogger: createConsoleDebugLogger("invite-host-signal"),
          });
          const stopSignalingState =
            signaling.onConnectionStateChange(setSignalingState);
          signaling.start();

          void authenticatePairingChannel({
            role: "host",
            inviteId: invitation.inviteId,
            projectId: project.id,
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

          cleanup = () => {
            abortPairing.abort();
            stopSignalingState();
            signaling.stop();
          };
        } catch (caught: unknown) {
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
        cleanup?.();
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

      const syncEngine = new ProjectSyncEngine(project, transport, {
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
        projectId: project.id,
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
  }, [project, signalSessionId]);

  useEffect(() => {
    if (!openedProject) return;

    setFocusTitleDocumentId(null);

    const { project: loadedProject, isNew } = openedProject;
    const summaries = loadedProject.listDocuments();

    if (isNew) {
      const document = loadedProject.createDocument("Welcome to Floe Note");
      setSelectedId(document.id);
      writeLastDocumentId(loadedProject.id, document.id);
      return;
    }

    const rememberedId = readLastDocumentId(loadedProject.id);
    const selectedId =
      rememberedId && loadedProject.getDocument(rememberedId)
        ? rememberedId
        : summaries[0]?.id ?? null;

    setSelectedId(selectedId);
    writeLastDocumentId(loadedProject.id, selectedId);
  }, [openedProject]);

  if (loadError) {
    return (
      <main className="empty-state">
        <p>Could not open local storage.</p>
        <p>{loadError}</p>
      </main>
    );
  }

  if (deviceVaultState !== "unlocked") {
    return (
      <UnlockScreen
        state={deviceVaultState}
        error={deviceVaultError}
        onUnlock={unlockDevice}
        onCreateWithExistingPasskey={createDeviceWithExistingPasskey}
        onCreateWithNewPasskey={createDeviceWithNewPasskey}
        onResetDevice={resetLockedDevice}
      />
    );
  }

  if (!project) {
    if (!projectCatalogReady) {
      return (
        <main className="empty-state">
          <p>Loading local Projects…</p>
        </main>
      );
    }

    return (
      <ProjectEmptyState
        onCreateProject={createProject}
        onImportFloeExport={importFloeExport}
      />
    );
  }

  const activeProject = project;
  const selectedDocument = selectedId
    ? activeProject.getDocument(selectedId)
    : undefined;

  async function openDeviceVault(
    open: () => Promise<DeviceVaultSession>,
  ): Promise<void> {
    if (deviceVaultState === "unlocking" || deviceVaultState === "unlocked") {
      return;
    }

    setDeviceVaultState("unlocking");
    setDeviceVaultError(null);

    try {
      const session = await open();
      const previous = deviceVaultSessionRef.current;
      deviceVaultSessionRef.current = session;
      if (previous) await previous.close();

      const result = await projectStorage.openLastProject(session);
      const summaries = await projectStorage.listProjects(session);
      if (result) {
        syncLocalDeviceName(result.project, session);
      }
      setOpenedProject(result);
      setProjectSummaries(
        result
          ? withActiveProjectSummary(summaries, result.project)
          : summaries,
      );
      setProjectCatalogReady(true);
      setLocalDeviceId(session.publicIdentity.deviceId);
      setLocalDeviceName(session.displayName);
      setDeviceVaultState("unlocked");
    } catch (error: unknown) {
      setDeviceVaultState("error");
      setDeviceVaultError(
        error instanceof Error ? error.message : "Failed to unlock Device Vault",
      );
    }
  }

  async function unlockDevice(): Promise<void> {
    await openDeviceVault(() => deviceVault.unlock());
  }

  async function createDeviceWithExistingPasskey(
    displayName: string,
  ): Promise<void> {
    await openDeviceVault(() =>
      deviceVault.createWithExistingPasskey(displayName),
    );
  }

  async function createDeviceWithNewPasskey(
    displayName: string,
  ): Promise<void> {
    await openDeviceVault(() =>
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

    await projectStorage.eraseAllLocalData();
    await deviceVault.eraseVault();
    clearAllLastDocumentPreferences();

    window.location.replace("/");
  }

  async function selectProject(projectId: ProjectId): Promise<void> {
    if (projectId === activeProject.id || projectSwitching) return;

    const session = deviceVaultSessionRef.current;
    if (!session) {
      throw new Error("Device Vault must be unlocked before switching Project");
    }

    setProjectSwitching(true);

    try {
      const result = await projectStorage.openProject(projectId, session);
      syncLocalDeviceName(result.project, session);
      const summaries = await projectStorage.listProjects(session);
      resetProjectSecurityUiState();
      setMainView("note");
      setOpenedProject(result);
      setProjectSummaries(
        withActiveProjectSummary(summaries, result.project),
      );
      setProjectCatalogReady(true);
    } finally {
      setProjectSwitching(false);
    }
  }

  async function createProject(name: string): Promise<void> {
    if (projectSwitching) return;

    const session = deviceVaultSessionRef.current;
    if (!session) {
      throw new Error("Device Vault must be unlocked before creating a Project");
    }

    setProjectSwitching(true);

    try {
      const result = await projectStorage.createProject(name);
      syncLocalDeviceName(result.project, session);
      const summaries = await projectStorage.listProjects(session);
      resetProjectSecurityUiState();
      setMainView("note");
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
      throw new Error("Another Project operation is already in progress");
    }

    const session = deviceVaultSessionRef.current;
    if (!session) {
      throw new Error("Device Vault must be unlocked before importing a Project");
    }

    setProjectSwitching(true);

    try {
      const result = await importPortableProjectArchive(archive, {
        session,
        coordinator: securityCoordinator,
        storage: projectStorage,
      });
      const summaries = await projectStorage.listProjects(session);
      resetProjectSecurityUiState();
      setMainView("note");
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
      throw new Error("Project and Device Vault must be available");
    }

    const projectId = project.id;
    setProjectSwitching(true);
    setProjectCatalogReady(false);
    setSelectedId(null);
    setOpenedProject(null);
    resetProjectSecurityUiState();

    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    try {
      const nextProjectId = await projectStorage.removeProject(projectId);
      await session.removeProjectKeys(projectId);
      writeLastDocumentId(projectId, null);

      const summaries = await projectStorage.listProjects(session);
      if (nextProjectId) {
        const next = await projectStorage.openProject(nextProjectId, session);
        setOpenedProject(next);
        setProjectSummaries(
          withActiveProjectSummary(summaries, next.project),
        );
      } else {
        setProjectSummaries(summaries);
      }
      setMainView("note");
      setProjectCatalogReady(true);
    } catch (error) {
      const recovered = await projectStorage.openLastProject(session).catch(
        () => null,
      );
      const summaries = await projectStorage.listProjects(session).catch(
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

      await projectStorage.eraseAllLocalData();
      await deviceVault.eraseVault();
      clearThemePreference();
      clearAllLastDocumentPreferences();
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
      throw new Error("Device Vault and Project must be available");
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
      !session.hasProjectKey(
        localSecurityState.projectId,
        localSecurityState.keyEpoch,
      )
    ) {
      setCoordinationError(
        "Current ProjectKey is not available on this authorized device",
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
      await deliverProjectKey(localSecurityState);
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

        await projectStorage.saveCommittedSecurityState(committedState);
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

      await deliverProjectKey(committedState);
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

      const preparedEnvelopes = await session.prepareProjectKeyRotation(
        candidateState.projectId,
        candidateState.keyEpoch,
        candidateState.headHash,
        candidateState.devices,
      );

      const keyEnvelopes = await Promise.all(
        preparedEnvelopes.map(async (prepared) => {
          const unsignedEnvelope = {
            protocolVersion: 1 as const,
            projectId: candidateState.projectId,
            keyEpoch: candidateState.keyEpoch,
            securityHead: candidateState.headHash,
            recipientDeviceId: prepared.recipientDeviceId,
            sealedEnvelope: prepared.sealedEnvelope,
            signerDeviceId: localDeviceId,
          };
          const envelopeSignature = await session.sign(
            encodeUnsignedProjectKeyRotationEnvelope(unsignedEnvelope),
          );
          return attachProjectKeyRotationEnvelopeSignature(
            unsignedEnvelope,
            envelopeSignature,
          );
        }),
      );

      const committedState = await securityCoordinator.commitRevokeDevice(
        candidateState.projectId,
        transition,
        keyEnvelopes,
      );
      if (!securityStatesEqual(candidateState, committedState)) {
        throw new Error(
          "Coordinator committed a SecurityState that does not match RevokeDevice",
        );
      }

      const localEnvelope = await securityCoordinator.getProjectKeyEnvelope(
        committedState.projectId,
        committedState.keyEpoch,
        localDeviceId,
      );
      await storeVerifiedRotatedProjectKey(
        session,
        committedState,
        localDeviceId,
        localEnvelope,
      );

      await projectStorage.saveCommittedSecurityState(committedState);
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

  async function retryProjectKeyDelivery(): Promise<void> {
    if (!localSecurityState) {
      setCoordinationError("Committed SecurityState is not available");
      return;
    }
    await deliverProjectKey(localSecurityState);
  }

  async function deliverProjectKey(
    committedState: SecurityState,
  ): Promise<void> {
    if (!joiningDevice || !webRtcTransport || !invitationHost) {
      setProjectKeyDeliveryState("error");
      setCoordinationError("Pairing session is not available for ProjectKey delivery");
      return;
    }

    const session = deviceVaultSessionRef.current;
    if (!session) {
      setProjectKeyDeliveryState("error");
      setCoordinationError("Device Vault must be unlocked for ProjectKey delivery");
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
      setProjectKeyDeliveryState("error");
      setCoordinationError(
        "Committed SecurityState does not match the joining device",
      );
      return;
    }

    setProjectKeyDeliveryState("delivering");
    setCoordinationError(null);

    try {
      const sealedEnvelope = await session.sealProjectKeyForRecipient(
        committedState.projectId,
        committedState.keyEpoch,
        joiningDevice.deviceId,
        joiningDevice.encryptionPublicKey,
        committedState.headHash,
      );

      await sendProjectKeyDelivery({
        transport: webRtcTransport,
        securityState: committedState,
        recipientDeviceId: joiningDevice.deviceId,
        sealedEnvelope,
      });

      setProjectKeyDeliveryState("delivered");

      try {
        await new InvitationClient(coordinatorBaseUrl).consumeInvite(
          invitationHost.inviteId,
        );
      } catch (error: unknown) {
        console.warn(
          error instanceof Error
            ? `ProjectKey stored, but invite consume failed: ${error.message}`
            : "ProjectKey stored, but invite consume failed",
        );
      }

      webRtcTransport.close();
      window.location.replace("/");
    } catch (error: unknown) {
      setProjectKeyDeliveryState("error");
      setCoordinationError(
        error instanceof Error ? error.message : "Failed to deliver ProjectKey",
      );
    }
  }

  function createDocument() {
    const document = activeProject.createDocument();
    setSelectedId(document.id);
    setFocusTitleDocumentId(document.id);
    writeLastDocumentId(activeProject.id, document.id);
    setMainView("note");
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
    const next =
      remaining[
        Math.min(
          deletedIndex,
          Math.max(remaining.length - 1, 0),
        )
      ] ?? null;
    const nextId = next?.id ?? null;

    setSelectedId(nextId);
    setFocusTitleDocumentId(null);
    writeLastDocumentId(activeProject.id, nextId);
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
      const state: SyncDeviceUi["state"] | null = isCurrent
        ? "this-device"
        : connectedDeviceIds.has(deviceId)
          ? "connected"
          : onlineDeviceIds.has(deviceId)
            ? "online"
            : null;

      if (!state) return [];

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
      const rank = { "this-device": 0, connected: 1, online: 2 } as const;
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
      onOpenProjectSettings={() => setMainView("project-settings")}
    />
  );

  const invitationContent =
    useInvitationWebRtc ? (
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
          projectKeyDeliveryState={projectKeyDeliveryState}
          error={coordinationError}
          onConfirm={authorizeJoiningDevice}
          onRetryProjectKeyDelivery={retryProjectKeyDelivery}
          onCancel={async () => {
            await new InvitationClient(coordinatorBaseUrl).cancelInvite(
              invitationHost.inviteId,
            );
            webRtcTransport.close();
            window.location.replace("/");
          }}
        />
      ) : coordinationError ? (
        <section className="invitation-host-view">
          <header className="settings-header invitation-host-header">
            <p className="settings-eyebrow">Project devices</p>
            <h1>Add a device</h1>
            <p>Device invitations require the coordinator.</p>
          </header>
          <div className="project-security-inline-error">
            <p>{coordinationError}</p>
            <button
              className="dialog-secondary-button"
              type="button"
              onClick={() => window.location.assign("/")}
            >
              Back to Project
            </button>
          </div>
        </section>
      ) : (
        <section className="invitation-host-view">
          <header className="settings-header invitation-host-header">
            <p className="settings-eyebrow">Project devices</p>
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
        onRenameDevice={renameLocalDevice}
        onThemeChange={setThemePreference}
        onEraseDevice={eraseFloeFromThisDevice}
      />
    ) : mainView === "project-settings" ? (
      <ProjectSettingsView
        projectId={activeProject.id}
        projectName={activeProject.name}
        localDeviceId={localDeviceId}
        authorizedDevices={localSecurityState?.devices ?? null}
        onlineDeviceIds={authorizedSync.onlineDeviceIds}
        connectedDeviceIds={authorizedSync.connectedDeviceIds}
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
          window.location.assign("/?transport=invite");
        }}
        onRetrySecurity={() =>
          setSecurityRefreshToken((value) => value + 1)
        }
        onRemoveDevice={revokeDevice}
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
    window.setTimeout(() => {
      document
        .getElementById("project-devices")
        ?.scrollIntoView({ block: "start" });
    }, 0);
  }

  const sidebarFooter = (
    <>
      {debugSidebarControls}
      {coordinationError && !useInvitationWebRtc ? (
        <p className="webrtc-error">{coordinationError}</p>
      ) : null}
      <div className="sidebar-footer-row">
        <SyncStatus
          state={syncUiState}
          devices={syncDevices}
          onManageDevices={openProjectDeviceSettings}
        />
        <button
          className="footer-action"
          type="button"
          onClick={() => setMainView("app-settings")}
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
      focusTitleDocumentId={focusTitleDocumentId}
      onTitleFocusHandled={() => setFocusTitleDocumentId(null)}
      onCreateDocument={createDocument}
      onSelectDocument={(documentId) => {
        setSelectedId(documentId);
        setFocusTitleDocumentId(null);
        writeLastDocumentId(activeProject.id, documentId);
        setMainView("note");
      }}
      onRenameDocument={(title) => {
        if (selectedDocument) {
          activeProject.renameDocument(selectedDocument.id, title);
        }
      }}
      onDeleteDocument={deleteDocument}
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
  summaries: readonly StoredProjectSummary[],
  activeProject: NoteProject,
): readonly StoredProjectSummary[] {
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

async function storeVerifiedRotatedProjectKey(
  session: DeviceVaultSession,
  state: SecurityState,
  localDeviceId: DeviceId,
  envelope: ProjectKeyRotationEnvelope,
): Promise<void> {
  if (
    envelope.projectId !== state.projectId ||
    envelope.keyEpoch !== state.keyEpoch ||
    envelope.recipientDeviceId !== localDeviceId ||
    !bytesEqual(envelope.securityHead, state.headHash)
  ) {
    throw new Error("ProjectKey rotation envelope does not match SecurityState");
  }

  const signer = state.devices.find(
    (device) => device.deviceId === envelope.signerDeviceId,
  );
  if (!signer) {
    throw new Error("ProjectKey rotation envelope signer is not authorized");
  }

  const verified = await verifyEd25519Signature(
    encodeUnsignedProjectKeyRotationEnvelope(envelope),
    envelope.signature,
    signer.signingPublicKey,
  );
  if (!verified) {
    throw new Error("ProjectKey rotation envelope signature verification failed");
  }

  await session.storeSealedProjectKey(
    envelope.sealedEnvelope,
    state.projectId,
    state.keyEpoch,
    state.headHash,
  );
}

async function ensureInitialProjectKey(
  session: DeviceVaultSession,
  state: SecurityState,
  localDeviceId: DeviceId,
): Promise<boolean> {
  if (session.hasProjectKey(state.projectId, state.keyEpoch)) {
    return true;
  }

  const localDevice = state.devices.find(
    (device) => device.deviceId === localDeviceId,
  );
  if (
    state.keyEpoch === 1 &&
    localDevice?.addedAtSequence === 0
  ) {
    await session.createProjectKeyIfMissing(state.projectId, state.keyEpoch);
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
