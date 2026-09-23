import {
  FLOE_EXPORT_FORMAT,
  FLOE_EXPORT_FORMAT_VERSION,
} from "./portable-export.js";
import { decodeUtf8 } from "./utf8.js";
import { decodeStoredZip } from "./zip-reader.js";

export type ImportedPortableDocument = {
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
};

export type ImportedPortableProject = {
  name: string;
  documents: ImportedPortableDocument[];
};

type ManifestDocumentV1 = {
  path: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  tags: string[];
};

export function parsePortableProjectImport(
  archive: Uint8Array,
): ImportedPortableProject {
  const entries = decodeStoredZip(archive);
  const files = new Map<string, Uint8Array>();

  for (const entry of entries) {
    if (!entry.isDirectory) {
      files.set(entry.path, entry.data);
    }
  }

  const manifestBytes = files.get("manifest.json");
  if (!manifestBytes) {
    throw new Error("Floe export is missing manifest.json");
  }

  const manifest = parseManifest(manifestBytes);
  const documents = manifest.documents.map((document) => {
    const bodyBytes = files.get(document.path);
    if (!bodyBytes) {
      throw new Error(`Floe export is missing Markdown file: ${document.path}`);
    }

    let body: string;
    try {
      body = decodeUtf8(bodyBytes);
    } catch {
      throw new Error(`Markdown file is not valid UTF-8: ${document.path}`);
    }

    return {
      title: document.title,
      body,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      tags: [...document.tags],
    };
  });

  return {
    name: manifest.name,
    documents,
  };
}

function parseManifest(data: Uint8Array): {
  name: string;
  documents: ManifestDocumentV1[];
} {
  let text: string;
  try {
    text = decodeUtf8(data);
  } catch {
    throw new Error("manifest.json is not valid UTF-8");
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("manifest.json is not valid JSON");
  }

  const manifest = requireRecord(value, "manifest");
  if (manifest.format !== FLOE_EXPORT_FORMAT) {
    throw new Error(`Unsupported Floe export format: ${String(manifest.format)}`);
  }

  if (
    typeof manifest.formatVersion !== "number" ||
    !Number.isInteger(manifest.formatVersion)
  ) {
    throw new Error("manifest.formatVersion must be an integer");
  }
  if (manifest.formatVersion !== FLOE_EXPORT_FORMAT_VERSION) {
    throw new Error(
      `Unsupported Floe export formatVersion: ${manifest.formatVersion}`,
    );
  }

  requireTimestamp(manifest.exportedAt, "manifest.exportedAt");

  const project = requireRecord(manifest.project, "manifest.project");
  const name = requireString(project.name, "manifest.project.name");
  if (name.trim().length === 0) {
    throw new Error("manifest.project.name must not be empty");
  }

  if (!Array.isArray(manifest.documents)) {
    throw new Error("manifest.documents must be an array");
  }

  const usedPaths = new Set<string>();
  const documents = manifest.documents.map((rawDocument, index) => {
    const label = `manifest.documents[${index}]`;
    const document = requireRecord(rawDocument, label);
    const path = requireString(document.path, `${label}.path`);
    validateDocumentPath(path);

    if (usedPaths.has(path)) {
      throw new Error(`Duplicate manifest document path: ${path}`);
    }
    usedPaths.add(path);

    const title = requireString(document.title, `${label}.title`);
    const createdAt = requireTimestamp(
      document.createdAt,
      `${label}.createdAt`,
    );
    const updatedAt = requireTimestamp(
      document.updatedAt,
      `${label}.updatedAt`,
    );
    const tags = requireStringArray(document.tags, `${label}.tags`);

    return {
      path,
      title,
      createdAt,
      updatedAt,
      tags,
    };
  });

  return { name, documents };
}

function validateDocumentPath(path: string): void {
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new Error(`Invalid manifest document path: ${path}`);
  }

  const parts = path.split("/");
  if (
    parts.length !== 2 ||
    parts[0] !== "notes" ||
    parts[1] === "" ||
    parts[1] === "." ||
    parts[1] === ".." ||
    !parts[1]!.endsWith(".md")
  ) {
    throw new Error(`Invalid manifest document path: ${path}`);
  }
}

function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return [...value];
}

function requireTimestamp(value: unknown, label: string): number {
  if (typeof value !== "string") {
    throw new Error(`${label} must be an RFC 3339 UTC timestamp`);
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(
      value,
    );
  if (!match) {
    throw new Error(`${label} must be an RFC 3339 UTC timestamp`);
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${label} must be a valid timestamp`);
  }

  const date = new Date(timestamp);
  const millisecond = Number((match[7] ?? "").padEnd(3, "0") || "0");
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() + 1 !== Number(match[2]) ||
    date.getUTCDate() !== Number(match[3]) ||
    date.getUTCHours() !== Number(match[4]) ||
    date.getUTCMinutes() !== Number(match[5]) ||
    date.getUTCSeconds() !== Number(match[6]) ||
    date.getUTCMilliseconds() !== millisecond
  ) {
    throw new Error(`${label} must be a valid timestamp`);
  }

  return timestamp;
}
