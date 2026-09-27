import { describe, expect, it } from "vitest";

import {
  createPortableProjectExport,
  parsePortableProjectImport,
} from "../src/index.js";
import { encodeUtf8 } from "../src/utf8.js";
import { encodeStoredZip } from "../src/zip.js";

const EXPORTED_AT = "2026-09-23T02:30:00.000Z";
const CREATED_AT = "2026-09-20T12:00:00.000Z";
const UPDATED_AT = "2026-09-23T01:45:00.000Z";

describe("portable Floe import", () => {
  it("round-trips the current portable export format", () => {
    const exported = createPortableProjectExport(
      {
        name: "Personal",
        documents: [
          {
            title: "Welcome",
            body: "---\ntitle: not metadata\n---\n\n# こんにちは 🌊\n",
            createdAt: Date.parse(CREATED_AT),
            updatedAt: Date.parse(UPDATED_AT),
            tags: ["floe", "todo"],
          },
          {
            title: "Welcome",
            body: "Duplicate titles are allowed.",
            createdAt: Date.parse(CREATED_AT),
            updatedAt: Date.parse(UPDATED_AT),
            tags: [],
          },
        ],
      },
      { exportedAt: Date.parse(EXPORTED_AT) },
    );

    expect(parsePortableProjectImport(exported.archive)).toEqual({
      name: "Personal",
      documents: [
        {
          title: "Welcome",
          body: "---\ntitle: not metadata\n---\n\n# こんにちは 🌊\n",
          createdAt: Date.parse(CREATED_AT),
          updatedAt: Date.parse(UPDATED_AT),
          tags: ["floe", "todo"],
        },
        {
          title: "Welcome",
          body: "Duplicate titles are allowed.",
          createdAt: Date.parse(CREATED_AT),
          updatedAt: Date.parse(UPDATED_AT),
          tags: [],
        },
      ],
    });
  });

  it("ignores unknown fields and does not adopt source identity", () => {
    const archive = archiveFrom(
      {
        ...manifest([
          documentEntry("notes/Note.md", "Note"),
        ]),
        projectId: "SOURCE-PROJECT-ID",
        workspaceId: "SOURCE-WORKSPACE-ID",
        workspaceKey: "SOURCE-WORKSPACE-KEY",
        keyEpoch: 7,
        deviceId: "SOURCE-DEVICE-ID",
        securityState: { sequence: 99 },
        project: {
          name: "Imported",
          originalProjectId: "SOURCE-PROJECT-ID",
        },
        documents: [
          {
            ...documentEntry("notes/Note.md", "Note"),
            documentId: "SOURCE-DOCUMENT-ID",
            loroHistory: "SOURCE-LORO-HISTORY",
          },
        ],
      },
      {
        "notes/Note.md": "body",
      },
    );

    const imported = parsePortableProjectImport(archive);

    expect(imported).toEqual({
      name: "Imported",
      documents: [
        {
          title: "Note",
          body: "body",
          createdAt: Date.parse(CREATED_AT),
          updatedAt: Date.parse(UPDATED_AT),
          tags: [],
        },
      ],
    });
    expect(imported).not.toHaveProperty("projectId");
    expect(imported).not.toHaveProperty("workspaceId");
    expect(imported.documents[0]).not.toHaveProperty("documentId");
    expect(JSON.stringify(imported)).not.toContain("SOURCE-");
  });

  it("accepts RFC 3339 UTC timestamps without fractional seconds", () => {
    const archive = archiveFrom(
      manifest([
        {
          ...documentEntry("notes/Note.md", "Note"),
          createdAt: "2026-09-20T12:00:00Z",
          updatedAt: "2026-09-23T01:45:00.1Z",
        },
      ]),
      { "notes/Note.md": "body" },
    );

    expect(parsePortableProjectImport(archive).documents[0]).toMatchObject({
      createdAt: Date.parse("2026-09-20T12:00:00Z"),
      updatedAt: Date.parse("2026-09-23T01:45:00.1Z"),
    });
  });

  it("rejects a missing manifest", () => {
    const archive = encodeStoredZip([
      { path: "notes/Note.md", data: encodeUtf8("body") },
    ]);

    expect(() => parsePortableProjectImport(archive)).toThrow(
      "Floe export is missing manifest.json",
    );
  });

  it("rejects malformed manifest JSON", () => {
    const archive = encodeStoredZip([
      { path: "manifest.json", data: encodeUtf8("{ nope") },
    ]);

    expect(() => parsePortableProjectImport(archive)).toThrow(
      "manifest.json is not valid JSON",
    );
  });

  it("rejects an invalid manifest format", () => {
    const archive = archiveFrom(
      { ...manifest([]), format: "other-format" },
      {},
    );

    expect(() => parsePortableProjectImport(archive)).toThrow(
      "Unsupported Floe export format: other-format",
    );
  });

  it("rejects an unsupported format version", () => {
    const archive = archiveFrom(
      { ...manifest([]), formatVersion: 2 },
      {},
    );

    expect(() => parsePortableProjectImport(archive)).toThrow(
      "Unsupported Floe export formatVersion: 2",
    );
  });

  it("rejects invalid timestamps before returning imported data", () => {
    const archive = archiveFrom(
      manifest([
        {
          ...documentEntry("notes/Note.md", "Note"),
          updatedAt: "2026-02-30T01:45:00Z",
        },
      ]),
      { "notes/Note.md": "body" },
    );

    expect(() => parsePortableProjectImport(archive)).toThrow(
      "manifest.documents[0].updatedAt must be a valid timestamp",
    );
  });

  it("rejects invalid tag metadata", () => {
    const archive = archiveFrom(
      manifest([
        {
          ...documentEntry("notes/Note.md", "Note"),
          tags: ["valid", 42],
        },
      ]),
      { "notes/Note.md": "body" },
    );

    expect(() => parsePortableProjectImport(archive)).toThrow(
      "manifest.documents[0].tags must be an array of strings",
    );
  });

  it("rejects duplicate manifest document paths", () => {
    const archive = archiveFrom(
      manifest([
        documentEntry("notes/Same.md", "First"),
        documentEntry("notes/Same.md", "Second"),
      ]),
      { "notes/Same.md": "body" },
    );

    expect(() => parsePortableProjectImport(archive)).toThrow(
      "Duplicate manifest document path: notes/Same.md",
    );
  });

  it("rejects a manifest path outside notes/*.md", () => {
    const archive = archiveFrom(
      manifest([
        documentEntry("../evil.md", "Evil"),
      ]),
      {},
    );

    expect(() => parsePortableProjectImport(archive)).toThrow(
      "Invalid manifest document path: ../evil.md",
    );
  });

  it("rejects nested note paths because v1 has no folder semantics", () => {
    const archive = archiveFrom(
      manifest([
        documentEntry("notes/folder/Note.md", "Note"),
      ]),
      {},
    );

    expect(() => parsePortableProjectImport(archive)).toThrow(
      "Invalid manifest document path: notes/folder/Note.md",
    );
  });

  it("detects a missing Markdown file", () => {
    const archive = archiveFrom(
      manifest([
        documentEntry("notes/Missing.md", "Missing"),
      ]),
      {},
    );

    expect(() => parsePortableProjectImport(archive)).toThrow(
      "Floe export is missing Markdown file: notes/Missing.md",
    );
  });

  it("rejects invalid UTF-8 in Markdown bodies", () => {
    const archive = encodeStoredZip([
      {
        path: "manifest.json",
        data: encodeUtf8(
          JSON.stringify(
            manifest([documentEntry("notes/Note.md", "Note")]),
          ),
        ),
      },
      {
        path: "notes/Note.md",
        data: Uint8Array.of(0xc3, 0x28),
      },
    ]);

    expect(() => parsePortableProjectImport(archive)).toThrow(
      "Markdown file is not valid UTF-8: notes/Note.md",
    );
  });

  it("rejects duplicate ZIP entry paths", () => {
    const manifestBytes = encodeUtf8(JSON.stringify(manifest([])));
    const archive = encodeStoredZip([
      { path: "manifest.json", data: manifestBytes },
      { path: "manifest.json", data: manifestBytes },
    ]);

    expect(() => parsePortableProjectImport(archive)).toThrow(
      "Duplicate ZIP entry path: manifest.json",
    );
  });

  it("rejects zip-slip paths anywhere in the archive", () => {
    const archive = encodeStoredZip([
      { path: "manifest.json", data: encodeUtf8(JSON.stringify(manifest([]))) },
      { path: "notes/A.md", data: encodeUtf8("body") },
    ]);
    const unsafe = replaceAllAscii(archive, "notes/A.md", "../evil.md");

    expect(() => parsePortableProjectImport(unsafe)).toThrow(
      "Invalid ZIP entry path: ../evil.md",
    );
  });

  it("rejects absolute archive paths", () => {
    const archive = encodeStoredZip([
      { path: "manifest.json", data: encodeUtf8(JSON.stringify(manifest([]))) },
      { path: "notes/A.md", data: encodeUtf8("body") },
    ]);
    const unsafe = replaceAllAscii(archive, "notes/A.md", "/evil/A.md");

    expect(() => parsePortableProjectImport(unsafe)).toThrow(
      "Invalid ZIP entry path: /evil/A.md",
    );
  });

  it("rejects backslash archive paths", () => {
    const archive = encodeStoredZip([
      { path: "manifest.json", data: encodeUtf8(JSON.stringify(manifest([]))) },
      { path: "notes/A.md", data: encodeUtf8("body") },
    ]);
    const unsafe = replaceAllAscii(archive, "notes/A.md", "notes\\A.md");

    expect(() => parsePortableProjectImport(unsafe)).toThrow(
      "Invalid ZIP entry path: notes\\A.md",
    );
  });

  it("rejects compression methods not emitted by the v1 exporter", () => {
    const archive = archiveFrom(manifest([]), {});
    const patched = archive.slice();
    const centralOffset = findSignature(patched, 0x02014b50);
    writeUint16(patched, centralOffset + 10, 8);

    expect(() => parsePortableProjectImport(patched)).toThrow(
      "Unsupported ZIP compression method: 8",
    );
  });

  it("rejects corrupted entry contents using CRC validation", () => {
    const archive = archiveFrom(
      manifest([documentEntry("notes/Note.md", "Note")]),
      { "notes/Note.md": "# Note\n" },
    );
    const corrupted = archive.slice();
    const bodyOffset = findBytes(corrupted, encodeUtf8("# Note\n"));
    corrupted[bodyOffset] ^= 0x01;

    expect(() => parsePortableProjectImport(corrupted)).toThrow(
      "ZIP entry CRC mismatch: notes/Note.md",
    );
  });

  it("rejects truncated ZIP archives", () => {
    const archive = archiveFrom(manifest([]), {});

    expect(() =>
      parsePortableProjectImport(archive.slice(0, archive.length - 1)),
    ).toThrow("Invalid ZIP archive: end record is missing");
  });
});

