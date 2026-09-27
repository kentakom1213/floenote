import { parseWorkspaceId } from "@floe-note/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CoordinatorSignalingClient } from "../src/signaling-client.js";
import { parseSessionId } from "../src/session-id.js";

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

  disconnect(code = 1006): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.#emit("close", {
      code,
      reason: "",
      wasClean: false,
    });
  }

  #emit(type: string, event: any): void {
    for (const handler of this.#listeners.get(type) ?? []) {
      handler(event);
    }
  }
}

const WORKSPACE_ID = parseWorkspaceId(
  "00000000-0000-7000-8000-000000000010",
);
const OTHER_WORKSPACE_ID = parseWorkspaceId(
  "00000000-0000-7000-8000-000000000011",
);
const SESSION_ID = parseSessionId(
  "00000000000070008000000000000020",
);

describe("CoordinatorSignalingClient reconnect", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses separate Workspace signaling routes for the same session", () => {
    const first = new CoordinatorSignalingClient(
      "https://coordinator.example",
      WORKSPACE_ID,
      SESSION_ID,
    );
    const second = new CoordinatorSignalingClient(
      "https://coordinator.example",
      OTHER_WORKSPACE_ID,
      SESSION_ID,
    );

    first.start();
    second.start();

    expect(new URL(FakeWebSocket.instances[0]!.url).pathname).toBe(
      `/workspaces/${WORKSPACE_ID}/sessions/${SESSION_ID}`,
    );
    expect(new URL(FakeWebSocket.instances[1]!.url).pathname).toBe(
      `/workspaces/${OTHER_WORKSPACE_ID}/sessions/${SESSION_ID}`,
    );

    first.close();
    second.close();
  });

  it("reconnects after an abnormal 1006 close", async () => {
    const debugEvents: Array<{
      event: string;
      details: Record<string, unknown>;
    }> = [];
    const client = new CoordinatorSignalingClient(
      "https://coordinator.example",
      WORKSPACE_ID,
      SESSION_ID,
      ({ event, details }) => debugEvents.push({ event, details }),
    );

    client.start();

    const first = FakeWebSocket.instances[0];
    expect(first).toBeDefined();
    first?.open();
    expect(client.state).toBe("open");

    first?.disconnect(1006);
    expect(client.state).toBe("closed");
    expect(
      debugEvents.some(
        ({ event, details }) =>
          event === "socket.reconnect-scheduled" &&
          details.delayMs === 1_000,
      ),
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(999);
    expect(FakeWebSocket.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(client.state).toBe("connecting");

    const second = FakeWebSocket.instances[1];
    second?.open();
    expect(client.state).toBe("open");
    expect(
      debugEvents.some(({ event }) => event === "socket.reconnect-start"),
    ).toBe(true);

    client.close();
  });

  it("does not reconnect after an intentional close", async () => {
    const client = new CoordinatorSignalingClient(
      "https://coordinator.example",
      WORKSPACE_ID,
      SESSION_ID,
    );

    client.start();
    FakeWebSocket.instances[0]?.open();

    client.close();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(client.state).toBe("closed");
  });

  it("does not reconnect after a non-retryable protocol close", async () => {
    const client = new CoordinatorSignalingClient(
      "https://coordinator.example",
      WORKSPACE_ID,
      SESSION_ID,
    );

    client.start();
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    socket?.disconnect(1008);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(client.state).toBe("closed");

    client.close();
  });
});
