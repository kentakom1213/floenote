import { describe, expect, it } from "vitest";
import { createPortableWorkspaceExport, parsePortableWorkspaceImport, parsePortableWorkspaceFiles } from "../src/index.js";
import { decodeStoredZip } from "../src/zip-reader.js";

const exportedAt = Date.UTC(2026, 10, 27);
const source = {
  name: "Personal",
  projects: [
    { name: "Research", documents: [{ title: "Paper", body: "# Paper\n", createdAt: 100, updatedAt: 200, tags: ["one"] }] },
    { name: "Research", documents: [] },
  ],
};
const archive = createPortableWorkspaceExport(source, { exportedAt }).archive;
const entries = decodeStoredZip(archive);

describe("portable Workspace import", () => {
  it("round-trips ZIP and extracted files", () => {
    expect(parsePortableWorkspaceImport(archive)).toEqual({ ...source, exportedAt });
    expect(parsePortableWorkspaceFiles(entries)).toEqual({ ...source, exportedAt });
  });
  it("rejects a missing Note or Project manifest", () => {
    expect(() => parsePortableWorkspaceFiles(entries.filter(({ path }) => !path.endsWith(".md")))).toThrow();
    expect(() => parsePortableWorkspaceFiles(entries.filter(({ path }) => path !== "projects/Research (2)/manifest.json"))).toThrow();
  });
  it("rejects duplicate and unsafe paths", () => {
    expect(() => parsePortableWorkspaceFiles([...entries, entries[0]!])).toThrow("Duplicate");
    expect(() => parsePortableWorkspaceFiles([...entries, { path: "../bad", data: new Uint8Array() }])).toThrow("Invalid");
  });
  it("rejects an unsupported format version or duplicate Project references", () => {
    const root = JSON.parse(new TextDecoder().decode(entries[0]!.data));
    const rest = entries.slice(1);
    const parse = (manifest: unknown) => parsePortableWorkspaceFiles([{ path: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest)) }, ...rest]);
    expect(() => parse({ ...root, formatVersion: 2 })).toThrow("formatVersion");
    expect(() => parse({ ...root, projects: [root.projects[0], root.projects[0]] })).toThrow("Duplicate");
  });
});
