import { createProjectId } from "@floe-note/domain";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TAG_COLOR,
  NoteProject,
  TAG_COLORS,
} from "../src/project.js";

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

  it("rejects device display names longer than 80 characters", () => {
    const project = NoteProject.create();

    expect(() =>
      project.setDeviceDisplayName("device", "x".repeat(81)),
    ).toThrow("Device name must be 80 characters or fewer");
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


  it("keeps a newly created tag gray until a color is explicitly set", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Tagged");

    document.addTag("research");

    expect(project.getTagColor("research")).toBe(DEFAULT_TAG_COLOR);
  });

  it("sets and reads a Project tag color without changing note tags", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Tagged");
    document.setTags(["research", "work"]);
    const listener = vi.fn();
    project.subscribe(listener);

    project.setTagColor("research", "blue");

    expect(project.getTagColor("research")).toBe("blue");
    expect(document.tags).toEqual(["research", "work"]);
    expect(listener).toHaveBeenCalledOnce();
  });

  it("uses the CUD-oriented fixed palette roles", () => {
    expect(TAG_COLORS).toEqual([
      "gray",
      "red",
      "orange",
      "yellow",
      "green",
      "sky",
      "blue",
      "brown",
      "purple",
      "pink",
    ]);
  });

  it("rejects tag colors outside the fixed palette", () => {
    const project = NoteProject.create();

    expect(() =>
      project.setTagColor("research", "chartreuse" as never),
    ).toThrow("Invalid tag color");
    expect(project.getTagColor("research")).toBe("gray");
  });

  it("falls back to gray for invalid persisted tag color values", () => {
    const manifest = new LoroDoc();
    manifest.getMap("tagColors").set("research", "chartreuse");
    manifest.commit();

    const project = NoteProject.fromSnapshot(
      createProjectId(),
      manifest.export({ mode: "snapshot" }),
      [],
    );

    expect(project.getTagColor("research")).toBe("gray");
  });

  it("preserves tag colors through a manifest snapshot round trip", () => {
    const project = NoteProject.create();
    project.setTagColor("research", "blue");
    project.setTagColor("work", "orange");

    const restored = NoteProject.fromSnapshot(
      project.id,
      project.exportManifestSnapshot(),
      [],
    );

    expect(restored.getTagColor("research")).toBe("blue");
    expect(restored.getTagColor("work")).toBe("orange");
  });

  it("synchronizes tag colors through manifest updates", () => {
    const source = NoteProject.create();
    const target = NoteProject.create(source.id);

    source.setTagColor("personal", "purple");
    target.importManifestUpdate(source.exportManifestUpdate());

    expect(target.getTagColor("personal")).toBe("purple");
  });

  it("retains unused tag color metadata for later reuse", () => {
    const project = NoteProject.create();
    const document = project.createDocument("Tagged");
    document.addTag("research");
    project.setTagColor("research", "brown");

    document.removeTag("research");

    expect(document.tags).toEqual([]);
    expect(project.getTagColor("research")).toBe("brown");

    document.addTag("research");
    expect(project.getTagColor("research")).toBe("brown");
  });
});
