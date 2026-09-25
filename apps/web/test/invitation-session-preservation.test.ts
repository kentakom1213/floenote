import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const joinSource = readFileSync(new URL("../src/InvitationJoinPage.tsx", import.meta.url), "utf8");
const storageSource = readFileSync(new URL("../../../packages/storage/src/dexie-project-storage.ts", import.meta.url), "utf8");
const syncProtocolSource = readFileSync(new URL("../../../packages/sync/src/protocol.ts", import.meta.url), "utf8");

describe("invitation session preservation", () => {
  it("starts host invitation through application state", () => {
    expect(appSource).toContain("setInvitationHostActive(true)");
    expect(appSource).not.toContain('window.location.assign("/?transport=invite")');
  });

  it("keeps the host Vault session while invitation resources are cleaned up", () => {
    expect(appSource).toContain("const deviceVaultSessionRef = deviceVaultSessionOwner");
    expect(appSource).toContain("invitationSyncEngineRef.current = null");
    expect(appSource).toContain("exitInvitationHost(true)");
  });

  it("hands off only after persistence flush and bootstrap completion", () => {
    const start = joinSource.indexOf("onInitialRemoteStateReceived: () =>");
    const flush = joinSource.indexOf("await storage.flushPendingWrites()", start);
    const complete = joinSource.indexOf("await storage.completeJoinedProjectBootstrap(", start);
    const handoff = joinSource.indexOf("handoffDeviceVaultSession(", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(flush).toBeGreaterThan(start);
    expect(complete).toBeGreaterThan(flush);
    expect(handoff).toBeGreaterThan(complete);
  });

  it("keeps handoff inside the persistence failure boundary", () => {
    const start = joinSource.indexOf("onInitialRemoteStateReceived: () =>");
    const handoff = joinSource.indexOf("handoffDeviceVaultSession(", start);
    const catchStart = joinSource.indexOf("} catch (syncError: unknown) {", handoff);
    expect(handoff).toBeGreaterThan(start);
    expect(catchStart).toBeGreaterThan(handoff);
    expect(joinSource.slice(catchStart, catchStart + 600)).toContain('setInitialSyncState("error")');
  });

  it("preserves PR #91 full-state and incomplete-bootstrap boundaries", () => {
    expect(syncProtocolSource).toContain('type: "full-state-end"');
    expect(storageSource).toContain('record.bootstrapState !== "bootstrapping"');
    expect(storageSource).toContain('record.bootstrapState === "bootstrapping"');
  });

  it("opens the normal application without a successful-join hard reload", () => {
    expect(joinSource).toContain("handoffDeviceVaultSession(");
    expect(joinSource).not.toContain('window.location.replace("/")');
    expect(appSource).toContain("replaceInvitationUrlWithProject(window.history, projectId)");
  });

  it("does not persist the unlock session in browser storage", () => {
    expect(joinSource).not.toContain("localStorage");
    expect(joinSource).not.toContain("sessionStorage");
    expect(appSource).not.toContain("sessionStorage");
  });
});
