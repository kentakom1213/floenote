import type { Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

export type CodeLanguage =
  | "typescript"
  | "javascript"
  | "json"
  | "python"
  | "shell"
  | "css"
  | "html";

export type CodeTokenKind =
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "type"
  | "property"
  | "tag"
  | "attribute"
  | "variable"
  | "literal";

export type CodeHighlightSpan = {
  from: number;
  to: number;
  kind: CodeTokenKind;
};

export type FencedCodeHighlightSpan = CodeHighlightSpan & {
  language: CodeLanguage;
};

const LANGUAGE_ALIASES: Readonly<Record<string, CodeLanguage>> = {
  ts: "typescript",
  typescript: "typescript",
  tsx: "typescript",
  js: "javascript",
  javascript: "javascript",
  jsx: "javascript",
  json: "json",
  py: "python",
  python: "python",
  sh: "shell",
  bash: "shell",
  shell: "shell",
  zsh: "shell",
  css: "css",
  html: "html",
  htm: "html",
};

const JAVASCRIPT_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "keyof",
  "let",
  "namespace",
  "new",
  "of",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "satisfies",
  "static",
  "switch",
  "throw",
  "try",
  "type",
  "typeof",
  "var",
  "while",
  "with",
  "yield",
]);

const TYPESCRIPT_TYPES = new Set([
  "any",
  "bigint",
  "boolean",
  "never",
  "number",
  "object",
  "string",
  "symbol",
  "unknown",
  "void",
]);

const JAVASCRIPT_LITERALS = new Set([
  "false",
  "null",
  "true",
  "undefined",
]);

const PYTHON_KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "case",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "match",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
]);

const PYTHON_LITERALS = new Set(["False", "None", "True"]);

const SHELL_KEYWORDS = new Set([
  "case",
  "do",
  "done",
  "elif",
  "else",
  "esac",
  "fi",
  "for",
  "function",
  "if",
  "in",
  "select",
  "then",
  "until",
  "while",
]);

const TOKEN_CLASS_PREFIX = "floe-code-";

export function resolveCodeLanguage(identifier: string): CodeLanguage | null {
  return LANGUAGE_ALIASES[identifier.trim().toLowerCase()] ?? null;
}

export function highlightCode(
  source: string,
  language: CodeLanguage,
): readonly CodeHighlightSpan[] {
  switch (language) {
    case "typescript":
    case "javascript":
      return highlightJavaScriptLike(source);
    case "json":
      return highlightJson(source);
    case "python":
      return highlightPython(source);
    case "shell":
      return highlightShell(source);
    case "css":
      return highlightCss(source);
    case "html":
      return highlightHtml(source);
  }
}

export function getFencedCodeHighlights(
  source: string,
): readonly FencedCodeHighlightSpan[] {
  const highlights: FencedCodeHighlightSpan[] = [];
  let offset = 0;
  let open:
    | {
        marker: "`" | "~";
        length: number;
        language: CodeLanguage | null;
        bodyStart: number;
      }
    | null = null;

  while (offset <= source.length) {
    const newline = source.indexOf("\n", offset);
    const lineEnd = newline < 0 ? source.length : newline;
    const nextOffset = newline < 0 ? source.length + 1 : newline + 1;
    const line = source.slice(offset, lineEnd);

    if (!open) {
      const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
      if (match) {
        const fence = match[1] ?? "";
        const info = match[2] ?? "";
        if (!(fence[0] === "`" && info.includes("`"))) {
          const identifier = info.trim().split(/[ \t]+/u)[0] ?? "";
          open = {
            marker: fence[0] as "`" | "~",
            length: fence.length,
            language: identifier ? resolveCodeLanguage(identifier) : null,
            bodyStart: newline < 0 ? source.length : newline + 1,
          };
        }
      }
    } else {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(line);
      const marker = close?.[1] ?? "";
      if (
        marker &&
        marker[0] === open.marker &&
        marker.length >= open.length
      ) {
        appendFencedHighlights(
          highlights,
          source,
          open.bodyStart,
          offset,
          open.language,
        );
        open = null;
      }
    }

    if (newline < 0) break;
    offset = nextOffset;
  }

  if (open) {
    appendFencedHighlights(
      highlights,
      source,
      open.bodyStart,
      source.length,
      open.language,
    );
  }

  return highlights;
}

export function fencedCodeHighlighting(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildEditorDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = buildEditorDecorations(update.view);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}

export function hydrateCodeHighlighting(document: Document): void {
  for (const code of Array.from(
    document.querySelectorAll<HTMLElement>("pre > code[class]"),
  )) {
    const languageClass = Array.from(code.classList).find((className) =>
      className.startsWith("language-"),
    );
    if (!languageClass) continue;

    const language = resolveCodeLanguage(
      languageClass.slice("language-".length),
    );
    if (!language) continue;

    const source = code.textContent ?? "";
    const spans = highlightCode(source, language);
    if (spans.length === 0) continue;

    const fragment = document.createDocumentFragment();
    let cursor = 0;

    for (const span of spans) {
      if (span.from > cursor) {
        fragment.append(source.slice(cursor, span.from));
      }
      const token = document.createElement("span");
      token.className = `floe-code-token ${TOKEN_CLASS_PREFIX}${span.kind}`;
      token.textContent = source.slice(span.from, span.to);
      fragment.append(token);
      cursor = span.to;
    }

    if (cursor < source.length) {
      fragment.append(source.slice(cursor));
    }
    code.replaceChildren(fragment);
  }
}

