import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const navigationSource = readFileSync(
  new URL("../src/browser-navigation.ts", import.meta.url),
  "utf8",
);
const invitationUrlSource = readFileSync(
  new URL("../src/invitation-url.ts", import.meta.url),
  "utf8",
);

describe("browser routing integration invariants", () => {
  it("declares route synchronization hooks before conditional render returns", () => {
    const routeEffect = appSource.indexOf(
      'if (deviceVaultState !== "unlocked" || !projectCatalogReady) return;',
    );
    const firstConditionalReturn = appSource.indexOf("if (loadError) {");

    expect(routeEffect).toBeGreaterThanOrEqual(0);
    expect(firstConditionalReturn).toBeGreaterThan(routeEffect);

    const noteAppTail = appSource.slice(
      firstConditionalReturn,
      appSource.indexOf("\nfunction syncLocalDeviceName"),
    );
    expect(noteAppTail).not.toContain("useEffect(");
    expect(noteAppTail).not.toContain("useState(");
    expect(noteAppTail).not.toContain("useCallback(");
  });

  it("keeps application navigation separate from native popstate", () => {
    expect(navigationSource).toContain('window.history.pushState(null, "", url)');
    expect(navigationSource).toContain('window.history.replaceState(null, "", url)');
    expect(navigationSource).toContain("setRoute(parseLocation())");
    expect(navigationSource).toContain(
      'window.addEventListener("popstate", handlePopState)',
    );
    expect(navigationSource).not.toContain("dispatchEvent");
    expect(navigationSource).not.toContain("new PopStateEvent");
  });

  it("restores a different Project from the requested browser route without pushing history", () => {
    const switchStart = appSource.indexOf(
      "if (!project || requestedProjectId !== project.id)",
    );
    const switchBlock = appSource.slice(switchStart, switchStart + 600);

    expect(switchBlock).toContain("selectProject(requestedProjectId, false)");
    expect(switchBlock).not.toContain("pushRoute(");
    expect(switchBlock).not.toContain("replaceRoute(");
  });

  it("updates persistent settings and Trash surfaces through browser navigation", () => {
    const manageDevices = appSource.slice(
      appSource.indexOf("function openProjectDeviceSettings"),
      appSource.indexOf("const sidebarFooter"),
    );
    expect(manageDevices).toContain(
      "pushRoute(buildProjectSettingsUrl(activeProject.id))",
    );

    const workspaceProps = appSource.slice(
      appSource.indexOf("<NoteWorkspace"),
      appSource.indexOf("/>\n  );", appSource.indexOf("<NoteWorkspace")),
    );
    expect(workspaceProps).toContain(
      "pushRoute(buildTrashUrl(activeProject.id))",
    );
    expect(workspaceProps).toContain(
      "pushRoute(buildTrashDocumentUrl(activeProject.id, documentId))",
    );
    expect(workspaceProps).toContain(
      "replaceRoute(buildDocumentUrl(activeProject.id, documentId))",
    );
    expect(workspaceProps).toContain(
      "replaceRoute(buildTrashUrl(activeProject.id))",
    );
  });

  it("keeps invitation completion owned by the existing handoff boundary", () => {
    expect(appSource).toContain(
      "replaceInvitationUrlWithProject(window.history, projectId)",
    );
    expect(invitationUrlSource).toContain(
      'history.replaceState(null, "", `/p/${projectId}`)',
    );
    expect(invitationUrlSource).not.toContain("pushState");
    expect(invitationUrlSource).not.toContain("sessionStorage");
  });
});
