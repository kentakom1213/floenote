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
    margin: "12px 12px 0",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    overflow: "hidden",
  },
  ".cm-panels-bottom": {
    borderTop: "1px solid var(--color-border)",
  },
  ".cm-panel.cm-search": {
    position: "relative",
    display: "grid",
    gridTemplateColumns:
      "minmax(0, 220px) max-content max-content max-content max-content max-content max-content minmax(0, 1fr)",
    gridTemplateRows: "auto",
    alignItems: "center",
    columnGap: "6px",
    rowGap: "6px",
    padding: "10px 44px 10px 10px",
  },
  ".cm-panel.cm-search br": {
    display: "none",
  },
  ".cm-panel.cm-search [name=search]": {
    gridColumn: "1",
    gridRow: "1",
  },
  ".cm-panel.cm-search [name=next]": {
    gridColumn: "2",
    gridRow: "1",
  },
  ".cm-panel.cm-search [name=prev]": {
    gridColumn: "3",
    gridRow: "1",
  },
  ".cm-panel.cm-search [name=select]": {
    gridColumn: "4",
    gridRow: "1",
  },
  ".cm-panel.cm-search input[name=replace]": {
    gridColumn: "1",
    gridRow: "2",
  },
  ".cm-panel.cm-search button[name=replace]": {
    gridColumn: "2",
    gridRow: "2",
  },
  ".cm-panel.cm-search [name=replaceAll]": {
    gridColumn: "3 / span 2",
    gridRow: "2",
    justifySelf: "start",
  },
  ".cm-panel.cm-search label:has(input[name=case])": {
    gridColumn: "5",
    gridRow: "1",
  },
  ".cm-panel.cm-search label:has(input[name=re])": {
    gridColumn: "6",
    gridRow: "1",
  },
  ".cm-panel.cm-search label:has(input[name=word])": {
    gridColumn: "7",
    gridRow: "1",
  },
  ".cm-panel.cm-search label": {
    position: "relative",
    display: "inline-grid",
    width: "30px",
    height: "30px",
    placeItems: "center",
    boxSizing: "border-box",
    margin: "0",
    border: "1px solid var(--color-border)",
    borderRadius: "7px",
    color: "var(--color-text-muted)",
    backgroundColor: "var(--color-surface)",
    fontSize: "0",
    fontWeight: "600",
    lineHeight: "1",
    cursor: "pointer",
    userSelect: "none",
  },
  ".cm-panel.cm-search label:hover": {
    borderColor: "var(--color-border-strong)",
    color: "var(--color-text)",
    backgroundColor: "var(--color-surface-hover)",
  },
  ".cm-panel.cm-search label:focus-within": {
    outline: "2px solid var(--color-focus)",
    outlineOffset: "2px",
  },
  ".cm-panel.cm-search label:has(input:checked)": {
    borderColor: "var(--color-accent)",
    color: "var(--color-accent)",
    backgroundColor: "var(--color-accent-soft)",
    boxShadow: "inset 0 0 0 1px var(--color-accent)",
    fontWeight: "700",
  },
  ".cm-panel.cm-search label:has(input[name=case])::after": {
    content: "\"Aa\"",
    fontSize: "11px",
  },
  ".cm-panel.cm-search label:has(input[name=re])::after": {
    content: "\".*\"",
    fontSize: "12px",
  },
  ".cm-panel.cm-search label:has(input[name=word])::after": {
    content: "\"ab\"",
    fontSize: "11px",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  ".cm-panel.cm-search .cm-textfield": {
    minWidth: "0",
    minHeight: "32px",
    width: "100%",
    maxWidth: "100%",
    boxSizing: "border-box",
    margin: "0",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    outline: "none",
    padding: "6px 9px",
    color: "var(--color-text)",
    backgroundColor: "var(--color-bg)",
    boxShadow: "none",
    fontFamily:
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
    fontSize: "12px",
  },
  ".cm-panel.cm-search .cm-textfield:focus-visible": {
    borderColor: "var(--color-focus)",
    boxShadow: "0 0 0 2px color-mix(in srgb, var(--color-focus) 28%, transparent)",
  },
  ".cm-panel.cm-search .cm-button": {
    minHeight: "30px",
    margin: "0",
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
  ".cm-panel.cm-search .cm-button:active": {
    borderColor: "var(--color-accent)",
    backgroundColor: "var(--color-accent-soft)",
  },
  ".cm-panel.cm-search .cm-button:focus-visible, .cm-panel.cm-search [name=close]:focus-visible":
    {
      outline: "2px solid var(--color-focus)",
      outlineOffset: "2px",
    },
  ".cm-panel.cm-search input[type=checkbox]": {
    position: "absolute",
    width: "1px",
    height: "1px",
    margin: "0",
    opacity: "0",
  },
  ".cm-panel.cm-search [name=close]": {
    position: "absolute",
    top: "10px",
    right: "8px",
    width: "32px",
    height: "32px",
    display: "inline-grid",
    placeItems: "center",
    boxSizing: "border-box",
    border: "0",
    borderRadius: "6px",
    padding: "0",
    color: "var(--color-text-faint)",
    backgroundColor: "transparent",
    fontSize: "18px",
    lineHeight: "1",
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
