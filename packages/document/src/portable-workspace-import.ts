import {
  parsePortableProjectFiles,
  requireRecord,
  requireString,
  requireTimestamp,
  type ImportedPortableProject,
} from "./portable-import.js";
import {
  FLOE_WORKSPACE_EXPORT_FORMAT,
  FLOE_WORKSPACE_EXPORT_FORMAT_VERSION,
} from "./portable-workspace-export.js";
import { decodeUtf8 } from "./utf8.js";
import { decodeStoredZip } from "./zip-reader.js";

export type ImportedPortableWorkspace = {
  name: string;
  exportedAt: number;
  projects: ImportedPortableProject[];
};

export type PortableWorkspaceSourceFile = {
  path: string;
  data: Uint8Array;
};

export function parsePortableWorkspaceImport(
  archive: Uint8Array,
): ImportedPortableWorkspace {
  return parsePortableWorkspaceFiles(
    decodeStoredZip(archive).filter((entry) => !entry.isDirectory),
  );
}

export function parsePortableWorkspaceFiles(
  entries: readonly PortableWorkspaceSourceFile[],
): ImportedPortableWorkspace {
  const files = new Map<string, Uint8Array>();
  for (const { path, data } of entries) {
    if (
      path.includes("\\") ||
      /[\u0000-\u001f\u007f]/u.test(path) ||
      /^[A-Za-z]:/.test(path) ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    ) throw new Error(`Invalid Workspace file path: ${path}`);
    if (files.has(path)) throw new Error(`Duplicate Workspace file path: ${path}`);
    files.set(path, data);
  }

  const root = files.get("manifest.json");
  if (!root) throw new Error("Workspace export is missing manifest.json");
  const manifest = requireRecord(JSON.parse(decodeUtf8(root)), "manifest");
  if (manifest.format !== FLOE_WORKSPACE_EXPORT_FORMAT) {
    throw new Error("Unsupported Workspace export format");
  }
  if (manifest.formatVersion !== FLOE_WORKSPACE_EXPORT_FORMAT_VERSION) {
    throw new Error("Unsupported Workspace export formatVersion");
  }
  const exportedAt = requireTimestamp(manifest.exportedAt, "manifest.exportedAt");
  const workspace = requireRecord(manifest.workspace, "manifest.workspace");
  const name = requireString(workspace.name, "manifest.workspace.name");
  if (!name.trim()) throw new Error("Workspace name must not be empty");
  if (!Array.isArray(manifest.projects)) throw new Error("manifest.projects must be an array");

  const paths = new Set<string>();
  const projects = manifest.projects.map((raw, index) => {
    const project = requireRecord(raw, `manifest.projects[${index}]`);
    const path = requireString(project.path, "Project path");
    const parts = path.split("/");
    if (
      parts.length !== 2 || parts[0] !== "projects" || !parts[1] ||
      parts[1] === "." || parts[1] === ".." || path.includes("\\") ||
      /[\u0000-\u001f\u007f]/u.test(path)
    ) throw new Error(`Invalid Project path: ${path}`);
    if (paths.has(path)) throw new Error(`Duplicate Project path: ${path}`);
    paths.add(path);
    const prefix = `${path}/`;
    const projectFiles = new Map<string, Uint8Array>();
    for (const [filePath, data] of files) {
      if (filePath.startsWith(prefix)) {
        projectFiles.set(filePath.slice(prefix.length), data);
      }
    }
    return parsePortableProjectFiles(projectFiles);
  });

  return { name, exportedAt, projects };
}
