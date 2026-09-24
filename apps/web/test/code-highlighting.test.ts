import { describe, expect, it } from "vitest";

import {
  getFencedCodeHighlights,
  highlightCode,
  resolveCodeLanguage,
} from "../src/code-highlighting.js";

describe("code highlighting", () => {
  it("recognizes supported language identifiers and aliases", () => {
    expect(resolveCodeLanguage("ts")).toBe("typescript");
    expect(resolveCodeLanguage("typescript")).toBe("typescript");
    expect(resolveCodeLanguage("tsx")).toBe("typescript");
    expect(resolveCodeLanguage("js")).toBe("javascript");
    expect(resolveCodeLanguage("javascript")).toBe("javascript");
    expect(resolveCodeLanguage("jsx")).toBe("javascript");
    expect(resolveCodeLanguage("json")).toBe("json");
    expect(resolveCodeLanguage("py")).toBe("python");
    expect(resolveCodeLanguage("python")).toBe("python");
    expect(resolveCodeLanguage("sh")).toBe("shell");
    expect(resolveCodeLanguage("bash")).toBe("shell");
    expect(resolveCodeLanguage("shell")).toBe("shell");
    expect(resolveCodeLanguage("zsh")).toBe("shell");
    expect(resolveCodeLanguage("css")).toBe("css");
    expect(resolveCodeLanguage("html")).toBe("html");
    expect(resolveCodeLanguage("htm")).toBe("html");
  });

  it("finds language-specific tokens inside a fenced TypeScript block", () => {
    const source = [
      "# Example",
      "",
      "```ts",
      "const value: number = 42;",
      "```",
    ].join("\n");

    const spans = getFencedCodeHighlights(source);
    const tokens = spans.map((span) => ({
      text: source.slice(span.from, span.to),
      kind: span.kind,
      language: span.language,
    }));

    expect(tokens).toContainEqual({
      text: "const",
      kind: "keyword",
      language: "typescript",
    });
    expect(tokens).toContainEqual({
      text: "number",
      kind: "type",
      language: "typescript",
    });
    expect(tokens).toContainEqual({
      text: "42",
      kind: "number",
      language: "typescript",
    });
  });

  it("does not highlight a fence without a language identifier", () => {
    expect(
      getFencedCodeHighlights("```\nconst value = 42;\n```"),
    ).toEqual([]);
  });

  it("falls back cleanly for an unsupported identifier", () => {
    expect(
      getFencedCodeHighlights("```rust\nlet value = 42;\n```"),
    ).toEqual([]);
    expect(resolveCodeLanguage("rust")).toBeNull();
  });

  it("keeps language lexers independent from Markdown source semantics", () => {
    const python = "def greet(name):\n    return \"Hello \" + name";
    const spans = highlightCode(python, "python");
    const tokens = spans.map((span) => ({
      text: python.slice(span.from, span.to),
      kind: span.kind,
    }));

    expect(tokens).toContainEqual({ text: "def", kind: "keyword" });
    expect(tokens).toContainEqual({ text: "return", kind: "keyword" });
    expect(tokens).toContainEqual({ text: '"Hello "', kind: "string" });
  });
});
