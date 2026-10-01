/** @vitest-environment jsdom */

import { createDocumentId } from "@floe-note/domain";
import { NoteDocument } from "@floe-note/document";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MarkdownPreview,
  renderMarkdown,
  renderMarkdownWithImagePolicy,
} from "../src/MarkdownPreview.js";
import { classifyMarkdownImageSource } from "../src/markdown-images.js";

afterEach(() => {
  document.body.replaceChildren();
});

describe("Markdown image source policy", () => {
  it("classifies HTTPS, HTTP, relative, and unsafe image sources", () => {
    expect(classifyMarkdownImageSource("https://example.com/a.png")).toBe(
      "external-https",
    );
    expect(classifyMarkdownImageSource("http://example.com/a.png")).toBe(
      "insecure-http",
    );
    expect(classifyMarkdownImageSource("images/a.png")).toBe("relative");
    expect(classifyMarkdownImageSource("./images/a.png")).toBe("relative");
    expect(classifyMarkdownImageSource("../images/a.png")).toBe("relative");
    expect(classifyMarkdownImageSource("/images/a.png")).toBe("relative");

    for (const source of [
      "data:image/png;base64,abc",
      "javascript:alert(1)",
      "blob:https://example.com/id",
      "file:///tmp/a.png",
      "//example.com/a.png",
      "custom:a.png",
      "",
    ]) {
      expect(classifyMarkdownImageSource(source)).toBe("unsafe");
    }
  });

  it("does not materialize an HTTPS image before explicit permission", () => {
    const rendered = renderMarkdownWithImagePolicy(
      "![diagram](https://example.com/diagram.png)",
      { loadExternalImages: false },
    );

    expect(rendered.hasExternalImages).toBe(true);
    expect(rendered.html).toContain("[Image: diagram]");
    expect(rendered.html).not.toContain("<img");
    expect(rendered.html).not.toContain("https://example.com/diagram.png");
  });

  it("materializes only permitted HTTPS images with privacy attributes", () => {
    const rendered = renderMarkdownWithImagePolicy(
      '![diagram](https://example.com/diagram.png "Architecture")',
      { loadExternalImages: true },
    );
    const image = parseHtml(rendered.html).querySelector("img");

    expect(image?.getAttribute("src")).toBe(
      "https://example.com/diagram.png",
    );
    expect(image?.getAttribute("alt")).toBe("diagram");
    expect(image?.getAttribute("title")).toBe("Architecture");
    expect(image?.getAttribute("loading")).toBe("lazy");
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image?.hasAttribute("crossorigin")).toBe(false);
    expect(image?.hasAttribute("srcset")).toBe(false);
  });

  it("keeps HTTP images blocked even after permission", () => {
    const rendered = renderMarkdownWithImagePolicy(
      "![Insecure](http://example.com/image.png)",
      { loadExternalImages: true },
    );

    expect(rendered.html).toContain("Image blocked: insecure source");
    expect(rendered.html).not.toContain("<img");
    expect(rendered.html).not.toContain("http://example.com/image.png");
  });

  it("never resolves relative images against the Floe app origin", () => {
    for (const source of [
      "![Local](image.png)",
      "![Local](./image.png)",
      "![Local](../image.png)",
      "![Local](/image.png)",
    ]) {
      const rendered = renderMarkdownWithImagePolicy(source, {
        loadExternalImages: true,
      });

      expect(rendered.html).toContain("[Image unavailable: Local]");
      expect(rendered.html).not.toContain("<img");
    }
  });

  it("never loads unsupported image schemes", () => {
    for (const url of [
      "data:image/png;base64,abc",
      "javascript:alert(1)",
      "blob:https://example.com/id",
      "file:///tmp/image.png",
      "//example.com/image.png",
      "custom:image.png",
    ]) {
      const rendered = renderMarkdownWithImagePolicy(
        `![bad](${url})`,
        { loadExternalImages: true },
      );

      expect(rendered.html).not.toContain("<img");
    }
  });

  it("applies the same policy to raw HTML images and source elements", () => {
    const source =
      '<picture><source srcset="https://tracker.example/source.png 1x">' +
      '<img src="https://tracker.example/x.png" alt="Tracker" srcset="https://tracker.example/2x.png 2x" onerror="alert(1)">' +
      "</picture>";

    const blocked = renderMarkdownWithImagePolicy(source, {
      loadExternalImages: false,
    });

    expect(blocked.hasExternalImages).toBe(true);
    expect(blocked.html).toContain("[Image: Tracker]");
    expect(blocked.html).not.toContain("<img");
    expect(blocked.html).not.toContain("<source");
    expect(blocked.html).not.toContain("srcset");
    expect(blocked.html).not.toContain("tracker.example");

    const loaded = renderMarkdownWithImagePolicy(source, {
      loadExternalImages: true,
    });
    const image = parseHtml(loaded.html).querySelector("img");

    expect(image?.getAttribute("src")).toBe(
      "https://tracker.example/x.png",
    );
    expect(image?.getAttribute("alt")).toBe("Tracker");
    expect(image?.hasAttribute("srcset")).toBe(false);
    expect(image?.hasAttribute("onerror")).toBe(false);
  });

  it("does not turn image metadata into executable markup", () => {
    const source =
      '<img src="https://example.com/x.png" ' +
      'alt="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;" ' +
      'title="&quot; onerror=&quot;alert(1)">';

    const loaded = renderMarkdownWithImagePolicy(source, {
      loadExternalImages: true,
    });
    const body = parseHtml(loaded.html);
    const image = body.querySelector("img");

    expect(image).not.toBeNull();
    expect(body.querySelector("script")).toBeNull();
    expect(image?.hasAttribute("onerror")).toBe(false);
    expect(image?.getAttribute("alt")).toContain("<script>");
  });
});

