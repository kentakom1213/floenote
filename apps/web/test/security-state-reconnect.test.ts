/** @vitest-environment jsdom */

import { webcrypto } from "node:crypto";

import {
  destroyDeviceKeyMaterial,
  generateDeviceKeyMaterial,
  sha256,
  signEd25519,
  type DeviceKeyMaterial,
} from "@floe-note/crypto";
import { NoteProject } from "@floe-note/document";
import { createWorkspaceId, type DeviceId } from "@floe-note/domain";
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
  Fragment,
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
    reconnectSessions: Array<{
      fromDeviceId: string;
      sessionId: string;
      transportMode: string;
    }>;
    stopped: boolean;
  };

  const instances: Record[] = [];

  class FakeAutomaticPeerSyncManager {
    readonly #record: Record;

    constructor(options: { securityState: unknown }) {
      this.#record = {
        securityState: options.securityState,
        onlineDeviceUpdates: [],
        reconnectSessions: [],
        stopped: false,
      };
      instances.push(this.#record);
    }

    updateOnlineDevices(deviceIds: readonly string[]): void {
      this.#record.onlineDeviceUpdates.push([...deviceIds]);
    }

    acceptReconnectSession(
      fromDeviceId: string,
      sessionId: string,
      transportMode: string,
    ): void {
      this.#record.reconnectSessions.push({
        fromDeviceId,
        sessionId,
        transportMode,
      });
    }

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

class FakeWebLocks {
  readonly requestedNames: string[] = [];
  readonly #held = new Set<string>();
  readonly #waiting: Array<{
    name: string;
    signal?: AbortSignal;
    callback: (lock: Lock | null) => Promise<void> | void;
    resolve: () => void;
    reject: (error: unknown) => void;
    abort: () => void;
  }> = [];

  request(
    name: string,
    options: { signal?: AbortSignal; ifAvailable?: boolean },
    callback: (lock: Lock | null) => Promise<void> | void,
  ): Promise<void> {
    this.requestedNames.push(name);
    if (
      options.ifAvailable &&
      (this.#held.has(name) ||
        this.#waiting.some((request) => request.name === name))
    ) {
      return Promise.resolve().then(() => callback(null));
    }
    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        const index = this.#waiting.findIndex((request) => request.abort === abort);
        if (index < 0) return;
        this.#waiting.splice(index, 1);
        reject(new DOMException("Lock request aborted", "AbortError"));
      };
      if (options.signal?.aborted) {
        reject(new DOMException("Lock request aborted", "AbortError"));
        return;
      }
      options.signal?.addEventListener("abort", abort, { once: true });
      this.#waiting.push({
        name,
        signal: options.signal,
        callback,
        resolve,
        reject,
        abort,
      });
      this.#grant();
    });
  }

  isHeld(name: string): boolean {
    return this.#held.has(name);
  }

  #grant(): void {
    let index = this.#waiting.findIndex((request) => !this.#held.has(request.name));
    while (index >= 0) {
      const [request] = this.#waiting.splice(index, 1);
      if (!request) return;
      request.signal?.removeEventListener("abort", request.abort);
      this.#held.add(request.name);
      void Promise.resolve()
        .then(() => request.callback({ name: request.name, mode: "exclusive" } as Lock))
        .then(request.resolve, request.reject)
        .finally(() => {
          this.#held.delete(request.name);
          this.#grant();
        });
      index = this.#waiting.findIndex((waiting) => !this.#held.has(waiting.name));
    }
  }
}

