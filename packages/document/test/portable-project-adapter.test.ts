import { afterEach, describe, expect, it, vi } from "vitest";

import { createPortableProjectSnapshot, NoteProject } from "../src/index.js";

describe("createPortableProjectSnapshot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies active note bodies and metadata into the portable model", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(100);
    const project = NoteProject.create();
    project.renameProject("Research");
    const document = project.createDocument("Paper notes");

    now.mockReturnValue(200);
    document.setTags(["graph", "research"]);

    now.mockReturnValue(300);
    const binding = document.getEditorBinding();
    binding.getText(binding.doc).insert(0, "# Paper\n\nMarkdown body.");
    binding.doc.commit();
    await Promise.resolve();

    expect(createPortableProjectSnapshot(project)).toEqual({
      name: "Research",
      documents: [
        {
          title: "Paper notes",
          body: "# Paper\n\nMarkdown body.",
          createdAt: 100,
          updatedAt: 300,
          tags: ["graph", "research"],
        },
      ],
    });
  });

  it("omits tombstoned documents", () => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    const project = NoteProject.create();
    const active = project.createDocument("Active");
    const deleted = project.createDocument("Deleted");

    project.deleteDocument(deleted.id);

    const snapshot = createPortableProjectSnapshot(project);

    expect(snapshot.documents.map(({ title }) => title)).toEqual([active.title]);
  });

  it("does not expose Project or Document identity", () => {
    vi.spyOn(Date, "now").mockReturnValue(100);
    const project = NoteProject.create();
    const document = project.createDocument("Portable");

    const snapshot = createPortableProjectSnapshot(project);

    expect(snapshot).not.toHaveProperty("id");
    expect(snapshot).not.toHaveProperty("projectId");
    expect(snapshot.documents[0]).not.toHaveProperty("id");
    expect(JSON.stringify(snapshot)).not.toContain(project.id);
    expect(JSON.stringify(snapshot)).not.toContain(document.id);
  });
});
