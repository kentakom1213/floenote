import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const joinSource = readFileSync(new URL("../src/InvitationJoinPage.tsx", import.meta.url), "utf8");
const projectSyncSource = readFileSync(
  new URL("../src/useWorkspaceSync.ts", import.meta.url),
  "utf8",
);
const storageSource = readFileSync(new URL("../../../packages/storage/src/dexie-workspace-storage.ts", import.meta.url), "utf8");
const syncProtocolSource = readFileSync(new URL("../../../packages/sync/src/protocol.ts", import.meta.url), "utf8");

describe("invitation session preservation", () => {
  it("starts host invitation only through normal application state", () => {
    expect(appSource).toContain("setInvitationHostActive(true)");
    expect(appSource).not.toContain('window.location.assign("/?transport=invite")');
    expect(appSource).not.toContain(
      'searchParams.get("transport") === "invite"',
    );
    expect(appSource).not.toContain("initialInvitationHostRequested");

    const hostState = appSource.slice(
      appSource.indexOf("const [invitationHostActive"),
      appSource.indexOf("const [invitationHost", appSource.indexOf("const [invitationHostActive") + 1),
    );
    expect(hostState).toContain("useState(false)");
  });

  it("keeps authorized presence alive while invitation hosting pauses peer sync", () => {
    expect(appSource).toContain(
      "useAutomaticReconnect && !invitationHostActive",
    );

    const presenceEffectStart = projectSyncSource.indexOf(
      "useEffect(() => {\n    if (!project || !localDeviceId || !securityState || !vaultSession)",
    );
    const automaticSyncEffectStart = projectSyncSource.indexOf(
      "useEffect(() => {",
      presenceEffectStart + 1,
    );
    const presenceEffect = projectSyncSource.slice(
      presenceEffectStart,
      automaticSyncEffectStart,
    );
    const automaticSyncEffect = projectSyncSource.slice(
      automaticSyncEffectStart,
      projectSyncSource.indexOf("\n  return {", automaticSyncEffectStart),
    );

    expect(presenceEffectStart).toBeGreaterThanOrEqual(0);
    expect(automaticSyncEffectStart).toBeGreaterThan(presenceEffectStart);
    expect(presenceEffect).not.toContain("automaticReconnectEnabled");
    expect(automaticSyncEffect).toContain("automaticReconnectEnabled");
    expect(automaticSyncEffect).toContain(
      "new AutomaticPeerSyncManager",
    );
  });

  it("keeps the host Vault session while invitation resources are cleaned up", () => {
    expect(appSource).toContain("const deviceVaultSessionRef = deviceVaultSessionOwner");
    expect(appSource).toContain("invitationSyncEngineRef.current = null");
    expect(appSource).toContain("exitInvitationHost(true)");
  });

  it("uses the invitation expiry as the host and join pairing deadline", () => {
    expect(appSource).toContain(
      "timeoutMs: Math.max(1, invitation.expiresAt - Date.now())",
    );
    expect(joinSource).toContain(
      "timeoutMs: Math.max(1, claimed.expiresAt - Date.now())",
    );
  });

  it("hands off only after persistence flush and bootstrap completion", () => {
    const start = joinSource.indexOf("onInitialRemoteStateReceived: () =>");
    const flush = joinSource.indexOf("await storage.flushPendingWrites()", start);
    const complete = joinSource.indexOf("await storage.completeJoinedWorkspaceBootstrap(", start);
    const handoff = joinSource.indexOf("handoffDeviceVaultSession(", start);
    const cleanup = joinSource.indexOf("cleanup?.();", handoff);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(flush).toBeGreaterThan(start);
    expect(complete).toBeGreaterThan(flush);
    expect(handoff).toBeGreaterThan(complete);
    expect(cleanup).toBeGreaterThan(handoff);
  });

  it("keeps handoff inside the persistence failure boundary", () => {
    const start = joinSource.indexOf("onInitialRemoteStateReceived: () =>");
    const handoff = joinSource.indexOf("handoffDeviceVaultSession(", start);
    const catchStart = joinSource.indexOf("} catch (syncError: unknown) {", handoff);
    expect(handoff).toBeGreaterThan(start);
    expect(catchStart).toBeGreaterThan(handoff);
    expect(joinSource.slice(catchStart, catchStart + 600)).toContain('setInitialSyncState("error")');
  });

  it("latches initial sync failures before bootstrap completion", () => {
    expect(joinSource).toContain("let initialSyncFailed = false");
    expect(joinSource).toContain("initialSyncFailed = true");
    expect(joinSource).toContain("onInitialSyncError: (syncError) =>");

    const completion = joinSource.indexOf(
      "onInitialRemoteStateReceived: () =>",
    );
    const failureGate = joinSource.indexOf("initialSyncFailed", completion);
    const complete = joinSource.indexOf(
      "await storage.completeJoinedWorkspaceBootstrap(",
      completion,
    );

    expect(completion).toBeGreaterThanOrEqual(0);
    expect(failureGate).toBeGreaterThan(completion);
    expect(complete).toBeGreaterThan(failureGate);
  });

  it("preserves PR #91 full-state and incomplete-bootstrap boundaries", () => {
    expect(syncProtocolSource).toContain('type: "full-state-end"');
    expect(storageSource).toContain('record.bootstrapState !== "bootstrapping"');
    expect(storageSource).toContain('record.bootstrapState === "bootstrapping"');
    expect(storageSource).toContain('bootstrapState: "ready"');
  });

  it("does not treat a queued persistence failure as successful setup", () => {
    expect(storageSource).toContain("#writeFailure");
    expect(storageSource).toContain("if (failure) throw failure");

    const start = joinSource.indexOf("onInitialRemoteStateReceived: () =>");
    const handoff = joinSource.indexOf("handoffDeviceVaultSession(", start);
    const failure = joinSource.indexOf("} catch (syncError: unknown) {", handoff);

    expect(failure).toBeGreaterThan(handoff);
    expect(joinSource.slice(failure, failure + 700)).toContain(
      "Failed to persist initial Workspace sync",
    );
  });

  it("opens the normal application without a successful-join hard reload", () => {
    expect(joinSource).toContain("handoffDeviceVaultSession(");
    expect(joinSource).not.toContain('window.location.replace("/")');
    expect(appSource).toContain("replaceInvitationUrlWithWorkspace(window.history, workspaceId)");
  });

  it("does not persist the unlock session in browser storage", () => {
    expect(joinSource).not.toContain("localStorage");
    expect(joinSource).not.toContain("sessionStorage");
    expect(appSource).not.toContain("sessionStorage");
  });
});
