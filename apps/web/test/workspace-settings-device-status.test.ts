import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseDeviceId, parseWorkspaceId } from "@floe-note/domain";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceSettingsView } from "../src/WorkspaceSettingsView.js";

describe("WorkspaceSettingsView device status", () => {
  it("shows an offline peer as Offline even if a stale direct attempt remains", () => {
    const localDeviceId = parseDeviceId(
      "00000000-0000-7000-8000-000000000001",
    );
    const remoteDeviceId = parseDeviceId(
      "00000000-0000-7000-8000-000000000002",
    );

    const markup = renderToStaticMarkup(
      createElement(WorkspaceSettingsView, {
        workspaceId: parseWorkspaceId(
          "00000000-0000-7000-8000-000000000010",
        ),
        workspaceName: "Personal",
        localDeviceId,
        authorizedDevices: [
          {
            deviceId: localDeviceId,
            encryptionPublicKey: new Uint8Array(32),
            signingPublicKey: new Uint8Array(32),
            addedAtSequence: 0,
          },
          {
            deviceId: remoteDeviceId,
            encryptionPublicKey: new Uint8Array(32),
            signingPublicKey: new Uint8Array(32),
            addedAtSequence: 1,
          },
        ],
        onlineDeviceIds: [localDeviceId],
        connectedDeviceIds: [],
        connectionAttempts: [
          {
            deviceId: remoteDeviceId,
            mode: "direct",
          },
        ],
        securityState: "ready",
        securityError: null,
        coordinationState: "ready",
        coordinationError: null,
        getDeviceDisplayName: (deviceId) =>
          deviceId === remoteDeviceId ? "Android" : "Ubuntu",
        onRenameWorkspace: vi.fn(),
        onRemoveWorkspaceFromDevice: vi.fn(async () => undefined),
        onAddDevice: vi.fn(),
        onRetrySecurity: vi.fn(),
        onRemoveDevice: vi.fn(async () => undefined),
      }),
    );

    expect(markup).toContain("Android");
    expect(markup).toContain(">Offline<");
    expect(markup).not.toContain("Connecting · Direct");
  });
});
