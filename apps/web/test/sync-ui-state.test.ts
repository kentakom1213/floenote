import { createDeviceId } from "@floe-note/domain";
import { describe, expect, it } from "vitest";

import { deriveSyncUiState } from "../src/sync-ui-state.js";

describe("deriveSyncUiState", () => {
  it("shows Connected when a direct peer remains connected after presence closes", () => {
    const localDeviceId = createDeviceId();
    const remoteDeviceId = createDeviceId();

    expect(
      deriveSyncUiState({
        presenceState: "closed",
        onlineDeviceIds: [],
        connectedDeviceIds: [remoteDeviceId],
        localDeviceId,
        error: null,
      }),
    ).toEqual({ kind: "connected" });
  });

  it("keeps explicit sync errors above connection state", () => {
    const localDeviceId = createDeviceId();
    const remoteDeviceId = createDeviceId();

    expect(
      deriveSyncUiState({
        presenceState: "open",
        onlineDeviceIds: [remoteDeviceId],
        connectedDeviceIds: [remoteDeviceId],
        localDeviceId,
        error: "peer failed",
      }),
    ).toEqual({ kind: "error", detail: "peer failed" });
  });

  it("shows Offline when presence is closed and no peer is connected", () => {
    expect(
      deriveSyncUiState({
        presenceState: "closed",
        onlineDeviceIds: [],
        connectedDeviceIds: [],
        localDeviceId: createDeviceId(),
        error: null,
      }),
    ).toEqual({ kind: "offline" });
  });
});
