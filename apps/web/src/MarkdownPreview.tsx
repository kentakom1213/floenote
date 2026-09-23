import type { NoteDocument } from "@floe-note/document";
import katex from "katex";
import "katex/dist/katex.min.css";
import { marked } from "marked";
import { useCallback, useMemo, useSyncExternalStore } from "react";

type MarkdownPreviewProps = {
  document: NoteDocument;
};

type MathSnippet = {
  marker: string;
  expression: string;
  display: boolean;
};

const ALLOWED_TAGS = new Set([
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);

export function MarkdownPreview({ document }: MarkdownPreviewProps) {
  const subscribe = useCallback(
    (listener: () => void) => document.subscribe(listener),
    [document],
  );
  const getSnapshot = useCallback(() => document.bodyText, [document]);
  const markdown = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);

  if (!markdown.trim()) {
    return (
      <div className="markdown-preview markdown-preview-empty">
        <p>Nothing to preview yet.</p>
      </div>
    );
  }

  return (
    <div
      className="markdown-preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function renderMarkdown(source: string): string {
  const extracted = extractMath(source);
  const rendered = marked.parse(extracted.markdown, {
    async: false,
    gfm: true,
  }) as string;

  const parsed = new DOMParser().parseFromString(rendered, "text/html");
  sanitizeMarkdown(parsed.body);
  hydrateMath(parsed, extracted.math);

  return parsed.body.innerHTML;
}

function sanitizeMarkdown(root: HTMLElement): void {
  const elements = Array.from(root.querySelectorAll("*"));

  for (const element of elements) {
    const tag = element.tagName.toLowerCase();

    if (tag === "img") {
      const replacement = root.ownerDocument.createElement("span");
      replacement.className = "markdown-image-placeholder";
      const alt = element.getAttribute("alt")?.trim();
      replacement.textContent = alt ? `[Image: ${alt}]` : "[Image]";
      element.replaceWith(replacement);
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      element.replaceWith(
        root.ownerDocument.createTextNode(element.textContent ?? ""),
      );
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const keepHref = tag === "a" && attribute.name === "href";
      const keepTitle = tag === "a" && attribute.name === "title";
      const keepCodeClass =
        tag === "code" &&
        attribute.name === "class" &&
        /^language-[a-z0-9_+-]+$/iu.test(attribute.value);

      if (!keepHref && !keepTitle && !keepCodeClass) {
        element.removeAttribute(attribute.name);
      }
    }

    if (tag === "a") {
      const href = element.getAttribute("href");
      if (!href || !isSafeHref(href)) {
        element.removeAttribute("href");
      } else {
        element.setAttribute("rel", "noreferrer noopener");
      }
    }
  }
}

function isSafeHref(href: string): boolean {
  if (
    href.startsWith("#") ||
    href.startsWith("/") ||
    href.startsWith("./") ||
    href.startsWith("../")
  ) {
    return true;
  }

  try {
    const url = new URL(href, window.location.origin);
    return (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "mailto:"
    );
  } catch {
    return false;
  }
}

function hydrateMath(document: Document, snippets: readonly MathSnippet[]): void {
  if (snippets.length === 0) return;

  const byMarker = new Map(snippets.map((snippet) => [snippet.marker, snippet]));
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
  );
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  for (const textNode of textNodes) {
    const value = textNode.nodeValue ?? "";
    const matches = snippets.filter((snippet) => value.includes(snippet.marker));
    if (matches.length === 0) continue;

    const fragment = document.createDocumentFragment();
    let remaining = value;

    while (remaining.length > 0) {
      let next: MathSnippet | null = null;
      let nextIndex = Number.POSITIVE_INFINITY;

      for (const snippet of matches) {
        const index = remaining.indexOf(snippet.marker);
        if (index >= 0 && index < nextIndex) {
          next = byMarker.get(snippet.marker) ?? null;
          nextIndex = index;
        }
      }

      if (!next) {
        fragment.append(remaining);
        break;
      }

      if (nextIndex > 0) {
        fragment.append(remaining.slice(0, nextIndex));
      }

      const math = document.createElement("span");
      math.className = next.display
        ? "markdown-math markdown-math-block"
        : "markdown-math";
      math.innerHTML = katex.renderToString(next.expression, {
        displayMode: next.display,
        throwOnError: false,
        trust: false,
        strict: "warn",
        output: "htmlAndMathml",
      });
      fragment.append(math);

      remaining = remaining.slice(nextIndex + next.marker.length);
    }

    textNode.replaceWith(fragment);
  }
}

function extractMath(source: string): {
  markdown: string;
  math: MathSnippet[];
} {
  const math: MathSnippet[] = [];
  const lines = source.split("\n");
  const output: string[] = [];
  let fence: string | null = null;

  function addMath(expression: string, display: boolean): string {
    const marker = `\uE000FLOEMATH${math.length}\uE001`;
    math.push({ marker, expression: expression.trim(), display });
    return marker;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    const fenceMatch = /^(\`{3,}|~{3,})/u.exec(trimmed);

    if (fenceMatch) {
      const token = fenceMatch[1] ?? "";
      if (!fence) {
        fence = token[0] ?? null;
      } else if (token[0] === fence) {
        fence = null;
      }
      output.push(line);
      continue;
    }

    if (fence) {
      output.push(line);
      continue;
    }

    if (trimmed === "$$") {
      const block: string[] = [];
      let closed = false;

      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const candidate = lines[cursor] ?? "";
        if (candidate.trim() === "$$") {
          index = cursor;
          closed = true;
          break;
        }
        block.push(candidate);
      }

      if (closed) {
        output.push(addMath(block.join("\n"), true));
        continue;
      }
    }

    output.push(replaceInlineMath(line, addMath));
  }

  return { markdown: output.join("\n"), math };
}

function replaceInlineMath(
  line: string,
  addMath: (expression: string, display: boolean) => string,
): string {
  let output = "";
  let index = 0;

  while (index < line.length) {
    if (line[index] === "`") {
      const runStart = index;
      while (line[index] === "`") index += 1;
      const ticks = line.slice(runStart, index);
      const closing = line.indexOf(ticks, index);
      if (closing < 0) {
        output += line.slice(runStart);
        break;
      }
      output += line.slice(runStart, closing + ticks.length);
      index = closing + ticks.length;
      continue;
    }

    if (line[index] !== "$" || isEscaped(line, index)) {
      output += line[index] ?? "";
      index += 1;
      continue;
    }

    const display = line[index + 1] === "$";
    const delimiter = display ? "$$" : "$";
    const start = index + delimiter.length;
    const closing = findClosingDollar(line, delimiter, start);

    if (closing < 0) {
      output += delimiter;
      index = start;
      continue;
    }

    const expression = line.slice(start, closing);
    if (!expression.trim()) {
      output += delimiter;
      index = start;
      continue;
    }

    output += addMath(expression, display);
    index = closing + delimiter.length;
  }

  return output;
}

function findClosingDollar(
  line: string,
  delimiter: "$" | "$$",
  start: number,
): number {
  let cursor = start;

  while (cursor < line.length) {
    const found = line.indexOf(delimiter, cursor);
    if (found < 0) return -1;
    if (!isEscaped(line, found)) return found;
    cursor = found + delimiter.length;
  }

  return -1;
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}