describe("Markdown sanitizer", () => {
  it("removes executable and unsupported HTML while keeping allowed content", () => {
    const html = renderMarkdown(
      '<p style="color:red" onclick="alert(1)">Safe</p>' +
        '<script>alert(1)</script>' +
        '<iframe src="https://example.com"></iframe>' +
        "<object>object</object><embed><form>form</form>" +
        '<svg onload="alert(1)"><circle></circle></svg>',
    );
    const body = parseHtml(html);
    const paragraph = body.querySelector("p");

    expect(paragraph?.textContent).toBe("Safe");
    expect(paragraph?.hasAttribute("style")).toBe(false);
    expect(paragraph?.hasAttribute("onclick")).toBe(false);
    expect(body.querySelector("script")).toBeNull();
    expect(body.querySelector("iframe")).toBeNull();
    expect(body.querySelector("object")).toBeNull();
    expect(body.querySelector("embed")).toBeNull();
    expect(body.querySelector("form")).toBeNull();
    expect(body.querySelector("svg")).toBeNull();
  });

  it("preserves supported Markdown formatting", () => {
    const html = renderMarkdown(
      "# Heading\n\n" +
        "**strong** *emphasis* ~~deleted~~\n\n" +
        "- one\n- two\n\n" +
        "> quote\n\n" +
        "```typescript\nconst value = 1;\n```\n\n" +
        "| A | B |\n| --- | --- |\n| 1 | 2 |",
    );
    const body = parseHtml(html);

    expect(body.querySelector("h1")?.textContent).toBe("Heading");
    expect(body.querySelector("strong")?.textContent).toBe("strong");
    expect(body.querySelector("em")?.textContent).toBe("emphasis");
    expect(body.querySelector("del")?.textContent).toBe("deleted");
    expect(body.querySelectorAll("li")).toHaveLength(2);
    expect(body.querySelector("blockquote")?.textContent).toContain("quote");
    expect(body.querySelector("code")?.className).toBe(
      "language-typescript",
    );
    expect(body.querySelector("table")).not.toBeNull();
  });

  it("allows safe semantic HTML without presentation attributes", () => {
    const html = renderMarkdown(
      '<details open class="custom" style="color:red" id="section">' +
        '<summary class="custom">More</summary>' +
        '<div class="custom" style="color:blue">' +
        '<kbd class="custom">Ctrl</kbd> <mark>marked</mark> ' +
        'H<sub>2</sub>O x<sup>2</sup> ' +
        '<ruby>漢<rt>かん</rt><rp>(</rp><rt>kan</rt><rp>)</rp></ruby> ' +
        '<span class="custom" style="color:green">inline</span>' +
        "</div></details>",
    );
    const body = parseHtml(html);
    const details = body.querySelector("details");
    const summary = body.querySelector("summary");
    const div = body.querySelector("div");
    const span = body.querySelector("span");

    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(true);
    expect(details?.hasAttribute("class")).toBe(false);
    expect(details?.hasAttribute("style")).toBe(false);
    expect(details?.hasAttribute("id")).toBe(false);
    expect(summary).not.toBeNull();
    expect(summary?.hasAttribute("class")).toBe(false);
    expect(div).not.toBeNull();
    expect(div?.hasAttribute("class")).toBe(false);
    expect(div?.hasAttribute("style")).toBe(false);
    expect(span).not.toBeNull();
    expect(span?.hasAttribute("class")).toBe(false);
    expect(span?.hasAttribute("style")).toBe(false);
    expect(body.querySelector("kbd")?.textContent).toBe("Ctrl");
    expect(body.querySelector("mark")?.textContent).toBe("marked");
    expect(body.querySelector("sub")?.textContent).toBe("2");
    expect(body.querySelector("sup")?.textContent).toBe("2");
    expect(body.querySelector("ruby")).not.toBeNull();
    expect(body.querySelector("rt")?.textContent).toBe("かん");
    expect(body.querySelector("rp")).not.toBeNull();
  });

  it("preserves safe links and removes unsafe href schemes", () => {
    const html = renderMarkdown(
      [
        "[anchor](#part)",
        "[root](/notes)",
        "[dot](./note)",
        "[parent](../note)",
        "[http](http://example.com)",
        "[https](https://example.com)",
        "[mail](mailto:test@example.com)",
        "[bad](javascript:alert(1))",
      ].join("\n\n"),
    );
    const links = Array.from(parseHtml(html).querySelectorAll("a"));

    for (const link of links.slice(0, 7)) {
      expect(link.getAttribute("href")).not.toBeNull();
      expect(link.getAttribute("rel")).toBe("noreferrer noopener");
    }
    expect(links[7]?.hasAttribute("href")).toBe(false);
  });

  it("keeps only fenced-code language classes", () => {
    const markdown = renderMarkdown("```ts\nconst x = 1;\n```");
    expect(parseHtml(markdown).querySelector("code")?.className).toBe(
      "language-ts",
    );

    const raw = renderMarkdown(
      '<code class="language-ts extra" data-test="x">value</code>',
    );
    const code = parseHtml(raw).querySelector("code");
    expect(code?.hasAttribute("class")).toBe(false);
    expect(code?.hasAttribute("data-test")).toBe(false);
  });

  it("hydrates inline and display KaTeX after sanitizing Markdown HTML", () => {
    const html = renderMarkdown(
      "Inline $x^2$\n\n$$\n\\frac{a}{b}\n$$",
    );
    const body = parseHtml(html);

    expect(body.querySelector(".markdown-math .katex")).not.toBeNull();
    expect(
      body.querySelector(".markdown-math-block .katex-display"),
    ).not.toBeNull();
  });

  it("annotates top-level preview blocks with source line ranges", () => {
    const body = parseHtml(
      renderMarkdown("# First\n\nParagraph\n\n- one\n- two\n\n## Second"),
    );

    expect(body.querySelector("h1")?.dataset.floeSourceStart).toBe("1");
    expect(body.querySelector("p")?.dataset.floeSourceStart).toBe("3");
    expect(body.querySelector("ul")?.dataset.floeSourceStart).toBe("5");
    expect(body.querySelector("h2")?.dataset.floeSourceStart).toBe("8");
  });

  it("keeps source anchors aligned after multiline display math", () => {
    const source = [
      "# First",
      "",
      "Paragraph",
      "",
      "$$",
      "a + b",
      "= c",
      "$$",
      "",
      "## Second",
    ].join("\n");
    const body = parseHtml(renderMarkdown(source));

    expect(body.querySelector("h1")?.dataset.floeSourceStart).toBe("1");
    expect(
      body.querySelector(".markdown-math-block")?.closest("p")?.dataset
        .floeSourceStart,
    ).toBe("5");
    expect(body.querySelector("h2")?.dataset.floeSourceStart).toBe("10");
  });
});

