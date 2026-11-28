import {
  createPortableProjectExport,
  createPortableProjectSnapshot,
  createPortableWorkspaceExport,
  createPortableWorkspaceSnapshot,
  type NoteProject,
} from "@floe-note/document";
import type { ProjectId } from "@floe-note/domain";

export type BrowserDownloadEnvironment = {
  createObjectUrl: (blob: Blob) => string;
  clickDownload: (url: string, fileName: string) => void;
  revokeObjectUrl: (url: string) => void;
};

export function exportProjectToBrowser(
  workspace: NoteProject,
  projectId: ProjectId,
  environment: BrowserDownloadEnvironment = browserDownloadEnvironment,
): string {
  const snapshot = createPortableProjectSnapshot(workspace, projectId);
  const exported = createPortableProjectExport(snapshot);
  return downloadArchive(exported, environment);
}

export function exportWorkspaceToBrowser(
  workspace: NoteProject,
  environment: BrowserDownloadEnvironment = browserDownloadEnvironment,
): string {
  return downloadArchive(
    createPortableWorkspaceExport(createPortableWorkspaceSnapshot(workspace)),
    environment,
  );
}

function downloadArchive(
  exported: { archive: Uint8Array; fileName: string },
  environment: BrowserDownloadEnvironment,
): string {
  const bytes = exported.archive.slice();
  const blob = new Blob([bytes.buffer], { type: "application/zip" });
  const objectUrl = environment.createObjectUrl(blob);

  try {
    environment.clickDownload(objectUrl, exported.fileName);
  } finally {
    environment.revokeObjectUrl(objectUrl);
  }

  return exported.fileName;
}

const browserDownloadEnvironment: BrowserDownloadEnvironment = {
  createObjectUrl(blob) {
    return URL.createObjectURL(blob);
  },
  clickDownload(url, fileName) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  },
  revokeObjectUrl(url) {
    URL.revokeObjectURL(url);
  },
};
