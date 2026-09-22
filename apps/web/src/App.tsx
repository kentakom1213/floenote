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
  type DevicePublicIdentity,
  type ProjectKeyRotationEnvelope,
  type SecurityState,
} from "@floe-note/security";
import {
  DexieProjectStorage,
  type StoredProjectSummary,
} from "@floe-note/storage";
import {
  EncryptedSyncTransport,
  ProjectSyncEngine,
} from "@floe-note/sync";
import { WebRtcTransport } from "@floe-note/transport/webrtc";
import {
  WebAuthnPrfDeviceVault,
  type DeviceVaultSession,
} from "@floe-note/vault";

import { createConsoleDebugLogger } from "./debug.js";
import {
  DeviceVaultPanel,
  type DeviceVaultUiState,
  type LocalSecurityBootstrapUiState,
} from "./DeviceVaultPanel.js";
import {
  InvitationHostPanel,
  type DeviceAuthorizationUiState,
} from "./InvitationHostPanel.js";
import { InvitationJoinPage } from "./InvitationJoinPage.js";
import { NoteWorkspace } from "./NoteWorkspace.js";
import { ProjectSettingsView } from "./ProjectSettingsView.js";
import { ProjectSwitcher } from "./ProjectSwitcher.js";
import { SyncStatus, type SyncUiState } from "./SyncStatus.js";
import { ThemePicker } from "./ThemePicker.js";
import { useThemePreference } from "./theme.js";
import { SignaledJoinPage } from "./SignaledJoinPage.js";
import { applyVerifiedSecurityTransitions } from "./security-catch-up.js";
import { SignalingHostPanel } from "./SignalingHostPanel.js";
import { WebRtcDebugPanel } from "./WebRtcDebugPanel.js";
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
  const [projectSwitching, setProjectSwitching] = useState(false);
  const [mainView, setMainView] = useState<"note" | "project-settings">("note");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<DocumentId | null>(null);
  const [webRtcTransport, setWebRtcTransport] =
    useState<WebRtcTransport | null>(null);
  const [signalingState, setSignalingState] =
    useState<SignalingConnectionState>("idle");
  const [signalSessionId] = useState(() => createSessionId());
  const [invitationHost, setInvitationHost] =
    useState<InvitationHostState | null>(null);
  const [joiningDevice, setJoiningDevice] =
    useState<DevicePublicIdentity | null>(null);
  const [deviceAuthorizationState, setDeviceAuthorizationState] =
    useState<DeviceAuthorizationUiState>("waiting");
  const [coordinationError, setCoordinationError] = useState<string | null>(
    null,
  );
  const deviceVaultSessionRef = useRef<DeviceVaultSession | null>(null);
  const securityMutationInFlightRef = useRef(false);
  const invitationSyncEngineRef = useRef<ProjectSyncEngine | null>(null);
  const [deviceVaultState, setDeviceVaultState] =
    useState<DeviceVaultUiState>("checking");
  const [localDeviceId, setLocalDeviceId] = useState<DeviceId | null>(null);
  const [deviceVaultError, setDeviceVaultError] = useState<string | null>(null);
  const [localSecurityBootstrapState, setLocalSecurityBootstrapState] =
    useState<LocalSecurityBootstrapUiState>("waiting");
  const [localSecurityState, setLocalSecurityState] =
    useState<SecurityState | null>(null);
  const [localSecurityError, setLocalSecurityError] =
    useState<string | null>(null);
  const [localProjectKeyReady, setLocalProjectKeyReady] =
    useState<boolean | null>(null);
  const [securityRefreshToken, setSecurityRefreshToken] = useState(0);
  const [projectKeyDeliveryState, setProjectKeyDeliveryState] = useState<
    "waiting" | "delivering" | "delivered" | "error"
  >("waiting");
  const [invitationSyncState, setInvitationSyncState] = useState<
    "waiting" | "active" | "error"
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
      setLocalProjectKeyReady(null);
      return;
    }

    const session = deviceVaultSessionRef.current;
    if (!session) return;

    let cancelled = false;
    setLocalSecurityBootstrapState("committing");
    setLocalSecurityState(null);
    setLocalSecurityError(null);
    setLocalProjectKeyReady(null);

    void (async () => {
      const storedState = await projectStorage.loadSecurityState(project.id);
      if (storedState) {
        const coordinatorState =
          await securityCoordinator.getSecurityState(project.id);

        if (coordinatorState.sequence < storedState.sequence) {
          throw new Error(
            "Coordinator SecurityState is older than the locally verified state",
          );
        }

        let verifiedState = storedState;

        if (coordinatorState.sequence > storedState.sequence) {
          const transitions = await securityCoordinator.getSecurityTransitions(
            project.id,
            storedState.sequence,
          );
          verifiedState = await applyVerifiedSecurityTransitions(
            storedState,
            transitions,
          );
        }

        if (!securityStatesEqual(verifiedState, coordinatorState)) {
          throw new Error(
            "Verified SecurityState does not match the coordinator current state",
          );
        }

        if (
          !verifiedState.devices.some(
            (device) => device.deviceId === localDeviceId,
          )
        ) {
          throw new Error(
            "This Device Vault identity is not authorized by the verified SecurityState",
          );
        }

        if (!securityStatesEqual(storedState, verifiedState)) {
          await projectStorage.saveCommittedSecurityState(verifiedState);
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

        if (!cancelled) {
          setLocalSecurityState(verifiedState);
          setLocalSecurityBootstrapState("committed");
          setLocalProjectKeyReady(projectKeyReady);
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
      }
    })().catch((error: unknown) => {
      if (cancelled) return;
      setLocalSecurityBootstrapState("error");
      setLocalSecurityState(null);
      setLocalSecurityError(
        error instanceof Error
          ? error.message
          : "Failed to create local SecurityState",
      );
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
    if (
      !useInvitationWebRtc ||
      projectKeyDeliveryState !== "delivered" ||
      !webRtcTransport
    ) {
      return;
    }

    let dataChannelWasOpen = webRtcTransport.dataChannelState === "open";
    const stopStatus = webRtcTransport.onStatusChange((status) => {
      if (status.dataChannelState === "open") {
        dataChannelWasOpen = true;
        return;
      }

      if (dataChannelWasOpen && status.dataChannelState === "closed") {
        window.location.replace("/");
      }
    });

    return stopStatus;
  }, [projectKeyDeliveryState, webRtcTransport]);

  useEffect(() => {
    if (!project) return;

    return project.subscribe(() =>
      setRevision((value) => value + 1),
    );
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
    setInvitationSyncState("waiting");

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
            invitationSyncEngineRef.current?.stop();
            invitationSyncEngineRef.current = null;
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

    const { project: loadedProject, isNew } = openedProject;
    const summaries = loadedProject.listDocuments();

    if (isNew) {
      const document = loadedProject.createDocument("Welcome to Floe Note");
      setSelectedId(document.id);
      return;
    }

    setSelectedId(summaries[0]?.id ?? null);
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
      <main className="empty-state">
        <DeviceVaultPanel
          state={deviceVaultState}
          deviceId={localDeviceId}
          error={deviceVaultError}
          securityState="waiting"
          securityHeadHash={null}
          securitySequence={null}
          securityKeyEpoch={null}
          securityDeviceCount={null}
          projectKeyReady={null}
          securityError={null}
          onUnlockOrCreate={unlockOrCreateDevice}
        />
        <p>Unlock the Device Vault to open local Project data.</p>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="empty-state">
        <p>Loading encrypted local notes…</p>
      </main>
    );
  }

  const activeProject = project;
  const selectedDocument = selectedId
    ? activeProject.getDocument(selectedId)
    : undefined;

  async function unlockOrCreateDevice(): Promise<void> {
    if (deviceVaultState === "unlocking" || deviceVaultState === "unlocked") {
      return;
    }

    setDeviceVaultState("unlocking");
    setDeviceVaultError(null);

    try {
      const session = await deviceVault.unlockOrCreate();
      const previous = deviceVaultSessionRef.current;
      deviceVaultSessionRef.current = session;
      if (previous) await previous.close();

      const result = await projectStorage.openOrCreateProject(session);
      const summaries = await projectStorage.listProjects(session);
      setOpenedProject(result);
      setProjectSummaries(
        withActiveProjectSummary(summaries, result.project),
      );
      setLocalDeviceId(session.publicIdentity.deviceId);
      setDeviceVaultState("unlocked");
    } catch (error: unknown) {
      setDeviceVaultState("error");
      setDeviceVaultError(
        error instanceof Error ? error.message : "Failed to unlock Device Vault",
      );
    }
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
      const summaries = await projectStorage.listProjects(session);
      resetProjectSecurityUiState();
      setMainView("note");
      setOpenedProject(result);
      setProjectSummaries(
        withActiveProjectSummary(summaries, result.project),
      );
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
      const summaries = await projectStorage.listProjects(session);
      resetProjectSecurityUiState();
      setMainView("note");
      setOpenedProject(result);
      setProjectSummaries(
        withActiveProjectSummary(summaries, result.project),
      );
    } finally {
      setProjectSwitching(false);
    }
  }

  function resetProjectSecurityUiState(): void {
    setLocalSecurityBootstrapState("waiting");
    setLocalSecurityState(null);
    setLocalSecurityError(null);
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
      setCoordinationError("A security update is already in progress");
      return;
    }
    if (!localSecurityState || !localDeviceId) {
      setCoordinationError("Committed SecurityState is not available");
      return;
    }
    if (revokedDeviceId === localDeviceId) {
      setCoordinationError("This device cannot revoke itself");
      return;
    }

    const session = deviceVaultSessionRef.current;
    if (!session) {
      setCoordinationError("Device Vault must be unlocked before revocation");
      return;
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
      setCoordinationError(
        error instanceof Error ? error.message : "Failed to revoke device",
      );
      setSecurityRefreshToken((value) => value + 1);
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
      startInvitationEncryptedSync(committedState);

      try {
        await new InvitationClient(coordinatorBaseUrl).consumeInvite(
          invitationHost.inviteId,
        );
      } catch (error: unknown) {
        setCoordinationError(
          error instanceof Error
            ? `ProjectKey stored, but invite consume failed: ${error.message}`
            : "ProjectKey stored, but invite consume failed",
        );
      }
    } catch (error: unknown) {
      setProjectKeyDeliveryState("error");
      setCoordinationError(
        error instanceof Error ? error.message : "Failed to deliver ProjectKey",
      );
    }
  }

  function startInvitationEncryptedSync(
    committedState: SecurityState,
  ): void {
    if (invitationSyncEngineRef.current) return;

    const session = deviceVaultSessionRef.current;
    if (!session || !webRtcTransport) {
      setInvitationSyncState("error");
      setCoordinationError(
        "Vault session and WebRTC transport are required for encrypted sync",
      );
      return;
    }

    const encryptedTransport = new EncryptedSyncTransport(
      webRtcTransport,
      {
        encrypt: (plaintext) =>
          session.encryptProjectSyncPayload(
            committedState.projectId,
            committedState.keyEpoch,
            plaintext,
          ),
        decrypt: (envelope) =>
          session.decryptProjectSyncPayload(
            committedState.projectId,
            committedState.keyEpoch,
            envelope,
          ),
      },
      {
        onError: (error, direction) => {
          setInvitationSyncState("error");
          setCoordinationError(
            `Encrypted sync ${direction} failed: ${error.message}`,
          );
        },
      },
    );

    const syncEngine = new ProjectSyncEngine(activeProject, encryptedTransport, {
      debugLogger: createConsoleDebugLogger("invite-host-encrypted-sync"),
    });
    invitationSyncEngineRef.current = syncEngine;
    syncEngine.start();
    setInvitationSyncState("active");
  }

  function createDocument() {
    const document = activeProject.createDocument();
    setSelectedId(document.id);
    setMainView("note");
  }

  function deleteSelectedDocument() {
    if (!selectedId) return;

    activeProject.deleteDocument(selectedId);
    const next = activeProject.listDocuments()[0];
    setSelectedId(next?.id ?? null);
  }

  const syncUiState = deriveSyncUiState({
    presenceState: authorizedSync.presenceState,
    onlineDeviceIds: authorizedSync.onlineDeviceIds,
    connectedDeviceIds: authorizedSync.connectedDeviceIds,
    localDeviceId,
    error: authorizedSync.error,
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
      onOpenProjectSettings={() => setMainView("project-settings")}
    />
  );

  const projectSettingsContent =
    mainView === "project-settings" ? (
      localDeviceId && localSecurityState ? (
        <ProjectSettingsView
          projectId={activeProject.id}
          projectName={activeProject.name}
          localDeviceId={localDeviceId}
          authorizedDevices={localSecurityState.devices}
          onlineDeviceIds={authorizedSync.onlineDeviceIds}
          connectedDeviceIds={authorizedSync.connectedDeviceIds}
          onAddDevice={() => {
            window.location.assign("/?transport=invite");
          }}
          onRemoveDevice={(deviceId) => {
            const confirmed = window.confirm(
              "Remove this device? It will no longer receive new changes from this Project. Data already stored on that device cannot be removed remotely.",
            );
            if (confirmed) void revokeDevice(deviceId);
          }}
        />
      ) : (
        <div className="settings-view">
          <p className="settings-eyebrow">Project settings</p>
          <p className="settings-loading">Loading Project security…</p>
        </div>
      )
    ) : undefined;

  const debugSidebarControls =
    useInvitationWebRtc && invitationHost && webRtcTransport ? (
      <InvitationHostPanel
        inviteId={invitationHost.inviteId}
        pairingSecret={invitationHost.pairingSecret}
        expiresAt={invitationHost.expiresAt}
        transport={webRtcTransport}
        signalingState={signalingState}
        joiningDeviceId={joiningDevice?.deviceId ?? null}
        authorizationState={deviceAuthorizationState}
        projectKeyDeliveryState={projectKeyDeliveryState}
        encryptedSyncState={invitationSyncState}
        onConfirm={authorizeJoiningDevice}
        onRetryProjectKeyDelivery={retryProjectKeyDelivery}
        onCancel={() =>
          new InvitationClient(coordinatorBaseUrl).cancelInvite(
            invitationHost.inviteId,
          )
        }
      />
    ) : useInvitationWebRtc ? (
      <p className="webrtc-hint">Creating invitation…</p>
    ) : useSignaledWebRtc && webRtcTransport ? (
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
    ) : null;

  const sidebarFooter = (
    <>
      {debugSidebarControls}
      {coordinationError ? (
        <p className="webrtc-error">{coordinationError}</p>
      ) : null}
      <div className="sidebar-footer-row">
        <SyncStatus state={syncUiState} />
        <ThemePicker
          value={themePreference}
          onChange={setThemePreference}
        />
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
      mainContent={projectSettingsContent}
      onCreateDocument={createDocument}
      onSelectDocument={(documentId) => {
        setSelectedId(documentId);
        setMainView("note");
      }}
      onRenameDocument={(title) => {
        if (selectedDocument) {
          activeProject.renameDocument(selectedDocument.id, title);
        }
      }}
      onDeleteDocument={deleteSelectedDocument}
    />
  );
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

type SyncUiInput = {
  presenceState:
    | "idle"
    | "connecting"
    | "authenticating"
    | "open"
    | "closed"
    | "error";
  onlineDeviceIds: readonly DeviceId[];
  connectedDeviceIds: readonly DeviceId[];
  localDeviceId: DeviceId | null;
  error: string | null;
};

function deriveSyncUiState({
  presenceState,
  onlineDeviceIds,
  connectedDeviceIds,
  localDeviceId,
  error,
}: SyncUiInput): SyncUiState {
  if (error) {
    return { kind: "error", detail: error };
  }

  if (presenceState === "error") {
    return { kind: "error" };
  }

  if (presenceState === "connecting" || presenceState === "authenticating") {
    return { kind: "connecting" };
  }

  if (presenceState === "closed") {
    return { kind: "offline" };
  }

  if (presenceState !== "open" || !localDeviceId) {
    return { kind: "quiet" };
  }

  if (connectedDeviceIds.length > 0) {
    return { kind: "connected" };
  }

  const otherDeviceOnline = onlineDeviceIds.some(
    (deviceId) => deviceId !== localDeviceId,
  );
  return otherDeviceOnline ? { kind: "connecting" } : { kind: "quiet" };
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

function securityStatesEqual(
  left: SecurityState,
  right: SecurityState,
): boolean {
  if (
    left.protocolVersion !== right.protocolVersion ||
    left.projectId !== right.projectId ||
    left.sequence !== right.sequence ||
    left.keyEpoch !== right.keyEpoch ||
    !bytesEqual(left.headHash, right.headHash) ||
    left.devices.length !== right.devices.length
  ) {
    return false;
  }

  return left.devices.every((device, index) => {
    const other = right.devices[index];
    return (
      other !== undefined &&
      device.deviceId === other.deviceId &&
      device.addedAtSequence === other.addedAtSequence &&
      bytesEqual(device.encryptionPublicKey, other.encryptionPublicKey) &&
      bytesEqual(device.signingPublicKey, other.signingPublicKey)
    );
  });
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;

  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