function manifest(documents: unknown[]) {
  return {
    format: "floe-project",
    formatVersion: 1,
    exportedAt: EXPORTED_AT,
    project: { name: "Project" },
    documents,
  };
}

function documentEntry(path: string, title: string) {
  return {
    path,
    title,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    tags: [],
  };
}

function archiveFrom(
  manifestValue: unknown,
  files: Record<string, string>,
): Uint8Array {
  return encodeStoredZip([
    {
      path: "manifest.json",
      data: encodeUtf8(JSON.stringify(manifestValue)),
    },
    ...Object.entries(files).map(([path, body]) => ({
      path,
      data: encodeUtf8(body),
    })),
  ]);
}

function replaceAllAscii(
  input: Uint8Array,
  from: string,
  to: string,
): Uint8Array {
  const fromBytes = encodeUtf8(from);
  const toBytes = encodeUtf8(to);
  if (fromBytes.length !== toBytes.length) {
    throw new Error("Test replacement must preserve byte length");
  }

  const result = input.slice();
  let replacements = 0;
  for (let index = 0; index <= result.length - fromBytes.length; index += 1) {
    if (matchesAt(result, fromBytes, index)) {
      result.set(toBytes, index);
      replacements += 1;
      index += fromBytes.length - 1;
    }
  }
  if (replacements === 0) throw new Error("Test path was not found");
  return result;
}

function findSignature(data: Uint8Array, signature: number): number {
  for (let offset = 0; offset <= data.length - 4; offset += 1) {
    if (
      data[offset] === (signature & 0xff) &&
      data[offset + 1] === ((signature >>> 8) & 0xff) &&
      data[offset + 2] === ((signature >>> 16) & 0xff) &&
      data[offset + 3] === ((signature >>> 24) & 0xff)
    ) {
      return offset;
    }
  }
  throw new Error("ZIP signature not found");
}

function findBytes(data: Uint8Array, target: Uint8Array): number {
  for (let offset = 0; offset <= data.length - target.length; offset += 1) {
    if (matchesAt(data, target, offset)) return offset;
  }
  throw new Error("Byte sequence not found");
}

function matchesAt(
  data: Uint8Array,
  target: Uint8Array,
  offset: number,
): boolean {
  for (let index = 0; index < target.length; index += 1) {
    if (data[offset + index] !== target[index]) return false;
  }
  return true;
}

function writeUint16(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
}
