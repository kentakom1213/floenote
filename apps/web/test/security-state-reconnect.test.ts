/** @vitest-environment jsdom */

import {
  destroyDeviceKeyMaterial,
  generateDeviceKeyMaterial,
  sha256,
  signEd25519,
  type DeviceKeyMaterial,
} from "@floe-note/crypto";
import { NoteProject } from "@floe-note/document";
import type { DeviceId } from "@floe-note/domain";
import {
  AUTHORIZED_PRESENCE_CHALLENGE_BYTES,
  attachAddDeviceSignature,
  attachCreateWorkspaceSignature,
  attachRevokeDeviceSignature,
  createUnsignedAddDeviceTransition,
  createUnsignedCreateWorkspaceTransition,
  createUnsignedRevokeDeviceTransition,
  deriveAddDeviceSecurityState,
  deriveInitialSecurityState,
  deriveRevokeDeviceSecurityState,
  encodeAddDeviceTransition,
  encodeCreateWorkspaceTransition,
  encodeRevokeDeviceTransition,
  encodeUnsignedAddDeviceTransition,
  encodeUnsignedCreateWorkspaceTransition,
  encodeUnsignedRevokeDeviceTransition,
  type SecurityState,
  type SecurityTransition,
} from "@floe-note/security";
import type { DeviceVaultSession } from "@floe-note/vault";
import {
  act,
  createElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const peerSyncHarness = vi.hoisted(() => {
  type Record = {
    securityState: unknown;
    onlineDeviceUpdates: string[][];
    stopped: boolean;
  };

  const instances: Record[] = [];

  class FakeAutomaticPeerSyncManager {
    readonly #record: Record;

    constructor(options: { securityState: unknown }) {
      this.#record = {
        securityState: options.securityState,
        onlineDeviceUpdates: [],
        stopped: false,
      };
      instances.push(this.#record);
    }

    updateOnlineDevices(deviceIds: readonly string[]): void {
      this.#record.onlineDeviceUpdates.push([...deviceIds]);
    }

    acceptReconnectSession(): void {}

    stop(): void {
      this.#record.stopped = true;
    }
  }

  return {
    FakeAutomaticPeerSyncManager,
    instances,
    reset: () => {
      instances.length = 0;
    },
  };
});

vi.mock("../src/AutomaticPeerSyncManager.js", () => ({
  AutomaticPeerSyncManager: peerSyncHarness.FakeAutomaticPeerSyncManager,
}));

import {
  reconcileVerifiedSecurityState,
  type SecurityStateCoordinatorReader,
} from "../src/security-reconciliation.js";
import { useAuthorizedWorkspaceSync } from "../src/useWorkspaceSync.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;

  readonly #listeners = new Map<string, Set<(event: any) => void>>();

  constructor(readonly url: string | URL) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: any) => void): void {
    const handlers = this.#listeners.get(type) ?? new Set();
    handlers.add(handler);
    this.#listeners.set(type, handlers);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.#emit("close", {
      code,
      reason,
      wasClean: code === 1000,
    });
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.#emit("open", {});
  }

  message(data: unknown): void {
    this.#emit("message", { data: JSON.stringify(data) });
  }

  disconnect(code: number, reason: string): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.#emit("close", {
      code,
      reason,
      wasClean: code === 1000,
    });
  }

  #emit(type: string, event: any): void {
    for (const handler of this.#listeners.get(type) ?? []) {
      handler(event);
    }
  }
}

type RecoveryHarnessProps = {
  project: NoteProject;
  localDeviceId: DeviceId;
  initialSecurityState: SecurityState;
  vaultSession: DeviceVaultSession;
  coordinator: SecurityStateCoordinatorReader;
  onReconciled: (state: SecurityState, authorized: boolean) => void;
  onError: (error: unknown) => void;
};

