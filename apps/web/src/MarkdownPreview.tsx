import type { NoteDocument } from "@floe-note/document";
import katex from "katex";
import "katex/dist/katex.min.css";
import { marked } from "marked";
import {
  type ChangeEvent,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  classifyMarkdownImageSource,
  extractMarkdownImages,
  type MarkdownImageDescriptor,
} from "./markdown-images.js";
import { sanitizeMarkdownHtml } from "./markdown-sanitizer.js";
import {
  extractMarkdownTasks,
  type MarkdownTaskDescriptor,
} from "./markdown-tasks.js";

type MarkdownPreviewProps = {
  document: NoteDocument;
  interactive: boolean;
};

type MathSnippet = {
  marker: string;
  expression: string;
  display: boolean;
};

export type MarkdownRenderResult = {
  html: string;
  hasExternalImages: boolean;
  source: string;
  tasks: readonly MarkdownTaskDescriptor[];
};

export function MarkdownPreview({
  document,
  interactive,
}: MarkdownPreviewProps) {
  return (
    <DocumentMarkdownPreview
      key={document.id}
      document={document}
      interactive={interactive}
    />
  );
}

function DocumentMarkdownPreview({
  document,
  interactive,
}: MarkdownPreviewProps) {
  const [loadExternalImages, setLoadExternalImages] = useState(false);
  const subscribe = useCallback(
    (listener: () => void) => subscribeMarkdownPreview(document, listener),
    [document],
  );
  const getSnapshot = useCallback(
    () => getMarkdownPreviewSource(document),
    [document],
  );
  const markdown = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const rendered = useMemo(
    () =>
      renderMarkdownWithImagePolicy(markdown, {
        loadExternalImages,
        interactiveTasks: interactive,
      }),
    [interactive, loadExternalImages, markdown],
  );

  const handleTaskChange = useCallback(
    (event: ChangeEvent<HTMLDivElement>) => {
      if (!interactive) return;

      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.classList.contains("markdown-task-checkbox")) return;

      const taskId = target.dataset.floeTaskId;
      const task = rendered.tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;

      // Any document change since this render invalidates all source offsets.
      // Prefer a safe no-op until React rerenders rather than risk toggling a
      // different task after a local or remote concurrent edit.
      if (document.bodyText !== rendered.source) {
        target.checked = task.checked;
        return;
      }

      const changed = document.toggleTaskMarker({
        sourceStart: task.sourceStart,
        sourceEnd: task.sourceEnd,
        lineStart: task.lineStart,
        lineEnd: task.lineEnd,
        sourceLine: task.sourceLine,
        sourceMarker: task.sourceMarker,
        checked: target.checked,
      });

      if (!changed) {
        target.checked = task.checked;
      }
    },
    [document, interactive, rendered],
  );

  if (!markdown.trim()) {
    return (
      <div className="markdown-preview markdown-preview-empty">
        <p>Nothing to preview yet.</p>
      </div>
    );
  }

  return (
    <>
      {rendered.hasExternalImages && !loadExternalImages ? (
        <aside className="external-image-warning" aria-label="External images">
          <div className="external-image-warning-copy">
            <strong>External images are blocked</strong>
            <p>
              Loading them may reveal your IP address to the sites hosting
              them.
            </p>
          </div>
          <button type="button" onClick={() => setLoadExternalImages(true)}>
            Load external images
          </button>
        </aside>
      ) : null}
      <div
        className="markdown-preview"
        onChange={handleTaskChange}
        dangerouslySetInnerHTML={{ __html: rendered.html }}
      />
    </>
  );
}

export function subscribeMarkdownPreview(
  document: NoteDocument,
  listener: () => void,
): () => void {
  const unsubscribeDocument = document.subscribe(listener);
  const unsubscribeLocalUpdates = document.subscribeLocalUpdates(() =>
    listener(),
  );

  return () => {
    unsubscribeLocalUpdates();
    unsubscribeDocument();
  };
}

export function getMarkdownPreviewSource(document: NoteDocument): string {
  return document.bodyText;
}

export function renderMarkdown(source: string): string {
  return renderMarkdownWithImagePolicy(source, {
    loadExternalImages: false,
    interactiveTasks: false,
  }).html;
}

