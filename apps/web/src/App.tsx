import { useEffect, useRef, useState } from "react";

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
import { type NoteDocument, type NoteProject } from "@floe-note/document";
import type { DeviceId, DocumentId } from "@floe-note/domain";
import {
  authenticatePairingChannel,
  exchangeJoiningDeviceIdentity,
  sendProjectKeyDelivery,
} from "@floe-note/pairing";
import {
  attachAddDeviceSignature,
  attachCreateProjectSignature,
  createUnsignedAddDeviceTransition,
  createUnsignedCreateProjectTransition,
  deriveAddDeviceSecurityState,
  deriveInitialSecurityState,
  encodeAddDeviceTransition,
  encodeCreateProjectTransition,
  encodeUnsignedAddDeviceTransition,
  encodeUnsignedCreateProjectTransition,
  type DevicePublicIdentity,
  type SecurityState,
} from "@floe-note/security";
import { DexieProjectStorage } from "@floe-note/storage";
import { ProjectSyncEngine } from "@floe-note/sync";
import { BroadcastChannelTransport } from "@floe-note/transport/broadcast-channel";
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
import { MarkdownEditor } from "./MarkdownEditor.js";
import { SignaledJoinPage } from "./SignaledJoinPage.js";
import { SignalingHostPanel } from "./SignalingHostPanel.js";
import { WebRtcDebugPanel } from "./WebRtcDebugPanel.js";
import { WebRtcJoinPage } from "./WebRtcJoinPage.js";

const projectStorage = new DexieProjectStorage();
const deviceVault = new WebAuthnPrfDeviceVault();
const searchParams = new URLSearchParams(window.location.search);
const useManualWebRtc = searchParams.get("transport") === "webrtc";
const useSignaledWebRtc = searchParams.get("transport") === "signal";
const useInvitationWebRtc = searchParams.get("transport") === "invite";
const useManualWebRtcJoin = searchParams.get("join") === "webrtc";
const useSignaledWebRtcJoin = searchParams.get("join") === "signal";
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
  const [openedProject, setOpenedProject] = useState<OpenedProject | null>(null);
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
    let cancelled = false;

    void projectStorage
      .openOrCreateProject()
      .then((result) => {
        if (!cancelled) setOpenedProject(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : "Failed to load project",
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
        if (
          !storedState.devices.some(
            (device) => device.deviceId === localDeviceId,
          )
        ) {
          throw new Error(
            "This Device Vault identity is not authorized by the stored SecurityState",
          );
        }

        if (!cancelled) {
          setLocalSecurityState(storedState);
          setLocalSecurityBootstrapState("committed");
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

      if (!cancelled) {
        setLocalSecurityState(committedState);
        setLocalSecurityBootstrapState("committed");
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
  }, [deviceVaultState, localDeviceId, project]);

  useEffect(() => {
    if (!project) return;

    const unsubscribeUi = project.subscribe(() =>
      setRevision((value) => value + 1),
    );
    const stopPersistence = projectStorage.watchProject(project);

    return () => {
      unsubscribeUi();
      stopPersistence();
    };
  }, [project]);

  useEffect(() => {
    if (!project) return;

    setCoordinationError(null);
    setJoiningDevice(null);
    setDeviceAuthorizationState("waiting");

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

    const transport = new BroadcastChannelTransport(project.id);
    const syncEngine = new ProjectSyncEngine(project, transport);
    syncEngine.start();

    return () => syncEngine.stop();
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

  if (!project) {
    return (
      <main className="empty-state">
        <p>Loading local notes…</p>
      </main>
    );
  }

  const activeProject = project;
  const summaries = activeProject.listDocuments();
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

      setLocalDeviceId(session.publicIdentity.deviceId);
      setDeviceVaultState("unlocked");
    } catch (error: unknown) {
      setDeviceVaultState("error");
      setDeviceVaultError(
        error instanceof Error ? error.message : "Failed to unlock Device Vault",
      );
    }
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

    setDeviceAuthorizationState("authorizing");
    setCoordinationError(null);

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
      const committedState = await securityCoordinator.commitAddDevice(
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
    }
  }

  function createDocument() {
    const document = activeProject.createDocument();
    setSelectedId(document.id);
  }

  function deleteSelectedDocument() {
    if (!selectedId) return;

    activeProject.deleteDocument(selectedId);
    const next = activeProject.listDocuments()[0];
    setSelectedId(next?.id ?? null);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div>
            <p className="eyebrow">Local-first notes</p>
            <h1>Floe Note</h1>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={createDocument}
            aria-label="Create note"
          >
            +
          </button>
        </div>

        <DeviceVaultPanel
          state={deviceVaultState}
          deviceId={localDeviceId}
          error={deviceVaultError}
          securityState={localSecurityBootstrapState}
          securityHeadHash={
            localSecurityState ? bytesToHex(localSecurityState.headHash) : null
          }
          securitySequence={localSecurityState?.sequence ?? null}
          securityKeyEpoch={localSecurityState?.keyEpoch ?? null}
          securityDeviceCount={localSecurityState?.devices.length ?? null}
          securityError={localSecurityError}
          onUnlockOrCreate={unlockOrCreateDevice}
        />

        <nav className="note-list" aria-label="Notes">
          {summaries.map((summary) => (
            <button
              className={
                summary.id === selectedId ? "note-item selected" : "note-item"
              }
              key={summary.id}
              type="button"
              onClick={() => setSelectedId(summary.id)}
            >
              {summary.title || "Untitled"}
            </button>
          ))}
        </nav>

        {useInvitationWebRtc && invitationHost && webRtcTransport ? (
          <InvitationHostPanel
            inviteId={invitationHost.inviteId}
            pairingSecret={invitationHost.pairingSecret}
            expiresAt={invitationHost.expiresAt}
            transport={webRtcTransport}
            signalingState={signalingState}
            joiningDeviceId={joiningDevice?.deviceId ?? null}
            authorizationState={deviceAuthorizationState}
            onConfirm={authorizeJoiningDevice}
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
        ) : webRtcTransport ? (
          <WebRtcDebugPanel
            projectId={activeProject.id}
            transport={webRtcTransport}
          />
        ) : null}

        {coordinationError ? (
          <p className="webrtc-error">{coordinationError}</p>
        ) : null}
      </aside>

      <section className="workspace">
        {selectedDocument ? (
          <DocumentPane
            document={selectedDocument}
            onRename={(title) =>
              activeProject.renameDocument(selectedDocument.id, title)
            }
            onDelete={deleteSelectedDocument}
          />
        ) : (
          <div className="empty-state">
            <p>No notes yet.</p>
            <button type="button" onClick={createDocument}>
              Create a note
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

type DocumentPaneProps = {
  document: NoteDocument;
  onRename: (title: string) => void;
  onDelete: () => void;
};

function DocumentPane({
  document,
  onRename,
  onDelete,
}: DocumentPaneProps) {
  return (
    <article className="document-pane">
      <header className="document-header">
        <input
          className="title-input"
          value={document.title}
          onChange={(event) => onRename(event.target.value)}
          aria-label="Note title"
        />
        <button className="delete-button" type="button" onClick={onDelete}>
          Delete
        </button>
      </header>
      <MarkdownEditor document={document} />
    </article>
  );
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
