import { indentLess, indentMore } from "@codemirror/commands";
import {
  indentString,
  syntaxTree,
} from "@codemirror/language";
import {
  countColumn,
  type EditorState,
  type StateCommand,
} from "@codemirror/state";
import { keymap } from "@codemirror/view";

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

type ListLineContext = {
  item: SyntaxNode;
  mark: SyntaxNode;
  lineFrom: number;
};

const indentMarkdownMore: StateCommand = (target) => {
  const context = listLineContext(target.state);
  if (!context) {
    return indentMore(target);
  }

  const previousItem = previousListItem(context.item);
  const nestingWidth = previousItem
    ? listItemContentIndent(target.state, previousItem)
    : null;
  if (nestingWidth === null) {
    return indentMore(target);
  }

  return changeListIndent(target, context, nestingWidth, "input.indent");
};

const indentMarkdownLess: StateCommand = (target) => {
  const context = listLineContext(target.state);
  if (!context) {
    return indentLess(target);
  }

  const parentItem = parentListItem(context.item);
  const parentMarkerColumn = parentItem
    ? listItemMarkerColumn(target.state, parentItem)
    : null;
  if (parentMarkerColumn === null) {
    return indentLess(target);
  }

  return setListIndent(
    target,
    context,
    parentMarkerColumn,
    "delete.dedent",
  );
};

export const floeMarkdownIndentation = keymap.of([
  {
    key: "Tab",
    run: indentMarkdownMore,
  },
  {
    key: "Shift-Tab",
    run: indentMarkdownLess,
  },
]);

function listLineContext(state: EditorState): ListLineContext | null {
  if (state.selection.ranges.length !== 1) {
    return null;
  }

  const range = state.selection.main;
  const fromLine = state.doc.lineAt(range.from);
  const toLine = state.doc.lineAt(range.to);
  if (fromLine.number !== toLine.number) {
    return null;
  }

  const side = range.head === fromLine.from ? 1 : -1;
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(
      range.head,
      side,
    );
    node;
    node = node.parent
  ) {
    if (node.name !== "ListItem") {
      continue;
    }

    const mark = listMarkOnLine(node, fromLine.from, fromLine.to);
    if (!mark) {
      continue;
    }

    const prefix = state.sliceDoc(fromLine.from, mark.from);
    if (!/^[ \t]*$/.test(prefix)) {
      return null;
    }

    return {
      item: node,
      mark,
      lineFrom: fromLine.from,
    };
  }

  return null;
}

function listMarkOnLine(
  item: SyntaxNode,
  lineFrom: number,
  lineTo: number,
): SyntaxNode | null {
  for (let child = item.firstChild; child; child = child.nextSibling) {
    if (
      child.name === "ListMark" &&
      child.from >= lineFrom &&
      child.to <= lineTo
    ) {
      return child;
    }
  }
  return null;
}

function previousListItem(item: SyntaxNode): SyntaxNode | null {
  for (let sibling = item.prevSibling; sibling; sibling = sibling.prevSibling) {
    if (sibling.name === "ListItem") {
      return sibling;
    }
  }
  return null;
}

function parentListItem(item: SyntaxNode): SyntaxNode | null {
  for (let parent = item.parent; parent; parent = parent.parent) {
    if (parent.name === "ListItem") {
      return parent;
    }
  }
  return null;
}

function listItemContentIndent(
  state: EditorState,
  item: SyntaxNode,
): number | null {
  const mark = firstListMark(item);
  if (!mark) {
    return null;
  }

  const line = state.doc.lineAt(mark.from);
  const markerPrefix = state.sliceDoc(line.from, mark.from);
  if (!/^[ \t]*$/.test(markerPrefix)) {
    return null;
  }

  let contentFrom = mark.to;
  const contentNode = mark.nextSibling;
  if (
    contentNode &&
    contentNode.from >= mark.to &&
    state.doc.lineAt(contentNode.from).number === line.number
  ) {
    contentFrom = contentNode.from;
  } else {
    while (contentFrom < line.to) {
      const character = state.sliceDoc(contentFrom, contentFrom + 1);
      if (character !== " " && character !== "\t") {
        break;
      }
      contentFrom += 1;
    }
  }

  const markerColumn = countColumn(markerPrefix, state.tabSize);
  const contentColumn = countColumn(
    state.sliceDoc(line.from, contentFrom),
    state.tabSize,
  );
  const width = contentColumn - markerColumn;
  return width > 0 ? width : null;
}

function listItemMarkerColumn(
  state: EditorState,
  item: SyntaxNode,
): number | null {
  const mark = firstListMark(item);
  if (!mark) {
    return null;
  }

  const line = state.doc.lineAt(mark.from);
  const markerPrefix = state.sliceDoc(line.from, mark.from);
  if (!/^[ \t]*$/.test(markerPrefix)) {
    return null;
  }

  return countColumn(markerPrefix, state.tabSize);
}

function firstListMark(item: SyntaxNode): SyntaxNode | null {
  for (let child = item.firstChild; child; child = child.nextSibling) {
    if (child.name === "ListMark") {
      return child;
    }
  }
  return null;
}

function changeListIndent(
  target: Parameters<StateCommand>[0],
  context: ListLineContext,
  delta: number,
  userEvent: string,
): boolean {
  const currentIndent = target.state.sliceDoc(
    context.lineFrom,
    context.mark.from,
  );
  const currentColumn = countColumn(currentIndent, target.state.tabSize);
  return setListIndent(
    target,
    context,
    Math.max(0, currentColumn + delta),
    userEvent,
  );
}

function setListIndent(
  target: Parameters<StateCommand>[0],
  context: ListLineContext,
  nextColumn: number,
  userEvent: string,
): boolean {
  const { state, dispatch } = target;
  if (state.readOnly) {
    return false;
  }

  const currentIndent = state.sliceDoc(context.lineFrom, context.mark.from);
  const currentColumn = countColumn(currentIndent, state.tabSize);
  if (nextColumn === currentColumn) {
    return true;
  }

  dispatch(
    state.update({
      changes: {
        from: context.lineFrom,
        to: context.mark.from,
        insert: indentString(state, nextColumn),
      },
      scrollIntoView: true,
      userEvent,
    }),
  );
  return true;
}