function appendFencedHighlights(
  output: FencedCodeHighlightSpan[],
  source: string,
  from: number,
  to: number,
  language: CodeLanguage | null,
): void {
  if (!language || from >= to) return;
  const code = source.slice(from, to);
  for (const span of highlightCode(code, language)) {
    output.push({
      from: from + span.from,
      to: from + span.to,
      kind: span.kind,
      language,
    });
  }
}

function buildEditorDecorations(view: EditorView): DecorationSet {
  const ranges = getFencedCodeHighlights(view.state.doc.toString()).map(
    (span) =>
      Decoration.mark({
        class: `cm-${TOKEN_CLASS_PREFIX}${span.kind}`,
      }).range(span.from, span.to),
  );
  return Decoration.set(ranges, true);
}

function highlightJavaScriptLike(source: string): CodeHighlightSpan[] {
  const pattern =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b[A-Za-z_$][\w$]*\b|\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/gu;

  return collectMatches(source, pattern, (value) => {
    if (value.startsWith("//") || value.startsWith("/*")) return "comment";
    if (/^["'`]/u.test(value)) return "string";
    if (JAVASCRIPT_KEYWORDS.has(value)) return "keyword";
    if (TYPESCRIPT_TYPES.has(value)) return "type";
    if (JAVASCRIPT_LITERALS.has(value)) return "literal";
    if (/^(?:0[xX]|0[bB]|0[oO]|\d)/u.test(value)) return "number";
    return null;
  });
}

function highlightJson(source: string): CodeHighlightSpan[] {
  const pattern =
    /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/gu;

  return collectMatches(source, pattern, (value, match) => {
    if (value.startsWith('"')) {
      const rest = source.slice((match.index ?? 0) + value.length);
      return /^\s*:/u.test(rest) ? "property" : "string";
    }
    if (/^(?:true|false|null)$/u.test(value)) return "literal";
    return "number";
  });
}

function highlightPython(source: string): CodeHighlightSpan[] {
  const pattern =
    /#[^\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b[A-Za-z_]\w*\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/gu;

  return collectMatches(source, pattern, (value) => {
    if (value.startsWith("#")) return "comment";
    if (/^(?:"""|'''|"|')/u.test(value)) return "string";
    if (PYTHON_KEYWORDS.has(value)) return "keyword";
    if (PYTHON_LITERALS.has(value)) return "literal";
    if (/^\d/u.test(value)) return "number";
    return null;
  });
}

function highlightShell(source: string): CodeHighlightSpan[] {
  const pattern =
    /#[^\n]*|"(?:\\.|[^"\\])*"|'[^']*'|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\b[A-Za-z_][A-Za-z0-9_]*\b|\b\d+(?:\.\d+)?\b/gu;

  return collectMatches(source, pattern, (value) => {
    if (value.startsWith("#")) return "comment";
    if (/^["']/u.test(value)) return "string";
    if (value.startsWith("$")) return "variable";
    if (SHELL_KEYWORDS.has(value)) return "keyword";
    if (/^\d/u.test(value)) return "number";
    return null;
  });
}

function highlightCss(source: string): CodeHighlightSpan[] {
  const pattern =
    /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|@[A-Za-z-]+|--[A-Za-z0-9_-]+|#[0-9a-fA-F]{3,8}\b|-?\b\d+(?:\.\d+)?(?:%|[A-Za-z]+)?\b|\b[-A-Za-z][\w-]*(?=\s*:)/gu;

  return collectMatches(source, pattern, (value) => {
    if (value.startsWith("/*")) return "comment";
    if (/^["']/u.test(value)) return "string";
    if (value.startsWith("@")) return "keyword";
    if (value.startsWith("--")) return "variable";
    if (/^#[0-9a-fA-F]/u.test(value)) return "number";
    if (/^-?\d/u.test(value)) return "number";
    return "property";
  });
}

function highlightHtml(source: string): CodeHighlightSpan[] {
  const pattern =
    /<!--[\s\S]*?-->|<\/?[A-Za-z][A-Za-z0-9:-]*|\b[A-Za-z_:][A-Za-z0-9:._-]*(?=\s*=)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|&[A-Za-z0-9#]+;/gu;

  return collectMatches(source, pattern, (value) => {
    if (value.startsWith("<!--")) return "comment";
    if (value.startsWith("<")) return "tag";
    if (/^["']/u.test(value)) return "string";
    if (value.startsWith("&")) return "literal";
    return "attribute";
  });
}

function collectMatches(
  source: string,
  pattern: RegExp,
  classify: (
    value: string,
    match: RegExpExecArray,
  ) => CodeTokenKind | null,
): CodeHighlightSpan[] {
  const spans: CodeHighlightSpan[] = [];
  pattern.lastIndex = 0;

  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const value = match[0];
    const kind = classify(value, match);
    if (!kind || value.length === 0) continue;
    spans.push({
      from: match.index,
      to: match.index + value.length,
      kind,
    });
  }

  return spans;
}
