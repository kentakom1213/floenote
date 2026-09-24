import { Prec, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  ViewPlugin,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";
import type { UndoManager } from "loro-crdt";

export const EDITOR_UNDO_MAX_STEPS = 500;

export type UndoManagerCommands = {
  canUndo: () => boolean;
  undo: () => unknown;
  canRedo: () => boolean;
  redo: () => unknown;
};

export type UndoGroupingManager = {
  groupStart: () => void;
  groupEnd: () => void;
};

export type CompositionLifecycle = {
  beginComposition: () => void;
  endComposition: () => void;
};

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

export class CompositionUndoGroup {
  #active = false;

  constructor(
    private readonly undoManager: UndoGroupingManager,
    private readonly lifecycle: CompositionLifecycle,
  ) {}

  get active(): boolean {
    return this.#active;
  }

  begin(): void {
    if (this.#active) return;
    this.lifecycle.beginComposition();
    this.undoManager.groupStart();
    this.#active = true;
  }

  end(): void {
    if (!this.#active) return;
    this.undoManager.groupEnd();
    this.lifecycle.endComposition();
    this.#active = false;
  }
}

class CompositionUndoPluginValue implements PluginValue {
  readonly #group: CompositionUndoGroup;
  #scheduledEnd: number | null = null;

  constructor(
    private readonly view: EditorView,
    undoManager: UndoManager,
    lifecycle: CompositionLifecycle,
  ) {
    this.#group = new CompositionUndoGroup(undoManager, lifecycle);
  }

  update(update: ViewUpdate): void {
    if (!this.#group.active) return;

    const hasCompositionChange = update.transactions.some(
      (transaction) =>
        transaction.docChanged &&
        transaction.isUserEvent("input.type.compose"),
    );
    if (!hasCompositionChange) return;

    // LoroExtensions is installed before this plugin, so the final
    // composition transaction has already been committed to Loro here.
    if (!this.view.compositionStarted) {
      this.#cancelScheduledEnd();
      this.#group.end();
    }
  }

  onCompositionStart(): void {
    // A new composition should never be absorbed into a previous one.
    this.#cancelScheduledEnd();
    this.#group.end();
    this.#group.begin();
  }

  onCompositionEnd(): void {
    if (!this.#group.active || this.#scheduledEnd !== null) return;

    // CodeMirror can flush the final composition DOM mutation in a microtask
    // or, on Android, in requestAnimationFrame. Its own observer runs before
    // this plugin handler, so this callback is queued after that pending flush.
    this.#scheduledEnd = this.view.dom.ownerDocument.defaultView!.requestAnimationFrame(
      () => {
        this.#scheduledEnd = null;
        if (!this.view.compositionStarted) {
          this.#group.end();
        }
      },
    );
  }

  destroy(): void {
    this.#cancelScheduledEnd();
    this.#group.end();
  }

  #cancelScheduledEnd(): void {
    if (this.#scheduledEnd === null) return;
    this.view.dom.ownerDocument.defaultView!.cancelAnimationFrame(
      this.#scheduledEnd,
    );
    this.#scheduledEnd = null;
  }
}

export function compositionUndoGrouping(
  undoManager: UndoManager,
  lifecycle: CompositionLifecycle,
): Extension {
  return ViewPlugin.define(
    (view) => new CompositionUndoPluginValue(view, undoManager, lifecycle),
    {
      eventHandlers: {
        compositionstart() {
          this.onCompositionStart();
          return false;
        },
        compositionend() {
          this.onCompositionEnd();
          return false;
        },
      },
    },
  );
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
