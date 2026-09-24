import {
  Prec,
  Transaction,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  ViewPlugin,
  type PluginValue,
  type ViewUpdate,
} from "@codemirror/view";
import type { UndoManager } from "loro-crdt";

export const EDITOR_UNDO_MAX_STEPS = 500;
export const EDITOR_UNDO_GROUP_DELAY_MS = 1000;
export const EDITOR_UNDO_MERGE_INTERVAL_MS = 0;

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

export type EditorHistoryLifecycle = {
  beginEditorHistoryGroup: () => void;
  endEditorHistoryGroup: () => void;
  flushEditorHistoryBoundary: () => void;
};

export type EditorUndoEventKind =
  | "typing"
  | "deleting"
  | "composition"
  | "atomic"
  | "selection"
  | "none";

type GroupedEditorUndoEventKind = Extract<
  EditorUndoEventKind,
  "typing" | "deleting" | "composition"
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

export function classifyEditorUndoEvent(
  transactions: readonly Transaction[],
): EditorUndoEventKind {
  const documentTransactions = transactions.filter(
    (transaction) => transaction.docChanged,
  );

  if (documentTransactions.length > 0) {
    if (
      documentTransactions.every((transaction) =>
        transaction.isUserEvent("input.type.compose"),
      )
    ) {
      return "composition";
    }

    if (
      documentTransactions.every((transaction) =>
        transaction.isUserEvent("input.type"),
      )
    ) {
      return "typing";
    }

    if (
      documentTransactions.every((transaction) =>
        transaction.isUserEvent("delete"),
      )
    ) {
      return "deleting";
    }

    // Enter/Shift-Enter are emitted by CodeMirror as userEvent "input".
    // Paste/drop/completion and structural editor commands also belong here.
    // They are intentionally kept as one action per undo step.
    return "atomic";
  }

  if (
    transactions.some((transaction) => transaction.isUserEvent("select"))
  ) {
    return "selection";
  }

  return "none";
}

class EditorUndoGroupController {
  #activeKind: GroupedEditorUndoEventKind | null = null;
  #idleTimer: number | null = null;
  #compositionEndFrame: number | null = null;

  constructor(
    private readonly view: EditorView,
    private readonly undoManager: UndoGroupingManager,
    private readonly lifecycle: EditorHistoryLifecycle,
  ) {}

  beforeUpdate(update: ViewUpdate): void {
    const kind = classifyEditorUndoEvent(update.transactions);

    if (kind === "none") return;

    if (kind === "selection" || kind === "atomic") {
      this.#closeGroup();
      this.lifecycle.flushEditorHistoryBoundary();
      return;
    }

    if (this.#activeKind !== kind) {
      this.#closeGroup();
      this.lifecycle.flushEditorHistoryBoundary();
      this.#openGroup(kind);
    }
  }

  afterUpdate(update: ViewUpdate): void {
    const kind = classifyEditorUndoEvent(update.transactions);
    if (!isGroupedKind(kind) || this.#activeKind !== kind) return;

    if (kind === "composition") {
      if (!this.view.compositionStarted) {
        this.#cancelCompositionEndFrame();
        this.#closeGroup();
      }
      return;
    }

    this.#scheduleIdleClose();
  }

  onCompositionStart(): void {
    this.#cancelCompositionEndFrame();
    this.#closeGroup();
    this.lifecycle.flushEditorHistoryBoundary();
    this.#openGroup("composition");
  }

  onCompositionEnd(): void {
    if (
      this.#activeKind !== "composition" ||
      this.#compositionEndFrame !== null
    ) {
      return;
    }

    const win = this.view.dom.ownerDocument.defaultView;
    if (!win) {
      this.#closeGroup();
      return;
    }

    // CodeMirror may flush the final composition DOM mutation in a microtask
    // or, on Android, in requestAnimationFrame. Its built-in compositionend
    // observer runs before plugin event handlers, so this frame is queued
    // after CodeMirror's pending composition flush.
    this.#compositionEndFrame = win.requestAnimationFrame(() => {
      this.#compositionEndFrame = null;
      if (!this.view.compositionStarted) {
        this.#closeGroup();
      }
    });
  }

  destroy(): void {
    this.#closeGroup();
  }

  closeForExternalBodyMutation(): void {
    this.#closeGroup();
    this.lifecycle.flushEditorHistoryBoundary();
  }

  #openGroup(kind: GroupedEditorUndoEventKind): void {
    this.lifecycle.beginEditorHistoryGroup();
    this.undoManager.groupStart();
    this.#activeKind = kind;
  }

  #closeGroup(): void {
    this.#cancelIdleClose();
    this.#cancelCompositionEndFrame();

    if (this.#activeKind === null) return;

    this.undoManager.groupEnd();
    this.lifecycle.endEditorHistoryGroup();
    this.#activeKind = null;
  }

  #scheduleIdleClose(): void {
    this.#cancelIdleClose();

    const win = this.view.dom.ownerDocument.defaultView;
    if (!win) {
      this.#closeGroup();
      return;
    }

    this.#idleTimer = win.setTimeout(() => {
      this.#idleTimer = null;
      this.#closeGroup();
    }, EDITOR_UNDO_GROUP_DELAY_MS);
  }

  #cancelIdleClose(): void {
    if (this.#idleTimer === null) return;
    this.view.dom.ownerDocument.defaultView?.clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
  }

  #cancelCompositionEndFrame(): void {
    if (this.#compositionEndFrame === null) return;
    this.view.dom.ownerDocument.defaultView?.cancelAnimationFrame(
      this.#compositionEndFrame,
    );
    this.#compositionEndFrame = null;
  }
}

class BeforeUndoGroupingPlugin implements PluginValue {
  constructor(private readonly controller: EditorUndoGroupController) {}

  update(update: ViewUpdate): void {
    this.controller.beforeUpdate(update);
  }

  onCompositionStart(): void {
    this.controller.onCompositionStart();
  }

  onCompositionEnd(): void {
    this.controller.onCompositionEnd();
  }
}

class AfterUndoGroupingPlugin implements PluginValue {
  constructor(private readonly controller: EditorUndoGroupController) {}

  update(update: ViewUpdate): void {
    this.controller.afterUpdate(update);
  }

  destroy(): void {
    this.controller.destroy();
  }
}

export function editorUndoGrouping(
  undoManager: UndoManager,
  lifecycle: EditorHistoryLifecycle,
): {
  before: Extension;
  after: Extension;
  closeCurrentGroup: () => void;
} {
  const controllers = new WeakMap<EditorView, EditorUndoGroupController>();
  let currentController: EditorUndoGroupController | null = null;

  const getController = (view: EditorView): EditorUndoGroupController => {
    const existing = controllers.get(view);
    if (existing) return existing;

    const controller = new EditorUndoGroupController(
      view,
      undoManager,
      lifecycle,
    );
    controllers.set(view, controller);
    currentController = controller;
    return controller;
  };

  const before = ViewPlugin.define(
    (view) => new BeforeUndoGroupingPlugin(getController(view)),
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

  const after = ViewPlugin.define(
    (view) => new AfterUndoGroupingPlugin(getController(view)),
  );

  return {
    before,
    after,
    closeCurrentGroup: () => currentController?.closeForExternalBodyMutation(),
  };
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

function isGroupedKind(
  kind: EditorUndoEventKind,
): kind is GroupedEditorUndoEventKind {
  return (
    kind === "typing" ||
    kind === "deleting" ||
    kind === "composition"
  );
}
