import {
  parseDeviceId,
  parseProjectId,
} from "@floe-note/domain";
import {
  AUTHORIZED_PRESENCE_CHALLENGE_BYTES,
  SECURITY_HEAD_HASH_BYTES,
} from "@floe-note/security";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTHORIZED_PRESENCE_RECONNECT_DELAYS_MS,
  AuthorizedPresenceClient,
} from "../src/authorized-presence-client.js";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;

  readonly #listeners = new Map<string, Set<(event: any) => void>>();

  constructor(url: string | URL) {
    this.url = String(url);
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

  disconnect(code = 1006, reason = ""): void {
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

const PROJECT_ID = parseProjectId(
  "00000000-0000-7000-8000-000000000010",
);
const DEVICE_ID = parseDeviceId(
  "00000000-0000-7000-8000-000000000001",
);
const SECURITY_HEAD = new Uint8Array(SECURITY_HEAD_HASH_BYTES);
const CHALLENGE = new Uint8Array(AUTHORIZED_PRESENCE_CHALLENGE_BYTES).fill(1);

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createClient() {
  return new AuthorizedPresenceClient({
    coordinatorBaseUrl: "https://coordinator.example",
    projectId: PROJECT_ID,
    deviceId: DEVICE_ID,
    securityHead: SECURITY_HEAD,
    sign: async () => new Uint8Array(64).fill(2),
  });
}

async function authenticate(
  client: AuthorizedPresenceClient,
  socket: FakeWebSocket,
): Promise<void> {
  socket.open();
  socket.message({
    type: "presence-challenge",
    challenge: bytesToHex(CHALLENGE),
    securityHead: bytesToHex(SECURITY_HEAD),
  });
  await Promise.resolve();
  await Promise.resolve();

  expect(socket.sent).toHaveLength(1);

  socket.message({
    type: "presence-state",
    deviceIds: [DEVICE_ID],
  });
  expect(client.state).toBe("open");
}

describe("AuthorizedPresenceClient reconnect", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([1000, 1006])(
    "reconnects after transient close code %i",
    async (code) => {
      const client = createClient();
      client.start();

      const first = FakeWebSocket.instances[0];
      expect(first).toBeDefined();
      await authenticate(client, first!);

      first?.disconnect(code);
      expect(client.state).toBe("connecting");

      await vi.advanceTimersByTimeAsync(
        AUTHORIZED_PRESENCE_RECONNECT_DELAYS_MS[0] - 1,
      );
      expect(FakeWebSocket.instances).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(client.state).toBe("connecting");

      client.close();
    },
  );

  it("does not reconnect after an intentional close", async () => {
    const client = createClient();
    client.start();
    await authenticate(client, FakeWebSocket.instances[0]!);

    client.close();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(client.state).toBe("closed");
  });

  it("does not reconnect after SecurityState changes", async () => {
    const client = createClient();
    const errors: string[] = [];
    client.onError((error) => errors.push(error.message));
    client.start();
    await authenticate(client, FakeWebSocket.instances[0]!);

    FakeWebSocket.instances[0]?.disconnect(1008, "SecurityState changed");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(client.state).toBe("error");
    expect(errors).toContain("SecurityState changed");

    client.close();
  });

  it("retries immediately when requested during backoff", async () => {
    const client = createClient();
    client.start();
    await authenticate(client, FakeWebSocket.instances[0]!);

    FakeWebSocket.instances[0]?.disconnect(1006);
    expect(FakeWebSocket.instances).toHaveLength(1);

    client.retryNow();

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(client.state).toBe("connecting");

    await vi.advanceTimersByTimeAsync(
      AUTHORIZED_PRESENCE_RECONNECT_DELAYS_MS[0],
    );
    expect(FakeWebSocket.instances).toHaveLength(2);

    client.close();
  });

  it("resets reconnect backoff after authentication succeeds", async () => {
    const client = createClient();
    client.start();
    await authenticate(client, FakeWebSocket.instances[0]!);

    FakeWebSocket.instances[0]?.disconnect(1006);
    await vi.advanceTimersByTimeAsync(
      AUTHORIZED_PRESENCE_RECONNECT_DELAYS_MS[0],
    );

    const second = FakeWebSocket.instances[1];
    expect(second).toBeDefined();
    second?.disconnect(1006);

    await vi.advanceTimersByTimeAsync(
      AUTHORIZED_PRESENCE_RECONNECT_DELAYS_MS[1],
    );

    const third = FakeWebSocket.instances[2];
    expect(third).toBeDefined();
    await authenticate(client, third!);

    third?.disconnect(1006);
    await vi.advanceTimersByTimeAsync(
      AUTHORIZED_PRESENCE_RECONNECT_DELAYS_MS[0],
    );

    expect(FakeWebSocket.instances).toHaveLength(4);

    client.close();
  });
});