function enableWebLocks(): FakeWebLocks {
  const locks = new FakeWebLocks();
  vi.stubGlobal("navigator", { locks });
  return locks;
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


type ReconnectRaceHarnessProps = {
  project: NoteProject;
  localDeviceId: DeviceId;
  securityState: SecurityState;
  vaultSession: DeviceVaultSession;
  projectKeyReady: boolean;
  automaticReconnectEnabled?: boolean;
};

function ReconnectRaceHarness({
  project,
  localDeviceId,
  securityState,
  vaultSession,
  projectKeyReady,
  automaticReconnectEnabled = true,
}: ReconnectRaceHarnessProps) {
  const handleSecurityStateChanged = useCallback(() => {}, []);

  useAuthorizedWorkspaceSync({
    coordinatorBaseUrl: "https://coordinator.example",
    project,
    localDeviceId,
    securityState,
    projectKeyReady,
    vaultSession,
    automaticReconnectEnabled,
    turnCredentialEndpoint: null,
    onSecurityStateChanged: handleSecurityStateChanged,
  });

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
  vi.stubGlobal("crypto", webcrypto);
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

describe("automatic reconnect setup ordering", () => {
  it("preserves a reconnect session received by the owner during manager setup", async () => {
    enableWebLocks();
    const deviceA = await generateDeviceKeyMaterial();
    const deviceB = await generateDeviceKeyMaterial();
    keyMaterials.push(deviceA, deviceB);

    const initialState = await createInitialState(deviceA);
    const { state } = await addDeviceToState(
      initialState,
      deviceA,
      deviceB,
    );
    const project = NoteProject.create(state.workspaceId);
    const vaultSession = createVaultSession(deviceB);
    const sessionId = "0123456789abcdef0123456789abcdef";

    await act(async () => {
      root?.render(
        createElement(ReconnectRaceHarness, {
          project,
          localDeviceId: deviceB.publicIdentity.deviceId,
          securityState: state,
          vaultSession,
          projectKeyReady: false,
        }),
      );
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0]!;
    await act(async () => {
      socket.open();
      socket.message({
        type: "presence-challenge",
        challenge: bytesToHex(CHALLENGE),
        securityHead: bytesToHex(state.headHash),
      });
      await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    });

    // Presence and reconnect can arrive before React starts the lock effect.
    await act(async () => {
      socket.message({
        type: "presence-state",
        deviceIds: [
          deviceA.publicIdentity.deviceId,
          deviceB.publicIdentity.deviceId,
        ],
      });
      socket.message({
        type: "reconnect-session",
        fromDeviceId: deviceA.publicIdentity.deviceId,
        sessionId,
        transportMode: "direct",
      });
      await flushMicrotasks();
    });
    expect(peerSyncHarness.instances).toHaveLength(0);

    await act(async () => {
      root?.render(
        createElement(ReconnectRaceHarness, {
          project,
          localDeviceId: deviceB.publicIdentity.deviceId,
          securityState: state,
          vaultSession,
          projectKeyReady: true,
        }),
      );
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(peerSyncHarness.instances).toHaveLength(1);
      });
    });

    expect(peerSyncHarness.instances[0]?.reconnectSessions).toEqual([
      {
        fromDeviceId: deviceA.publicIdentity.deviceId,
        sessionId,
        transportMode: "direct",
      },
    ]);
  });
  it("drains a queued reconnect session after Presence reconnects", async () => {
    enableWebLocks();
    const deviceA = await generateDeviceKeyMaterial();
    const deviceB = await generateDeviceKeyMaterial();
    keyMaterials.push(deviceA, deviceB);

    const initialState = await createInitialState(deviceA);
    const { state } = await addDeviceToState(
      initialState,
      deviceA,
      deviceB,
    );
    const project = NoteProject.create(state.workspaceId);
    const vaultSession = createVaultSession(deviceB);
    const sessionId = "fedcba9876543210fedcba9876543210";

    await act(async () => {
      root?.render(
        createElement(ReconnectRaceHarness, {
          project,
          localDeviceId: deviceB.publicIdentity.deviceId,
          securityState: state,
          vaultSession,
          projectKeyReady: false,
        }),
      );
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
    await authenticatePresence(
      FakeWebSocket.instances[0]!,
      state.headHash,
      [
        deviceA.publicIdentity.deviceId,
        deviceB.publicIdentity.deviceId,
      ],
    );

    await act(async () => {
      FakeWebSocket.instances[0]?.message({
        type: "reconnect-session",
        fromDeviceId: deviceA.publicIdentity.deviceId,
        sessionId,
        transportMode: "relay",
      });
      FakeWebSocket.instances[0]?.disconnect(1006, "");
      await flushMicrotasks();
    });

    await act(async () => {
      root?.render(
        createElement(ReconnectRaceHarness, {
          project,
          localDeviceId: deviceB.publicIdentity.deviceId,
          securityState: state,
          vaultSession,
          projectKeyReady: true,
        }),
      );
      await flushMicrotasks();
    });

    expect(peerSyncHarness.instances).toHaveLength(1);
    expect(peerSyncHarness.instances[0]?.onlineDeviceUpdates).toEqual([]);
    expect(peerSyncHarness.instances[0]?.reconnectSessions).toEqual([]);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(FakeWebSocket.instances).toHaveLength(2);

    await authenticatePresence(
      FakeWebSocket.instances[1]!,
      state.headHash,
      [
        deviceA.publicIdentity.deviceId,
        deviceB.publicIdentity.deviceId,
      ],
    );

    const manager = peerSyncHarness.instances[0];
    expect(manager?.onlineDeviceUpdates.at(-1)).toEqual([
      deviceA.publicIdentity.deviceId,
      deviceB.publicIdentity.deviceId,
    ]);
    expect(manager?.reconnectSessions).toEqual([
      {
        fromDeviceId: deviceA.publicIdentity.deviceId,
        sessionId,
        transportMode: "relay",
      },
    ]);

    await act(async () => {
      FakeWebSocket.instances[1]?.message({
        type: "presence-state",
        deviceIds: [
          deviceA.publicIdentity.deviceId,
          deviceB.publicIdentity.deviceId,
        ],
      });
      await flushMicrotasks();
    });

    expect(manager?.reconnectSessions).toHaveLength(1);
  });

});

describe("automatic peer sync ownership", () => {
  it("requires authorization but acquires ownership before WorkspaceKey readiness", async () => {
    const locks = enableWebLocks();
    const remoteDevice = await generateDeviceKeyMaterial();
    const localDevice = await generateDeviceKeyMaterial();
    keyMaterials.push(remoteDevice, localDevice);
    const initialState = await createInitialState(remoteDevice);
    const { state } = await addDeviceToState(
      initialState,
      remoteDevice,
      localDevice,
    );
    const project = NoteProject.create(state.workspaceId);
    const props = {
      project,
      localDeviceId: localDevice.publicIdentity.deviceId,
      vaultSession: createVaultSession(localDevice),
    };

    await act(async () => {
      root?.render(
        createElement(ReconnectRaceHarness, {
          ...props,
          securityState: initialState,
          projectKeyReady: true,
        }),
      );
    });
    expect(locks.requestedNames).toEqual([]);

    await act(async () => {
      root?.render(
        createElement(ReconnectRaceHarness, {
          ...props,
          securityState: state,
          projectKeyReady: false,
        }),
      );
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(locks.requestedNames).toEqual([]);
    await authenticatePresence(FakeWebSocket.instances[1]!, state.headHash, [
      remoteDevice.publicIdentity.deviceId,
      localDevice.publicIdentity.deviceId,
    ]);
    expect(locks.requestedNames).toEqual([
      `floe:peer-sync:${project.id}:${localDevice.publicIdentity.deviceId}`,
    ]);
    expect(peerSyncHarness.instances).toHaveLength(0);

    await act(async () => {
      root?.render(
        createElement(ReconnectRaceHarness, {
          ...props,
          securityState: state,
          projectKeyReady: true,
        }),
      );
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(peerSyncHarness.instances).toHaveLength(1);
      });
    });
    expect(locks.requestedNames).toEqual([
      `floe:peer-sync:${project.id}:${localDevice.publicIdentity.deviceId}`,
    ]);

    await act(async () => {
      root?.render(
        createElement(ReconnectRaceHarness, {
          ...props,
          securityState: state,
          projectKeyReady: true,
          automaticReconnectEnabled: false,
        }),
      );
    });
    expect(peerSyncHarness.instances[0]?.stopped).toBe(true);
  });

  it("creates one manager for an eligible tab with Web Locks", async () => {
    enableWebLocks();
    const device = await generateDeviceKeyMaterial();
    keyMaterials.push(device);
    const state = await createInitialState(device);
    const project = NoteProject.create(state.workspaceId);

    await act(async () => {
      root?.render(
        createElement(ReconnectRaceHarness, {
          project,
          localDeviceId: device.publicIdentity.deviceId,
          securityState: state,
          vaultSession: createVaultSession(device),
          projectKeyReady: true,
        }),
      );
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    await authenticatePresence(FakeWebSocket.instances[0]!, state.headHash, [
      device.publicIdentity.deviceId,
    ]);
    await act(async () => {
      await vi.waitFor(() => {
        expect(peerSyncHarness.instances).toHaveLength(1);
      });
    });

    expect(peerSyncHarness.instances[0]?.onlineDeviceUpdates).toEqual([
      [device.publicIdentity.deviceId],
    ]);
  });

  it("keeps Presence in both tabs, discards follower sessions, and hands off ownership", async () => {
    enableWebLocks();
    const remoteDevice = await generateDeviceKeyMaterial();
    const localDevice = await generateDeviceKeyMaterial();
    keyMaterials.push(remoteDevice, localDevice);
    const { state } = await addDeviceToState(
      await createInitialState(remoteDevice),
      remoteDevice,
      localDevice,
    );
    const project = NoteProject.create(state.workspaceId);
    const vaultSession = createVaultSession(localDevice);
    const props = {
      project,
      localDeviceId: localDevice.publicIdentity.deviceId,
      securityState: state,
      vaultSession,
      projectKeyReady: false,
    };
    const onlineDevices = [
      remoteDevice.publicIdentity.deviceId,
      localDevice.publicIdentity.deviceId,
    ];

    await act(async () => {
      root?.render(
        createElement(
          Fragment,
          null,
          createElement(ReconnectRaceHarness, { ...props, key: "owner" }),
          createElement(ReconnectRaceHarness, { ...props, key: "follower" }),
        ),
      );
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(FakeWebSocket.instances).toHaveLength(2);
    await authenticatePresence(FakeWebSocket.instances[0]!, state.headHash, onlineDevices);
    await authenticatePresence(FakeWebSocket.instances[1]!, state.headHash, onlineDevices);
    expect(peerSyncHarness.instances).toHaveLength(0);

    const staleSessionId = "0123456789abcdef0123456789abcdef";
    await act(async () => {
      for (const socket of FakeWebSocket.instances) {
        socket.message({
          type: "reconnect-session",
          fromDeviceId: remoteDevice.publicIdentity.deviceId,
          sessionId: staleSessionId,
          transportMode: "direct",
        });
      }
      await flushMicrotasks();
    });

    await act(async () => {
      root?.render(
        createElement(
          Fragment,
          null,
          createElement(ReconnectRaceHarness, {
            ...props,
            projectKeyReady: true,
            key: "owner",
          }),
          createElement(ReconnectRaceHarness, {
            ...props,
            projectKeyReady: true,
            key: "follower",
          }),
        ),
      );
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(peerSyncHarness.instances).toHaveLength(1);
      });
    });
    expect(peerSyncHarness.instances[0]?.reconnectSessions).toEqual([
      {
        fromDeviceId: remoteDevice.publicIdentity.deviceId,
        sessionId: staleSessionId,
        transportMode: "direct",
      },
    ]);

    await act(async () => {
      root?.render(
        createElement(
          Fragment,
          null,
          createElement(ReconnectRaceHarness, {
            ...props,
            projectKeyReady: true,
            key: "follower",
          }),
        ),
      );
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(peerSyncHarness.instances).toHaveLength(2);
      });
    });

    expect(peerSyncHarness.instances[0]?.stopped).toBe(true);
    expect(FakeWebSocket.instances[1]?.readyState).toBe(FakeWebSocket.OPEN);
    const newOwner = peerSyncHarness.instances[1];
    expect(newOwner?.onlineDeviceUpdates.at(-1)).toEqual(onlineDevices);
    expect(newOwner?.reconnectSessions).toEqual([]);

    const currentSessionId = "fedcba9876543210fedcba9876543210";
    await act(async () => {
      FakeWebSocket.instances[1]?.message({
        type: "reconnect-session",
        fromDeviceId: remoteDevice.publicIdentity.deviceId,
        sessionId: currentSessionId,
        transportMode: "relay",
      });
      await flushMicrotasks();
    });
    expect(newOwner?.reconnectSessions).toEqual([
      {
        fromDeviceId: remoteDevice.publicIdentity.deviceId,
        sessionId: currentSessionId,
        transportMode: "relay",
      },
    ]);
  });

  it("releases ownership on pagehide and freeze, then reacquires on restore", async () => {
    const locks = enableWebLocks();
    const device = await generateDeviceKeyMaterial();
    keyMaterials.push(device);
    const state = await createInitialState(device);
    const project = NoteProject.create(state.workspaceId);
    const lockName = `floe:peer-sync:${project.id}:${device.publicIdentity.deviceId}`;

    await act(async () => {
      root?.render(
        createElement(ReconnectRaceHarness, {
          project,
          localDeviceId: device.publicIdentity.deviceId,
          securityState: state,
          vaultSession: createVaultSession(device),
          projectKeyReady: true,
        }),
      );
      await flushMicrotasks();
    });
    await authenticatePresence(FakeWebSocket.instances[0]!, state.headHash, [
      device.publicIdentity.deviceId,
    ]);
    await act(async () => {
      await vi.waitFor(() => expect(peerSyncHarness.instances).toHaveLength(1));
    });
    expect(locks.isHeld(lockName)).toBe(true);

    const pagehide = new Event("pagehide");
    Object.defineProperty(pagehide, "persisted", { value: true });
    await act(async () => {
      window.dispatchEvent(pagehide);
      await flushMicrotasks();
    });
    expect(peerSyncHarness.instances[0]?.stopped).toBe(true);
    expect(locks.isHeld(lockName)).toBe(false);
    expect(FakeWebSocket.instances[0]?.readyState).toBe(FakeWebSocket.OPEN);

    await act(async () => {
      window.dispatchEvent(new Event("pageshow"));
      await flushMicrotasks();
    });
    await act(async () => {
      await vi.waitFor(() => expect(peerSyncHarness.instances).toHaveLength(2));
    });
    expect(locks.isHeld(lockName)).toBe(true);

    await act(async () => {
      document.dispatchEvent(new Event("freeze"));
      await flushMicrotasks();
    });
    expect(peerSyncHarness.instances[1]?.stopped).toBe(true);
    expect(locks.isHeld(lockName)).toBe(false);

    await act(async () => {
      document.dispatchEvent(new Event("resume"));
      await flushMicrotasks();
    });
    await act(async () => {
      await vi.waitFor(() => expect(peerSyncHarness.instances).toHaveLength(3));
    });
    expect(locks.isHeld(lockName)).toBe(true);
  });

  it("keeps single-tab reconnect behavior when Web Locks is unavailable", async () => {
    const device = await generateDeviceKeyMaterial();
    keyMaterials.push(device);
    const state = await createInitialState(device);
    const project = NoteProject.create(state.workspaceId);

    await act(async () => {
      root?.render(
        createElement(ReconnectRaceHarness, {
          project,
          localDeviceId: device.publicIdentity.deviceId,
          securityState: state,
          vaultSession: createVaultSession(device),
          projectKeyReady: true,
        }),
      );
      await flushMicrotasks();
    });
    await authenticatePresence(FakeWebSocket.instances[0]!, state.headHash, [
      device.publicIdentity.deviceId,
    ]);
    expect(peerSyncHarness.instances).toHaveLength(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
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

    await act(async () => {
      await vi.waitFor(() => {
        expect(onReconciled).toHaveBeenCalledWith(initialState, true);
      });
    });
    onReconciled.mockClear();

    expect(FakeWebSocket.instances).toHaveLength(1);
    await authenticatePresence(
      FakeWebSocket.instances[0]!,
      initialState.headHash,
      [deviceA.publicIdentity.deviceId],
    );

    coordinatorState = afterAdd;
    transitions = [addDevice];

    act(() => {
      FakeWebSocket.instances[0]?.disconnect(
        1008,
        "SecurityState changed during authorized presence",
      );
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(onReconciled).toHaveBeenCalledWith(afterAdd, true);
      });
    });

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(onError).not.toHaveBeenCalled();
    expect(peerSyncHarness.instances).toHaveLength(1);
    expect(peerSyncHarness.instances[0]?.stopped).toBe(true);

    await authenticatePresence(
      FakeWebSocket.instances[1]!,
      afterAdd.headHash,
      [
        deviceA.publicIdentity.deviceId,
        deviceD.publicIdentity.deviceId,
      ],
    );
    await act(async () => {
      await vi.waitFor(() => expect(peerSyncHarness.instances).toHaveLength(2));
    });

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

    await act(async () => {
      await vi.waitFor(() => {
        expect(onReconciled).toHaveBeenCalledWith(afterAdd, true);
      });
    });
    onReconciled.mockClear();

    expect(FakeWebSocket.instances).toHaveLength(1);
    await authenticatePresence(
      FakeWebSocket.instances[0]!,
      afterAdd.headHash,
      [
        deviceA.publicIdentity.deviceId,
        deviceB.publicIdentity.deviceId,
      ],
    );

    coordinatorState = afterRevoke;
    transitions = [revokeDevice];

    act(() => {
      FakeWebSocket.instances[0]?.disconnect(
        1008,
        "SecurityState changed",
      );
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(onReconciled).toHaveBeenCalledWith(afterRevoke, false);
      });
    });

    expect(peerSyncHarness.instances[0]?.stopped).toBe(true);
    expect(onError).not.toHaveBeenCalled();
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
  });

  expect(FakeWebSocket.instances).toHaveLength(1);
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
    await vi.waitFor(() => {
      expect(socket.sent).toHaveLength(1);
    });
  });

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
    createWorkspaceId(),
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
  _device: DeviceKeyMaterial,
): DeviceVaultSession {
  return {
    sign: async () => new Uint8Array(64).fill(2),
  } as unknown as DeviceVaultSession;
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
