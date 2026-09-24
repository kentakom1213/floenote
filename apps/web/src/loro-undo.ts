import { Prec, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type { UndoManager } from "loro-crdt";

type UndoManagerCommands = Pick<
  UndoManager,
  "canUndo" | "undo" | "canRedo" | "redo"
>;

export function runLoroUndo(undoManager: UndoManagerCommands): boolean {
  if (undoManager.canUndo()) {
    undoManager.undo();
  }

  // Never fall through to CodeMirror's independent history. The Loro
  // document is the source of truth for collaborative undo/redo.
  return true;
}

export function runLoroRedo(undoManager: UndoManagerCommands): boolean {
  if (undoManager.canRedo()) {
    undoManager.redo();
  }

  return true;
}

export function synchronousLoroUndoKeymap(
  undoManager: UndoManager,
): Extension {
  return Prec.highest(
    keymap.of([
      {
        key: "Mod-z",
        run: () => runLoroUndo(undoManager),
        preventDefault: true,
      },
      {
        key: "Mod-y",
        mac: "Mod-Shift-z",
        run: () => runLoroRedo(undoManager),
        preventDefault: true,
      },
      {
        key: "Mod-Shift-z",
        run: () => runLoroRedo(undoManager),
        preventDefault: true,
      },
    ]),
  );
}
