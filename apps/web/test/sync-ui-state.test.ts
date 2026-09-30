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
        ownsAutomaticPeerSync: true,
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
        ownsAutomaticPeerSync: true,
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
        ownsAutomaticPeerSync: true,
        connectedDeviceIds: [],
        localDeviceId: createDeviceId(),
        error: null,
      }),
    ).toEqual({ kind: "offline" });
  });

  it("keeps Connected when coordinator presence fails but a direct peer remains connected", () => {
    const localDeviceId = createDeviceId();
    const remoteDeviceId = createDeviceId();

    expect(
      deriveSyncUiState({
        presenceState: "error",
        onlineDeviceIds: [],
        ownsAutomaticPeerSync: true,
        connectedDeviceIds: [remoteDeviceId],
        localDeviceId,
        error: null,
      }),
    ).toEqual({ kind: "connected" });
  });

  it("shows Offline when coordinator presence fails and no direct peer remains connected", () => {
    expect(
      deriveSyncUiState({
        presenceState: "error",
        onlineDeviceIds: [],
        ownsAutomaticPeerSync: true,
        connectedDeviceIds: [],
        localDeviceId: createDeviceId(),
        error: null,
      }),
    ).toEqual({ kind: "offline" });
  });

  it("does not show Connecting in a follower tab with no direct peer", () => {
    const localDeviceId = createDeviceId();
    const remoteDeviceId = createDeviceId();

    expect(
      deriveSyncUiState({
        presenceState: "open",
        onlineDeviceIds: [localDeviceId, remoteDeviceId],
        ownsAutomaticPeerSync: false,
        connectedDeviceIds: [],
        localDeviceId,
        error: null,
      }),
    ).toEqual({ kind: "quiet" });

    expect(
      deriveSyncUiState({
        presenceState: "open",
        onlineDeviceIds: [localDeviceId, remoteDeviceId],
        ownsAutomaticPeerSync: true,
        connectedDeviceIds: [],
        localDeviceId,
        error: null,
      }),
    ).toEqual({ kind: "connecting" });
  });
});
