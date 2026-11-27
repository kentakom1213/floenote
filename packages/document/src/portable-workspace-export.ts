import {
  allocatePortableName,
  createPortableProjectEntries,
  sanitizeFileStem,
  type PortableProject,
} from "./portable-export.js";
import { encodeUtf8 } from "./utf8.js";
import { encodeStoredZip, type ZipEntry } from "./zip.js";

export const FLOE_WORKSPACE_EXPORT_FORMAT = "floe-workspace" as const;
export const FLOE_WORKSPACE_EXPORT_FORMAT_VERSION = 1 as const;

export type PortableWorkspace = {
  name: string;
  projects: readonly PortableProject[];
};

export type FloeWorkspaceExportManifestV1 = {
  format: typeof FLOE_WORKSPACE_EXPORT_FORMAT;
  formatVersion: typeof FLOE_WORKSPACE_EXPORT_FORMAT_VERSION;
  exportedAt: string;
  workspace: { name: string };
  projects: Array<{ path: string }>;
};

export type PortableWorkspaceExport = {
  fileName: string;
  manifest: FloeWorkspaceExportManifestV1;
  manifestJson: string;
  archive: Uint8Array;
};

export function createPortableWorkspaceExport(
  workspace: PortableWorkspace,
  options: { exportedAt?: number } = {},
): PortableWorkspaceExport {
  const exportedAt = options.exportedAt ?? Date.now();
  const manifest: FloeWorkspaceExportManifestV1 = {
    format: FLOE_WORKSPACE_EXPORT_FORMAT,
    formatVersion: FLOE_WORKSPACE_EXPORT_FORMAT_VERSION,
    exportedAt: new Date(exportedAt).toISOString(),
    workspace: { name: workspace.name },
    projects: [],
  };

  const usedDirectories = new Set<string>();
  const entries: ZipEntry[] = [];
  for (const project of workspace.projects) {
    const stem = sanitizeFileStem(project.name);
    const directory = allocatePortableName(stem, "", usedDirectories);
    const path = `projects/${directory}`;
    manifest.projects.push({ path });
    const portable = createPortableProjectEntries(project, exportedAt);
    for (const entry of portable.entries) {
      entries.push({ path: `${path}/${entry.path}`, data: entry.data });
    }
  }

  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  return {
    fileName: `${sanitizeFileStem(workspace.name)}.floe-workspace.zip`,
    manifest,
    manifestJson,
    archive: encodeStoredZip([
      { path: "manifest.json", data: encodeUtf8(manifestJson) },
      ...entries,
    ]),
  };
}
