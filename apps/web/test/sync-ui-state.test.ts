import { createDeviceId } from "@floe-note/domain";
import { describe, expect, it } from "vitest";

import { deriveSyncUiState } from "../src/sync-ui-state.js";

describe("deriveSyncUiState", () => {
  it("shows Offline first when the browser reports no network", () => {
    const localDeviceId = createDeviceId();
    const remoteDeviceId = createDeviceId();

    expect(
      deriveSyncUiState({
        browserOnline: false,
        presenceState: "open",
        onlineDeviceIds: [localDeviceId, remoteDeviceId],
        ownsAutomaticPeerSync: true,
        connectedDeviceIds: [remoteDeviceId],
        localDeviceId,
        error: "peer failed",
      }),
    ).toEqual({ kind: "offline" });
  });

  it("shows Connected when a direct peer remains connected after presence closes", () => {
    const localDeviceId = createDeviceId();
    const remoteDeviceId = createDeviceId();

    expect(
      deriveSyncUiState({
        browserOnline: true,
        presenceState: "closed",
        onlineDeviceIds: [],
        ownsAutomaticPeerSync: true,
        connectedDeviceIds: [remoteDeviceId],
        localDeviceId,
        error: null,
      }),
    ).toEqual({ kind: "connected" });
  });

  it("keeps Connected when another peer fails but a direct peer remains connected", () => {
    const localDeviceId = createDeviceId();
    const connectedDeviceId = createDeviceId();
    const failedDeviceId = createDeviceId();

    expect(
      deriveSyncUiState({
        browserOnline: true,
        presenceState: "open",
        onlineDeviceIds: [localDeviceId, connectedDeviceId, failedDeviceId],
        ownsAutomaticPeerSync: true,
        connectedDeviceIds: [connectedDeviceId],
        localDeviceId,
        error: "peer failed",
      }),
    ).toEqual({ kind: "connected" });
  });

  it("shows Sync issue for an explicit sync error when no peer remains connected", () => {
    const localDeviceId = createDeviceId();
    const remoteDeviceId = createDeviceId();

    expect(
      deriveSyncUiState({
        browserOnline: true,
        presenceState: "open",
        onlineDeviceIds: [localDeviceId, remoteDeviceId],
        ownsAutomaticPeerSync: true,
        connectedDeviceIds: [],
        localDeviceId,
        error: "peer failed",
      }),
    ).toEqual({ kind: "error", detail: "peer failed" });
  });

  it("shows Sync issue when coordinator presence is unavailable while online", () => {
    expect(
      deriveSyncUiState({
        browserOnline: true,
        presenceState: "closed",
        onlineDeviceIds: [],
        ownsAutomaticPeerSync: true,
        connectedDeviceIds: [],
        localDeviceId: createDeviceId(),
        error: null,
      }),
    ).toEqual({
      kind: "error",
      detail: "Coordinator connection is unavailable",
    });
  });

  it("keeps Connected when coordinator presence fails but a direct peer remains connected", () => {
    const localDeviceId = createDeviceId();
    const remoteDeviceId = createDeviceId();

    expect(
      deriveSyncUiState({
        browserOnline: true,
        presenceState: "error",
        onlineDeviceIds: [],
        ownsAutomaticPeerSync: true,
        connectedDeviceIds: [remoteDeviceId],
        localDeviceId,
        error: null,
      }),
    ).toEqual({ kind: "connected" });
  });

  it("shows Available for a follower and Connecting for an owner awaiting a peer", () => {
    const localDeviceId = createDeviceId();
    const remoteDeviceId = createDeviceId();

    expect(
      deriveSyncUiState({
        browserOnline: true,
        presenceState: "open",
        onlineDeviceIds: [localDeviceId, remoteDeviceId],
        ownsAutomaticPeerSync: false,
        connectedDeviceIds: [],
        localDeviceId,
        error: null,
      }),
    ).toEqual({ kind: "available" });

    expect(
      deriveSyncUiState({
        browserOnline: true,
        presenceState: "open",
        onlineDeviceIds: [localDeviceId, remoteDeviceId],
        ownsAutomaticPeerSync: true,
        connectedDeviceIds: [],
        localDeviceId,
        error: null,
      }),
    ).toEqual({ kind: "connecting" });
  });

  it("shows Connecting while coordinator presence is being established", () => {
    expect(
      deriveSyncUiState({
        browserOnline: true,
        presenceState: "connecting",
        onlineDeviceIds: [],
        ownsAutomaticPeerSync: false,
        connectedDeviceIds: [],
        localDeviceId: createDeviceId(),
        error: null,
      }),
    ).toEqual({ kind: "connecting" });
  });

  it("shows Connected when the owner has a direct peer", () => {
    const localDeviceId = createDeviceId();
    const remoteDeviceId = createDeviceId();
    expect(
      deriveSyncUiState({
        browserOnline: true,
        presenceState: "open",
        onlineDeviceIds: [localDeviceId, remoteDeviceId],
        ownsAutomaticPeerSync: true,
        connectedDeviceIds: [remoteDeviceId],
        localDeviceId,
        error: null,
      }),
    ).toEqual({ kind: "connected" });
  });

  it("does not show Connected for a follower with stale peer status", () => {
    const localDeviceId = createDeviceId();
    const remoteDeviceId = createDeviceId();
    expect(
      deriveSyncUiState({
        browserOnline: true,
        presenceState: "open",
        onlineDeviceIds: [localDeviceId, remoteDeviceId],
        ownsAutomaticPeerSync: false,
        connectedDeviceIds: [remoteDeviceId],
        localDeviceId,
        error: null,
      }),
    ).toEqual({ kind: "available" });
  });

  it("keeps same-device local tabs Local without another logical DeviceId", () => {
    const localDeviceId = createDeviceId();
    expect(
      deriveSyncUiState({
        browserOnline: true,
        presenceState: "open",
        onlineDeviceIds: [localDeviceId],
        ownsAutomaticPeerSync: false,
        connectedDeviceIds: [],
        localDeviceId,
        error: null,
      }),
    ).toEqual({ kind: "quiet" });
  });
});
