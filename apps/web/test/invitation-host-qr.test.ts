/** @vitest-environment jsdom */

import {
  parseInviteId,
  parsePairingSecret,
} from "@floe-note/coordinator-client";
import { createDeviceId } from "@floe-note/domain";
import type {
  WebRtcStatus,
  WebRtcTransport,
} from "@floe-note/transport/webrtc";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InvitationHostPanel } from "../src/InvitationHostPanel.js";

vi.mock("qrcode.react", async () => {
  const { createElement } = await import("react");

  return {
    QRCodeSVG: ({ value }: { value: string }) =>
      createElement("svg", {
        "data-testid": "invitation-qr",
        "data-value": value,
      }),
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INVITE_ID = parseInviteId("0123456789abcdef0123456789abcdef");
const PAIRING_SECRET = parsePairingSecret(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("InvitationHostPanel invitation sharing", () => {
  it("encodes the exact existing invitation URL in the QR code", () => {
    renderInvitation();

    const input = container?.querySelector<HTMLInputElement>(
      'input[aria-label="Invitation link"]',
    );
    const qr = container?.querySelector<SVGElement>(
      '[data-testid="invitation-qr"]',
    );
    const expected = expectedInviteUrl();

    expect(input?.value).toBe(expected);
    expect(qr?.dataset.value).toBe(expected);
    expect(expected).toContain(`#s=${PAIRING_SECRET}`);
  });

  it("keeps copying the same complete invitation URL", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderInvitation();

    const button = [...(container?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent === "Copy link",
    );
    expect(button).toBeDefined();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(expectedInviteUrl());

    act(() => {
      vi.runAllTimers();
    });
  });

  it("keeps the existing approval and cancellation callbacks intact", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn().mockResolvedValue(undefined);
    renderInvitation({
      joiningDeviceId: createDeviceId(),
      joiningDeviceName: "Phone",
      authorizationState: "ready",
      onConfirm,
      onCancel,
    });

    const buttons = [...(container?.querySelectorAll("button") ?? [])];
    const approve = buttons.find(
      (candidate) => candidate.textContent === "Approve device",
    );
    const cancel = buttons.find(
      (candidate) => candidate.textContent === "Cancel invitation",
    );

    await act(async () => {
      approve?.click();
      await Promise.resolve();
    });
    expect(onConfirm).toHaveBeenCalledOnce();

    await act(async () => {
      cancel?.click();
      await Promise.resolve();
    });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

function renderInvitation(
  overrides: Partial<Parameters<typeof InvitationHostPanel>[0]> = {},
): void {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  act(() => {
    root?.render(
      createElement(InvitationHostPanel, {
        inviteId: INVITE_ID,
        pairingSecret: PAIRING_SECRET,
        expiresAt: Date.now() + 600_000,
        transport: testTransport(),
        signalingState: "open",
        joiningDeviceId: null,
        joiningDeviceName: null,
        authorizationState: "waiting",
        workspaceKeyDeliveryState: "waiting",
        error: null,
        onConfirm: vi.fn().mockResolvedValue(undefined),
        onRetryWorkspaceKeyDelivery: vi.fn().mockResolvedValue(undefined),
        onCancel: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      }),
    );
  });
}

function expectedInviteUrl(): string {
  const url = new URL(window.location.origin);
  url.pathname = `/join/v1/${INVITE_ID}`;
  url.hash = `s=${PAIRING_SECRET}`;
  return url.toString();
}

function testTransport(): WebRtcTransport {
  const status: WebRtcStatus = {
    connectionState: "new",
    iceConnectionState: "new",
    iceGatheringState: "new",
    dataChannelState: "none",
    gatheredCandidateCount: 0,
    warning: null,
    error: null,
  };

  return {
    status,
    onStatusChange(handler: (value: WebRtcStatus) => void) {
      handler(status);
      return () => {};
    },
  } as unknown as WebRtcTransport;
}
