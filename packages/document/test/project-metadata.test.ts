import { describe, expect, it } from "vitest";

import { NoteProject } from "../src/project.js";

describe("NoteProject metadata", () => {
  it("uses a friendly default project name", () => {
    const project = NoteProject.create();

    expect(project.name).toBe("Personal");
  });

  it("persists the project name in the manifest snapshot", () => {
    const project = NoteProject.create();
    project.renameProject("Research");

    const restored = NoteProject.fromSnapshot(
      project.id,
      project.exportManifestSnapshot(),
      [],
    );

    expect(restored.name).toBe("Research");
  });

  it("synchronizes project name changes through manifest updates", () => {
    const source = NoteProject.create();
    const target = NoteProject.create(source.id);

    source.renameProject("Floe Note");
    target.importManifestUpdate(source.exportManifestUpdate());

    expect(target.name).toBe("Floe Note");
  });

  it("rejects an empty project name", () => {
    const project = NoteProject.create();

    expect(() => project.renameProject("   ")).toThrow(
      "Project name must not be empty",
    );
  });
});
