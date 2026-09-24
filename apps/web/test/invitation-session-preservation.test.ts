import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);
const joinSource = readFileSync(
  new URL("../src/InvitationJoinPage.tsx", import.meta.url),
  "utf8",
);

describe("invitation session-preserving navigation", () => {
  it("starts host invitation through application state instead of a hard navigation", () => {
    expect(appSource).toContain("setInvitationHostActive(true)");
    expect(appSource).not.toContain(
      'window.location.assign("/?transport=invite")',
    );
  });

  it("does not hard-navigate after host completion or cancellation", () => {
    const delivery = appSource.slice(
      appSource.indexOf("async function deliverProjectKey"),
      appSource.indexOf("function createDocument"),
    );
    const invitationView = appSource.slice(
      appSource.indexOf("const invitationContent"),
      appSource.indexOf("const mainContent"),
    );

    expect(delivery).toContain("exitInvitationHost()");
    expect(delivery).not.toContain("window.location");
    expect(invitationView).not.toContain("window.location");
  });

  it("hands the join session to the application instead of replacing the page", () => {
    expect(joinSource).toContain(
      "handoffDeviceVaultSession(vaultSessionRef, onSessionHandoff)",
    );
    expect(joinSource).not.toContain('window.location.replace("/")');
  });

  it("does not add browser storage persistence for the unlock session", () => {
    expect(joinSource).not.toContain("localStorage");
    expect(joinSource).not.toContain("sessionStorage");
    expect(appSource).not.toContain("sessionStorage");
  });
});
