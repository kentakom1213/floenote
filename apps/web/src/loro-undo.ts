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

  constructor(private readonly undoManager: UndoGroupingManager) {}

  get active(): boolean {
    return this.#active;
  }

  startAfterFirstChange(): void {
    if (this.#active) return;
    this.undoManager.groupStart();
    this.#active = true;
  }

  end(): void {
    if (!this.#active) return;
    this.undoManager.groupEnd();
    this.#active = false;
  }
}

class CompositionUndoPluginValue implements PluginValue {
  readonly #group: CompositionUndoGroup;
  #scheduledEnd: number | null = null;

  constructor(
    private readonly view: EditorView,
    undoManager: UndoManager,
  ) {
    this.#group = new CompositionUndoGroup(undoManager);
  }

  update(update: ViewUpdate): void {
    const compositionTransactions = update.transactions.filter(
      (transaction) =>
        transaction.docChanged &&
        transaction.isUserEvent("input.type.compose"),
    );
    if (compositionTransactions.length === 0) return;

    if (
      compositionTransactions.some((transaction) =>
        transaction.isUserEvent("input.type.compose.start"),
      )
    ) {
      this.#cancelScheduledEnd();
      // This plugin is intentionally installed after LoroExtensions. The first
      // composition transaction has therefore already been committed to Loro,
      // so opening the group here prevents it from merging with the edit that
      // happened immediately before the IME composition.
      this.#group.startAfterFirstChange();
    }

    // CodeMirror may emit the final composition transaction after the DOM
    // compositionend event. At this point the Loro sync plugin has already
    // committed that final transaction, so it is safe to close the group.
    if (this.#group.active && !this.view.compositionStarted) {
      this.#cancelScheduledEnd();
      this.#group.end();
    }
  }

  onCompositionStart(): void {
    // A new composition starting before a scheduled close should form a new
    // undo step rather than being absorbed into the previous composition.
    this.#cancelScheduledEnd();
    this.#group.end();
  }

  onCompositionEnd(): void {
    if (!this.#group.active || this.#scheduledEnd !== null) return;

    // CodeMirror can flush the final composition DOM mutation in a microtask
    // or, on Android, in requestAnimationFrame. Its own observer runs before
    // this plugin handler, so this callback is queued after that pending flush.
    this.#scheduledEnd = this.view.win.requestAnimationFrame(() => {
      this.#scheduledEnd = null;
      if (!this.view.compositionStarted) {
        this.#group.end();
      }
    });
  }

  destroy(): void {
    this.#cancelScheduledEnd();
    this.#group.end();
  }

  #cancelScheduledEnd(): void {
    if (this.#scheduledEnd === null) return;
    this.view.win.cancelAnimationFrame(this.#scheduledEnd);
    this.#scheduledEnd = null;
  }
}

export function compositionUndoGrouping(undoManager: UndoManager): Extension {
  return ViewPlugin.define(
    (view) => new CompositionUndoPluginValue(view, undoManager),
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