function RecoveryHarness({
  project,
  localDeviceId,
  initialSecurityState,
  vaultSession,
  coordinator,
  onReconciled,
  onError,
}: RecoveryHarnessProps) {
  const [securityState, setSecurityState] = useState<SecurityState | null>(
    initialSecurityState,
  );
  const [securityRefreshToken, setSecurityRefreshToken] = useState(0);

  const handleSecurityStateChanged = useCallback(() => {
    setSecurityRefreshToken((value) => value + 1);
  }, []);

  useAuthorizedWorkspaceSync({
    coordinatorBaseUrl: "https://coordinator.example",
    project,
    localDeviceId,
    securityState,
    projectKeyReady: securityState !== null,
    vaultSession,
    automaticReconnectEnabled: true,
    turnCredentialEndpoint: null,
    onSecurityStateChanged: handleSecurityStateChanged,
  });

  useEffect(() => {
    if (!securityState) return;

    let cancelled = false;
    void reconcileVerifiedSecurityState(coordinator, securityState)
      .then((verifiedState) => {
        if (cancelled) return;

        const authorized = verifiedState.devices.some(
          (device) => device.deviceId === localDeviceId,
        );
        onReconciled(verifiedState, authorized);
        setSecurityState(authorized ? verifiedState : null);
      })
      .catch((error: unknown) => {
        if (!cancelled) onError(error);
      });

    return () => {
      cancelled = true;
    };
  }, [securityRefreshToken]);

  return null;
}

const keyMaterials: DeviceKeyMaterial[] = [];
const CHALLENGE = new Uint8Array(
  AUTHORIZED_PRESENCE_CHALLENGE_BYTES,
).fill(0x42);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
  peerSyncHarness.reset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
  await Promise.all(keyMaterials.splice(0).map(destroyDeviceKeyMaterial));
});

