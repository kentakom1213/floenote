import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { EditorView } from "codemirror";

const markdownHighlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.heading,
      tags.heading1,
      tags.heading2,
      tags.heading3,
      tags.heading4,
      tags.heading5,
      tags.heading6,
    ],
    color: "var(--editor-syntax-heading)",
    fontWeight: "700",
  },
  {
    tag: [tags.link, tags.url],
    color: "var(--editor-syntax-link)",
  },
  {
    tag: tags.strong,
    color: "var(--editor-syntax-strong)",
    fontWeight: "700",
  },
  {
    tag: tags.emphasis,
    color: "var(--editor-syntax-emphasis)",
    fontStyle: "italic",
  },
  {
    tag: tags.monospace,
    color: "var(--editor-syntax-code)",
  },
  {
    tag: tags.quote,
    color: "var(--editor-syntax-quote)",
  },
  {
    tag: [
      tags.punctuation,
      tags.contentSeparator,
      tags.list,
    ],
    color: "var(--editor-syntax-punctuation)",
  },
  {
    tag: [
      tags.meta,
      tags.documentMeta,
      tags.processingInstruction,
    ],
    color: "var(--editor-syntax-meta)",
  },
  {
    tag: tags.strikethrough,
    color: "var(--editor-syntax-emphasis)",
    textDecoration: "line-through",
  },
]);

const floeEditorChrome = EditorView.theme({
  "&": {
    color: "var(--color-text)",
    backgroundColor: "transparent",
  },
  ".cm-content": {
    caretColor: "var(--color-accent)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--color-accent)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "var(--color-accent-soft) !important",
    },
  ".cm-panels": {
    color: "var(--color-text)",
    backgroundColor: "var(--color-surface)",
    borderColor: "var(--color-border)",
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
    fontSize: "12px",
  },
  ".cm-panels-top": {
    borderBottom: "1px solid var(--color-border)",
  },
  ".cm-panels-bottom": {
    borderTop: "1px solid var(--color-border)",
  },
  ".cm-panel.cm-search": {
    padding: "8px 36px 8px 10px",
  },
  ".cm-panel.cm-search label": {
    color: "var(--color-text-muted)",
  },
  ".cm-panel.cm-search .cm-textfield": {
    boxSizing: "border-box",
    border: "1px solid var(--color-border)",
    borderRadius: "7px",
    outline: "none",
    padding: "5px 7px",
    color: "var(--color-text)",
    backgroundColor: "var(--color-bg)",
  },
  ".cm-panel.cm-search .cm-textfield:focus-visible": {
    borderColor: "var(--color-focus)",
    boxShadow: "0 0 0 1px var(--color-focus)",
  },
  ".cm-panel.cm-search .cm-button": {
    border: "1px solid var(--color-border)",
    borderRadius: "7px",
    padding: "5px 8px",
    color: "var(--color-text)",
    backgroundColor: "var(--color-surface)",
    backgroundImage: "none",
    fontSize: "11px",
    textTransform: "none",
  },
  ".cm-panel.cm-search .cm-button:hover": {
    borderColor: "var(--color-border-strong)",
    backgroundColor: "var(--color-surface-hover)",
  },
  ".cm-panel.cm-search input[type=checkbox]": {
    accentColor: "var(--color-accent)",
  },
  ".cm-panel.cm-search [name=close]": {
    border: "0",
    borderRadius: "6px",
    padding: "2px 6px",
    color: "var(--color-text-faint)",
    backgroundColor: "transparent",
    fontSize: "18px",
  },
  ".cm-panel.cm-search [name=close]:hover": {
    color: "var(--color-text)",
    backgroundColor: "var(--color-surface-hover)",
  },
  ".cm-tooltip": {
    border: "1px solid var(--color-border)",
    borderRadius: "9px",
    overflow: "hidden",
    color: "var(--color-text)",
    backgroundColor: "var(--color-surface)",
    boxShadow: "var(--shadow-popover)",
  },
  ".cm-searchMatch, .cm-selectionMatch": {
    borderRadius: "2px",
    backgroundColor: "var(--editor-search-match)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    outline: "1px solid var(--color-focus)",
    backgroundColor: "var(--editor-search-match-current)",
  },
});

export const floeCodeMirrorAppearance = [
  floeEditorChrome,
  syntaxHighlighting(markdownHighlightStyle),
];
