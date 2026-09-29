import { indentWithTab } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { keymap } from "@codemirror/view";

export const floeMarkdownIndentation = [
  indentUnit.of("   "),
  keymap.of([indentWithTab]),
];