describe("authorized Workspace sync after SecurityState changes", () => {
  it("reconciles a verified AddDevice transition and recreates presence with the new head", async () => {
    const deviceA = await generateDeviceKeyMaterial();
    const deviceD = await generateDeviceKeyMaterial();
    keyMaterials.push(deviceA, deviceD);

    const initialState = await createInitialState(deviceA);
    const { transition: addDevice, state: afterAdd } = await addDeviceToState(
      initialState,
      deviceA,
      deviceD,
    );

    let coordinatorState = initialState;
    let transitions: readonly SecurityTransition[] = [];
    const coordinator: SecurityStateCoordinatorReader = {
      getSecurityState: vi.fn(async () => coordinatorState),
      getSecurityTransitions: vi.fn(async () => transitions),
    };
    const onReconciled = vi.fn();
    const onError = vi.fn();

    await renderRecoveryHarness({
      project: NoteProject.create(initialState.workspaceId),
      localDeviceId: deviceA.publicIdentity.deviceId,
      initialSecurityState: initialState,
      vaultSession: createVaultSession(deviceA),
      coordinator,
      onReconciled,
      onError,
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
    await authenticatePresence(
      FakeWebSocket.instances[0]!,
      initialState.headHash,
      [deviceA.publicIdentity.deviceId],
    );

    onReconciled.mockClear();
    coordinatorState = afterAdd;
    transitions = [addDevice];

    await act(async () => {
      FakeWebSocket.instances[0]?.disconnect(
        1008,
        "SecurityState changed during authorized presence",
      );
      await flushMicrotasks();
    });

    expect(onError).not.toHaveBeenCalled();
    expect(onReconciled).toHaveBeenCalledWith(afterAdd, true);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(peerSyncHarness.instances).toHaveLength(2);
    expect(peerSyncHarness.instances[0]?.stopped).toBe(true);

    await authenticatePresence(
      FakeWebSocket.instances[1]!,
      afterAdd.headHash,
      [
        deviceA.publicIdentity.deviceId,
        deviceD.publicIdentity.deviceId,
      ],
    );

    const refreshedManager = peerSyncHarness.instances[1];
    expect(refreshedManager?.securityState).toEqual(afterAdd);
    expect(refreshedManager?.onlineDeviceUpdates.at(-1)).toEqual([
      deviceA.publicIdentity.deviceId,
      deviceD.publicIdentity.deviceId,
    ]);
  });

  it("does not recreate presence after reconciliation revokes the local device", async () => {
    const deviceA = await generateDeviceKeyMaterial();
    const deviceB = await generateDeviceKeyMaterial();
    keyMaterials.push(deviceA, deviceB);

    const initialState = await createInitialState(deviceA);
    const { state: afterAdd } = await addDeviceToState(
      initialState,
      deviceA,
      deviceB,
    );
    const { transition: revokeDevice, state: afterRevoke } =
      await revokeDeviceFromState(afterAdd, deviceA, deviceB);

    let coordinatorState = afterAdd;
    let transitions: readonly SecurityTransition[] = [];
    const coordinator: SecurityStateCoordinatorReader = {
      getSecurityState: vi.fn(async () => coordinatorState),
      getSecurityTransitions: vi.fn(async () => transitions),
    };
    const onReconciled = vi.fn();
    const onError = vi.fn();

    await renderRecoveryHarness({
      project: NoteProject.create(afterAdd.workspaceId),
      localDeviceId: deviceB.publicIdentity.deviceId,
      initialSecurityState: afterAdd,
      vaultSession: createVaultSession(deviceB),
      coordinator,
      onReconciled,
      onError,
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
    await authenticatePresence(
      FakeWebSocket.instances[0]!,
      afterAdd.headHash,
      [
        deviceA.publicIdentity.deviceId,
        deviceB.publicIdentity.deviceId,
      ],
    );

    onReconciled.mockClear();
    coordinatorState = afterRevoke;
    transitions = [revokeDevice];

    await act(async () => {
      FakeWebSocket.instances[0]?.disconnect(
        1008,
        "SecurityState changed",
      );
      await flushMicrotasks();
    });

    expect(onError).not.toHaveBeenCalled();
    expect(onReconciled).toHaveBeenCalledWith(afterRevoke, false);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(peerSyncHarness.instances).toHaveLength(1);
    expect(peerSyncHarness.instances[0]?.stopped).toBe(true);
  });
});

async function renderRecoveryHarness(
  props: RecoveryHarnessProps,
): Promise<void> {
  await act(async () => {
    root?.render(createElement(RecoveryHarness, props));
    await flushMicrotasks();
  });
}

async function authenticatePresence(
  socket: FakeWebSocket,
  securityHead: Uint8Array,
  onlineDeviceIds: readonly DeviceId[],
): Promise<void> {
  await act(async () => {
    socket.open();
    socket.message({
      type: "presence-challenge",
      challenge: bytesToHex(CHALLENGE),
      securityHead: bytesToHex(securityHead),
    });
    await flushMicrotasks();
  });

  expect(socket.sent).toHaveLength(1);

  await act(async () => {
    socket.message({
      type: "presence-state",
      deviceIds: onlineDeviceIds,
    });
    await flushMicrotasks();
  });
}

async function createInitialState(
  device: DeviceKeyMaterial,
): Promise<SecurityState> {
  const unsigned = createUnsignedCreateWorkspaceTransition(
    crypto.randomUUID() as SecurityState["workspaceId"],
    device.publicIdentity,
  );
  const transition = attachCreateWorkspaceSignature(
    unsigned,
    await signEd25519(
      encodeUnsignedCreateWorkspaceTransition(unsigned),
      device.signingPrivateKey,
    ),
  );

  return deriveInitialSecurityState(
    transition,
    await sha256(encodeCreateWorkspaceTransition(transition)),
  );
}

async function addDeviceToState(
  state: SecurityState,
  signer: DeviceKeyMaterial,
  added: DeviceKeyMaterial,
) {
  const unsigned = createUnsignedAddDeviceTransition(
    state,
    added.publicIdentity,
    signer.publicIdentity.deviceId,
  );
  const transition = attachAddDeviceSignature(
    unsigned,
    await signEd25519(
      encodeUnsignedAddDeviceTransition(unsigned),
      signer.signingPrivateKey,
    ),
  );

  return {
    transition,
    state: deriveAddDeviceSecurityState(
      state,
      transition,
      await sha256(encodeAddDeviceTransition(transition)),
    ),
  };
}

async function revokeDeviceFromState(
  state: SecurityState,
  signer: DeviceKeyMaterial,
  revoked: DeviceKeyMaterial,
) {
  const unsigned = createUnsignedRevokeDeviceTransition(
    state,
    revoked.publicIdentity.deviceId,
    signer.publicIdentity.deviceId,
  );
  const transition = attachRevokeDeviceSignature(
    unsigned,
    await signEd25519(
      encodeUnsignedRevokeDeviceTransition(unsigned),
      signer.signingPrivateKey,
    ),
  );

  return {
    transition,
    state: deriveRevokeDeviceSecurityState(
      state,
      transition,
      await sha256(encodeRevokeDeviceTransition(transition)),
    ),
  };
}

function createVaultSession(
  device: DeviceKeyMaterial,
): DeviceVaultSession {
  return {
    sign: (message: Uint8Array) =>
      signEd25519(message, device.signingPrivateKey),
  } as DeviceVaultSession;
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
