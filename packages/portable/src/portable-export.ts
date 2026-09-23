import { encodeStoredZip, type ZipEntry } from "./zip.js";

export const FLOE_EXPORT_FORMAT = "floe-project" as const;
export const FLOE_EXPORT_FORMAT_VERSION = 1 as const;

export type PortableDocument = {
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  tags: readonly string[];
  status?: "active" | "deleted";
};

export type PortableProject = {
  name: string;
  documents: readonly PortableDocument[];
};

export type FloeExportManifestV1 = {
  format: typeof FLOE_EXPORT_FORMAT;
  formatVersion: typeof FLOE_EXPORT_FORMAT_VERSION;
  exportedAt: string;
  project: {
    name: string;
  };
  documents: Array<{
    path: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    tags: string[];
  }>;
};

export type PortableProjectExportOptions = {
  exportedAt?: number;
};

export type PortableProjectExport = {
  fileName: string;
  manifest: FloeExportManifestV1;
  manifestJson: string;
  archive: Uint8Array;
};

type PreparedDocument = {
  document: PortableDocument;
  path: string;
};

const textEncoder = new TextEncoder();
const INVALID_COMMON_FILENAME_CHARACTERS = /[\u0000-\u001f<>:"/\\|?*]/g;
const TRAILING_DOTS_OR_SPACES = /[. ]+$/;

export function createPortableProjectExport(
  project: PortableProject,
  options: PortableProjectExportOptions = {},
): PortableProjectExport {
  const exportedAt = options.exportedAt ?? Date.now();
  const preparedDocuments = prepareDocuments(project.documents);
  const manifest = createManifest(project, preparedDocuments, exportedAt);
  const manifestJson = serializePortableProjectManifest(manifest);

  const entries: ZipEntry[] = [
    {
      path: "manifest.json",
      data: textEncoder.encode(manifestJson),
    },
    ...preparedDocuments.map(({ document, path }) => ({
      path,
      data: textEncoder.encode(document.body),
    })),
  ];

  return {
    fileName: `${sanitizeFileStem(project.name)}.floe.zip`,
    manifest,
    manifestJson,
    archive: encodeStoredZip(entries),
  };
}

export function createPortableProjectManifest(
  project: PortableProject,
  exportedAt: number,
): FloeExportManifestV1 {
  return createManifest(project, prepareDocuments(project.documents), exportedAt);
}

export function serializePortableProjectManifest(
  manifest: FloeExportManifestV1,
): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function sanitizeFileStem(value: string): string {
  const sanitized = value
    .trim()
    .replace(INVALID_COMMON_FILENAME_CHARACTERS, "_")
    .replace(TRAILING_DOTS_OR_SPACES, "");

  return sanitized === "" || sanitized === "." || sanitized === ".."
    ? "Untitled"
    : sanitized;
}

function prepareDocuments(
  documents: readonly PortableDocument[],
): PreparedDocument[] {
  const usedFileNames = new Set<string>();
  const prepared: PreparedDocument[] = [];

  for (const document of documents) {
    if (document.status === "deleted") continue;

    const stem = sanitizeFileStem(document.title);
    const fileName = allocateFileName(stem, usedFileNames);
    prepared.push({
      document,
      path: `notes/${fileName}`,
    });
  }

  return prepared;
}

function allocateFileName(stem: string, usedFileNames: Set<string>): string {
  const first = `${stem}.md`;
  if (!usedFileNames.has(first)) {
    usedFileNames.add(first);
    return first;
  }

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem} (${suffix}).md`;
    if (!usedFileNames.has(candidate)) {
      usedFileNames.add(candidate);
      return candidate;
    }
  }
}

function createManifest(
  project: PortableProject,
  documents: readonly PreparedDocument[],
  exportedAt: number,
): FloeExportManifestV1 {
  return {
    format: FLOE_EXPORT_FORMAT,
    formatVersion: FLOE_EXPORT_FORMAT_VERSION,
    exportedAt: formatInstant(exportedAt, "exportedAt"),
    project: {
      name: project.name,
    },
    documents: documents.map(({ document, path }) => ({
      path,
      title: document.title,
      createdAt: formatInstant(document.createdAt, "createdAt"),
      updatedAt: formatInstant(document.updatedAt, "updatedAt"),
      tags: [...document.tags],
    })),
  };
}

function formatInstant(value: number, field: string): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite Unix timestamp in milliseconds`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${field} must be a valid Unix timestamp in milliseconds`);
  }

  return date.toISOString();
}