describe("GFM task-list preview", () => {
  it("hydrates unchecked and checked GFM task markers after sanitization", () => {
    const unchecked = renderMarkdownWithImagePolicy("- [ ] task", {
      loadExternalImages: false,
      interactiveTasks: true,
    });
    const checkedLower = renderMarkdownWithImagePolicy("- [x] task", {
      loadExternalImages: false,
      interactiveTasks: true,
    });
    const checkedUpper = renderMarkdownWithImagePolicy("- [X] task", {
      loadExternalImages: false,
      interactiveTasks: true,
    });

    const uncheckedBox = parseHtml(unchecked.html).querySelector(
      ".markdown-task-checkbox",
    ) as HTMLInputElement | null;
    const checkedLowerBox = parseHtml(checkedLower.html).querySelector(
      ".markdown-task-checkbox",
    ) as HTMLInputElement | null;
    const checkedUpperBox = parseHtml(checkedUpper.html).querySelector(
      ".markdown-task-checkbox",
    ) as HTMLInputElement | null;

    expect(uncheckedBox?.checked).toBe(false);
    expect(uncheckedBox?.disabled).toBe(false);
    expect(checkedLowerBox?.checked).toBe(true);
    expect(checkedUpperBox?.checked).toBe(true);
    expect(unchecked.tasks).toHaveLength(1);
    expect(unchecked.tasks[0]?.sourceMarker).toBe("[ ]");
    expect(checkedUpper.tasks[0]?.sourceMarker).toBe("[X]");
  });

  it("keeps ordinary lists ordinary and fenced task-looking text as code", () => {
    const ordinary = renderMarkdown("- ordinary item");
    const fenced = renderMarkdown(
      ["```md", "- [ ] not a task here", "```"].join("\n"),
    );

    expect(parseHtml(ordinary).querySelector("input")).toBeNull();
    expect(parseHtml(fenced).querySelector("input")).toBeNull();
    expect(parseHtml(fenced).querySelector("code")?.textContent).toContain(
      "- [ ] not a task here",
    );
  });

  it("maps multiple, nested, Japanese, and emoji-prefixed tasks independently", () => {
    const source = [
      "😀 introduction",
      "- [ ] 日本語 task",
      "  * [x] nested task",
      "+ [X] third task",
    ].join("\n");
    const rendered = renderMarkdownWithImagePolicy(source, {
      loadExternalImages: false,
      interactiveTasks: true,
    });
    const body = parseHtml(rendered.html);
    const boxes = Array.from(
      body.querySelectorAll<HTMLInputElement>(".markdown-task-checkbox"),
    );

    expect(boxes).toHaveLength(3);
    expect(boxes.map((box) => box.checked)).toEqual([false, true, true]);
    expect(rendered.tasks.map((task) => task.label)).toEqual([
      "日本語 task",
      "nested task",
      "third task",
    ]);
    expect(rendered.tasks[0]?.sourceStart).toBe(source.indexOf("[ ]"));
    expect(body.querySelectorAll(".markdown-task-item")).toHaveLength(3);
  });

  it("does not revive raw input HTML as a trusted task checkbox", () => {
    const rendered = renderMarkdownWithImagePolicy(
      '<input type="checkbox" data-floe-task-id="0" checked> raw',
      {
        loadExternalImages: false,
        interactiveTasks: true,
      },
    );
    const body = parseHtml(rendered.html);

    expect(body.querySelector("input")).toBeNull();
    expect(rendered.tasks).toHaveLength(0);
  });

  it("toggles source Markdown from an interactive Preview", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const note = noteWithBody(
      "Tasks",
      ["- [ ] Buy milk", "- [x] Write paper"].join("\n"),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(MarkdownPreview, {
            document: note,
            interactive: true,
          }),
        );
      });

      const boxes = container.querySelectorAll<HTMLInputElement>(
        ".markdown-task-checkbox",
      );
      expect(boxes).toHaveLength(2);

      await act(async () => {
        boxes[0]?.click();
        await Promise.resolve();
      });

      expect(note.bodyText).toBe(
        ["- [x] Buy milk", "- [x] Write paper"].join("\n"),
      );
      expect(
        container.querySelectorAll<HTMLInputElement>(
          ".markdown-task-checkbox",
        )[0]?.checked,
      ).toBe(true);
    } finally {
      await act(async () => {
        root.unmount();
      });
      vi.unstubAllGlobals();
    }
  });

  it("renders read-only task checkboxes without mutating the note", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const note = noteWithBody("Trash task", "- [ ] Cannot edit here");
    const updatedAt = note.updatedAt;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          createElement(MarkdownPreview, {
            document: note,
            interactive: false,
          }),
        );
      });

      const checkbox = container.querySelector<HTMLInputElement>(
        ".markdown-task-checkbox",
      );
      expect(checkbox?.disabled).toBe(true);
      expect(checkbox?.getAttribute("aria-label")).toBe("Cannot edit here");

      await act(async () => {
        checkbox?.click();
        await Promise.resolve();
      });

      expect(note.bodyText).toBe("- [ ] Cannot edit here");
      expect(note.updatedAt).toBe(updatedAt);
    } finally {
      await act(async () => {
        root.unmount();
      });
      vi.unstubAllGlobals();
    }
  });
});
describe("MarkdownPreview external-image permission", () => {
  it("is note-scoped, explicit, and resets when switching notes", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const first = noteWithBody(
      "First",
      "![External](https://example.com/first.png)",
    );
    const second = noteWithBody(
      "Second",
      "![External](https://example.com/second.png)",
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(createElement(MarkdownPreview, { document: first, interactive: true }));
      });

      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toContain("External images are blocked");

      const button = container.querySelector("button");
      expect(button?.textContent).toBe("Load external images");

      await act(async () => {
        button?.click();
      });

      expect(container.querySelector("img")?.getAttribute("src")).toBe(
        "https://example.com/first.png",
      );

      await act(async () => {
        root.render(createElement(MarkdownPreview, { document: second, interactive: true }));
      });

      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toContain("External images are blocked");
      expect(container.textContent).toContain("[Image: External]");
    } finally {
      await act(async () => {
        root.unmount();
      });
      vi.unstubAllGlobals();
    }
  });

  it("keeps the empty-preview behavior", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const note = NoteDocument.create(createDocumentId(), "Empty", 100);
    const container = document.createElement("div");
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(createElement(MarkdownPreview, { document: note, interactive: true }));
      });
      expect(container.textContent).toContain("Nothing to preview yet.");
    } finally {
      await act(async () => {
        root.unmount();
      });
      vi.unstubAllGlobals();
    }
  });
});

function parseHtml(html: string): HTMLElement {
  return new DOMParser().parseFromString(html, "text/html").body;
}

function noteWithBody(title: string, body: string): NoteDocument {
  return NoteDocument.createWithInitialState(createDocumentId(), {
    title,
    body,
    createdAt: 100,
    updatedAt: 100,
    tags: [],
  });
}
