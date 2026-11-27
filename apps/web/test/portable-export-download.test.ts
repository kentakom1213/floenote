import { NoteProject } from "@floe-note/document";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  exportProjectToBrowser,
  exportWorkspaceToBrowser,
  type BrowserDownloadEnvironment,
} from "../src/portable-export-download.js";

describe("exportProjectToBrowser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads a .floe.zip for the selected Project", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const project = NoteProject.create();
    const projectId = project.listProjects()[0]!.id;
    project.renameWorkspaceProject(projectId, "Research / notes");
    const document = project.createDocument("Welcome", projectId);
    const binding = document.getEditorBinding();
    binding.getText(binding.doc).insert(0, "# Welcome\n");
    binding.doc.commit();
    await Promise.resolve();

    let capturedBlob: Blob | null = null;
    const downloads: Array<{ url: string; fileName: string }> = [];
    const revoked: string[] = [];
    const environment: BrowserDownloadEnvironment = {
      createObjectUrl(blob) {
        capturedBlob = blob;
        return "blob:floe-export";
      },
      clickDownload(url, fileName) {
        downloads.push({ url, fileName });
      },
      revokeObjectUrl(url) {
        revoked.push(url);
      },
    };

    const fileName = exportProjectToBrowser(project, projectId, environment);

    expect(fileName).toBe("Research _ notes.floe.zip");
    expect(downloads).toEqual([
      { url: "blob:floe-export", fileName: "Research _ notes.floe.zip" },
    ]);
    expect(revoked).toEqual(["blob:floe-export"]);
    expect(capturedBlob).not.toBeNull();
    expect(capturedBlob!.type).toBe("application/zip");
    expect(capturedBlob!.size).toBeGreaterThan(0);
  });

  it("revokes the object URL even if the browser download action fails", () => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    const project = NoteProject.create();
    project.createDocument("Note");
    const revoked: string[] = [];
    const environment: BrowserDownloadEnvironment = {
      createObjectUrl() {
        return "blob:floe-export";
      },
      clickDownload() {
        throw new Error("download failed");
      },
      revokeObjectUrl(url) {
        revoked.push(url);
      },
    };

    expect(() => exportProjectToBrowser(project, project.listProjects()[0]!.id, environment)).toThrow(
      "download failed",
    );
    expect(revoked).toEqual(["blob:floe-export"]);
  });
});

describe("exportWorkspaceToBrowser", () => {
  it("downloads a Workspace archive using the fixed sanitized filename", () => {
    const workspace = NoteProject.create();
    workspace.renameProject("Personal / notes");
    workspace.createDocument("One");
    workspace.createProject("Research");
    const environment: BrowserDownloadEnvironment = {
      createObjectUrl: vi.fn(() => "blob:workspace"),
      clickDownload: vi.fn(),
      revokeObjectUrl: vi.fn(),
    };

    expect(exportWorkspaceToBrowser(workspace, environment)).toBe("Personal _ notes.floe-workspace.zip");
    expect(environment.clickDownload).toHaveBeenCalledWith("blob:workspace", "Personal _ notes.floe-workspace.zip");
    expect(environment.revokeObjectUrl).toHaveBeenCalledWith("blob:workspace");
  });

  it("does not initiate a download when an active Note is missing", () => {
    const source = NoteProject.create();
    source.createDocument("Missing");
    const workspace = NoteProject.fromSnapshot(source.id, source.exportManifestSnapshot(), []);
    const environment: BrowserDownloadEnvironment = {
      createObjectUrl: vi.fn(() => "blob:workspace"),
      clickDownload: vi.fn(),
      revokeObjectUrl: vi.fn(),
    };
    expect(() => exportWorkspaceToBrowser(workspace, environment)).toThrow("not available locally");
    expect(environment.createObjectUrl).not.toHaveBeenCalled();
  });
});
