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

  it("synchronizes device display names through manifest updates", () => {
    const source = NoteProject.create();
    const target = NoteProject.create(source.id);
    const deviceId = "01a0c808-2026-7146-96f6-df8cca7b3a2d";

    source.setDeviceDisplayName(deviceId, "Kenta's MacBook");
    target.importManifestUpdate(source.exportManifestUpdate());

    expect(target.getDeviceDisplayName(deviceId)).toBe("Kenta's MacBook");
  });

  it("persists device display names in the manifest snapshot", () => {
    const project = NoteProject.create();
    const deviceId = "01a0c808-2026-7146-96f6-df8cca7b3a2d";

    project.setDeviceDisplayName(deviceId, "Laptop");

    const restored = NoteProject.fromSnapshot(
      project.id,
      project.exportManifestSnapshot(),
      [],
    );

    expect(restored.getDeviceDisplayName(deviceId)).toBe("Laptop");
  });

  it("normalizes device display names before storing them", () => {
    const project = NoteProject.create();
    const deviceId = "01a0c808-2026-7146-96f6-df8cca7b3a2d";

    project.setDeviceDisplayName(deviceId, "  Work Laptop  ");

    expect(project.getDeviceDisplayName(deviceId)).toBe("Work Laptop");
  });

  it("rejects an empty device display name", () => {
    const project = NoteProject.create();

    expect(() => project.setDeviceDisplayName("device", "   ")).toThrow(
      "Device name must not be empty",
    );
  });

  it("rejects an empty project name", () => {
    const project = NoteProject.create();

    expect(() => project.renameProject("   ")).toThrow(
      "Project name must not be empty",
    );
  });
});
