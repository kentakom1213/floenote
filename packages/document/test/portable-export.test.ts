import { describe, expect, it } from "vitest";

import {
  createPortableProjectExport,
  createPortableProjectManifest,
  sanitizeFileStem,
} from "../src/index.js";

const EXPORTED_AT = Date.UTC(2026, 8, 23, 2, 30, 0);

describe("portable Project export", () => {
  it("creates the v1 manifest and ordinary Markdown files", () => {
    const result = createPortableProjectExport(
      {
        name: "Personal",
        documents: [
          {
            title: "Welcome",
            body: "# Floe Note\n\nこんにちは 🌊\n",
            createdAt: Date.UTC(2026, 8, 20, 12),
            updatedAt: Date.UTC(2026, 8, 23, 1, 45),
            tags: ["floe", "todo"],
          },
        ],
      },
      { exportedAt: EXPORTED_AT },
    );

    expect(result.fileName).toBe("Personal.floe.zip");
    expect(result.manifest).toEqual({
      format: "floe-project",
      formatVersion: 1,
      exportedAt: "2026-09-23T02:30:00.000Z",
      project: { name: "Personal" },
      documents: [
        {
          path: "notes/Welcome.md",
          title: "Welcome",
          createdAt: "2026-09-20T12:00:00.000Z",
          updatedAt: "2026-09-23T01:45:00.000Z",
          tags: ["floe", "todo"],
        },
      ],
    });

    expect(result.manifestJson).toBe(
      `${JSON.stringify(result.manifest, null, 2)}\n`,
    );
    expect(decodeStoredZip(result.archive)).toEqual(
      new Map([
        ["manifest.json", new TextEncoder().encode(result.manifestJson)],
        [
          "notes/Welcome.md",
          new TextEncoder().encode("# Floe Note\n\nこんにちは 🌊\n"),
        ],
      ]),
    );
  });

  it("sanitizes human-readable filenames and handles empty titles", () => {
    expect(sanitizeFileStem("  Foo/Bar:*?  ")).toBe("Foo_Bar___");
    expect(sanitizeFileStem("   ")).toBe("Untitled");
    expect(sanitizeFileStem(".")).toBe("Untitled");
    expect(sanitizeFileStem("..")).toBe("Untitled");
    expect(sanitizeFileStem("Title. ")).toBe("Title");
  });

  it("resolves filename collisions deterministically", () => {
    const manifest = createPortableProjectManifest(
      {
        name: "Project",
        documents: [
          document("Ideas"),
          document("Ideas"),
          document("Ideas"),
          document("Ideas/2026"),
          document("Ideas:2026"),
        ],
      },
      EXPORTED_AT,
    );

    expect(manifest.documents.map(({ path }) => path)).toEqual([
      "notes/Ideas.md",
      "notes/Ideas (2).md",
      "notes/Ideas (3).md",
      "notes/Ideas_2026.md",
      "notes/Ideas_2026 (2).md",
    ]);
    expect(manifest.documents.every(({ path }) => !path.includes("\\"))).toBe(
      true,
    );
  });

  it("omits deleted documents", () => {
    const result = createPortableProjectExport(
      {
        name: "Project",
        documents: [
          document("Active"),
          {
            ...document("Deleted"),
            body: "deleted sentinel",
            status: "deleted",
          },
        ],
      },
      { exportedAt: EXPORTED_AT },
    );

    expect(result.manifest.documents.map(({ title }) => title)).toEqual([
      "Active",
    ]);
    expect(new TextDecoder().decode(result.archive)).not.toContain(
      "deleted sentinel",
    );
  });

  it("does not serialize Project identity or security/coordinator state", () => {
    const project = {
      name: "Portable",
      documents: [document("Note")],
      projectId: "PROJECT-ID-SENTINEL",
      deviceId: "DEVICE-ID-SENTINEL",
      securityState: "SECURITY-STATE-SENTINEL",
      projectKey: "PROJECT-KEY-SENTINEL",
      vault: "VAULT-SENTINEL",
      coordinatorState: "COORDINATOR-SENTINEL",
      loroHistory: "LORO-HISTORY-SENTINEL",
      peerState: "PEER-STATE-SENTINEL",
    };

    const result = createPortableProjectExport(project, {
      exportedAt: EXPORTED_AT,
    });
    const serialized = new TextDecoder().decode(result.archive);

    for (const sentinel of [
      project.projectId,
      project.deviceId,
      project.securityState,
      project.projectKey,
      project.vault,
      project.coordinatorState,
      project.loroHistory,
      project.peerState,
    ]) {
      expect(result.manifestJson).not.toContain(sentinel);
      expect(serialized).not.toContain(sentinel);
    }
  });

  it("is byte-for-byte deterministic when exportedAt and input are fixed", () => {
    const project = {
      name: "Deterministic",
      documents: [document("A"), document("B")],
    };

    const first = createPortableProjectExport(project, {
      exportedAt: EXPORTED_AT,
    });
    const second = createPortableProjectExport(project, {
      exportedAt: EXPORTED_AT,
    });

    expect(first.manifestJson).toBe(second.manifestJson);
    expect(first.archive).toEqual(second.archive);
  });

  it("rejects non-finite timestamps", () => {
    expect(() =>
      createPortableProjectManifest(
        {
          name: "Project",
          documents: [{ ...document("Note"), createdAt: Number.NaN }],
        },
        EXPORTED_AT,
      ),
    ).toThrow("createdAt must be a finite Unix timestamp in milliseconds");
  });
});

function document(title: string) {
  return {
    title,
    body: `# ${title}\n`,
    createdAt: Date.UTC(2026, 8, 20, 12),
    updatedAt: Date.UTC(2026, 8, 23, 1, 45),
    tags: [] as string[],
  };
}

function decodeStoredZip(archive: Uint8Array): Map<string, Uint8Array> {
  const decoder = new TextDecoder();
  const files = new Map<string, Uint8Array>();
  let offset = 0;

  while (readUint32(archive, offset) === 0x04034b50) {
    const compressedSize = readUint32(archive, offset + 18);
    const fileNameLength = readUint16(archive, offset + 26);
    const extraLength = readUint16(archive, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const path = decoder.decode(
      archive.subarray(nameStart, nameStart + fileNameLength),
    );

    files.set(path, archive.slice(dataStart, dataStart + compressedSize));
    offset = dataStart + compressedSize;
  }

  return files;
}

function readUint16(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8);
}

function readUint32(data: Uint8Array, offset: number): number {
  return (
    data[offset]! |
    (data[offset + 1]! << 8) |
    (data[offset + 2]! << 16) |
    (data[offset + 3]! << 24)
  ) >>> 0;
}