export function renderMarkdownWithImagePolicy(
  source: string,
  options: {
    loadExternalImages: boolean;
    interactiveTasks?: boolean;
  },
): MarkdownRenderResult {
  const extractedTasks = extractMarkdownTasks(source);
  const extractedMath = extractMath(extractedTasks.markdown);
  const rendered = marked.parse(extractedMath.markdown, {
    async: false,
    gfm: true,
  }) as string;

  // Image-bearing elements are removed before DOMPurify/DOMParser sees their
  // resource URLs. The HTML passed onward contains only inert text markers.
  const extractedImages = extractMarkdownImages(rendered);
  const sanitized = sanitizeMarkdownHtml(extractedImages.html);
  const parsed = new DOMParser().parseFromString(sanitized, "text/html");

  hydrateTasks(
    parsed,
    extractedTasks.tasks,
    options.interactiveTasks ?? false,
  );
  hydrateMath(parsed, extractedMath.math);
  hydrateImages(parsed, extractedImages.images, options.loadExternalImages);

  return {
    html: parsed.body.innerHTML,
    source,
    tasks: extractedTasks.tasks,
    hasExternalImages: extractedImages.images.some(
      (image) =>
        classifyMarkdownImageSource(image.source) === "external-https",
    ),
  };
}

function hydrateTasks(
  document: Document,
  tasks: readonly MarkdownTaskDescriptor[],
  interactive: boolean,
): void {
  if (tasks.length === 0) return;

  const byMarker = new Map(tasks.map((task) => [task.marker, task]));
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
    if (!tasks.some((task) => value.includes(task.marker))) continue;

    const fragment = document.createDocumentFragment();
    let remaining = value;

    while (remaining.length > 0) {
      let next: MarkdownTaskDescriptor | null = null;
      let nextIndex = Number.POSITIVE_INFINITY;

      for (const task of tasks) {
        const index = remaining.indexOf(task.marker);
        if (index >= 0 && index < nextIndex) {
          next = byMarker.get(task.marker) ?? null;
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

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "markdown-task-checkbox";
      checkbox.checked = next.checked;
      if (next.checked) checkbox.setAttribute("checked", "");
      checkbox.disabled = !interactive;
      checkbox.dataset.floeTaskId = next.id;
      checkbox.setAttribute("aria-label", next.label || "Task");
      fragment.append(checkbox);

      const item = textNode.parentElement?.closest("li");
      item?.classList.add("markdown-task-item");

      remaining = remaining.slice(nextIndex + next.marker.length);
    }

    textNode.replaceWith(fragment);
  }
}

function hydrateImages(
  document: Document,
  images: readonly MarkdownImageDescriptor[],
  loadExternalImages: boolean,
): void {
  if (images.length === 0) return;

  const byMarker = new Map(images.map((image) => [image.marker, image]));
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
    if (!images.some((image) => value.includes(image.marker))) continue;

    const fragment = document.createDocumentFragment();
    let remaining = value;

    while (remaining.length > 0) {
      let next: MarkdownImageDescriptor | null = null;
      let nextIndex = Number.POSITIVE_INFINITY;

      for (const image of images) {
        const index = remaining.indexOf(image.marker);
        if (index >= 0 && index < nextIndex) {
          next = byMarker.get(image.marker) ?? null;
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

      fragment.append(renderImageNode(document, next, loadExternalImages));
      remaining = remaining.slice(nextIndex + next.marker.length);
    }

    textNode.replaceWith(fragment);
  }
}

function renderImageNode(
  document: Document,
  image: MarkdownImageDescriptor,
  loadExternalImages: boolean,
): HTMLElement {
  const kind = classifyMarkdownImageSource(image.source);

  if (kind === "external-https" && loadExternalImages) {
    const element = document.createElement("img");
    element.setAttribute("alt", image.alt);
    element.setAttribute("loading", "lazy");
    element.setAttribute("referrerpolicy", "no-referrer");
    if (image.title !== null) {
      element.setAttribute("title", image.title);
    }

    // src is set last, and only after explicit note-scoped permission.
    element.setAttribute("src", image.source);
    return element;
  }

  const placeholder = document.createElement("span");
  placeholder.className = "markdown-image-placeholder";

  if (kind === "external-https") {
    placeholder.textContent = image.alt ? `[Image: ${image.alt}]` : "[Image]";
  } else if (kind === "insecure-http") {
    placeholder.textContent = image.alt
      ? `[Image blocked: insecure source — ${image.alt}]`
      : "[Image blocked: insecure source]";
  } else if (kind === "relative") {
    placeholder.textContent = image.alt
      ? `[Image unavailable: ${image.alt}]`
      : "[Image unavailable]";
  } else {
    placeholder.textContent = image.alt
      ? `[Image blocked: unsafe source — ${image.alt}]`
      : "[Image blocked: unsafe source]";
  }

  return placeholder;
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
    const fenceMatch = /^(`{3,}|~{3,})/u.exec(trimmed);

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
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor -= 1
  ) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}
