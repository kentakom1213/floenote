export type MarkdownTaskDescriptor = {
  id: string;
  marker: string;
  checked: boolean;
  sourceStart: number;
  sourceEnd: number;
  lineStart: number;
  lineEnd: number;
  sourceLine: string;
  sourceMarker: "[ ]" | "[x]" | "[X]";
  label: string;
};

export type ExtractedMarkdownTasks = {
  markdown: string;
  tasks: MarkdownTaskDescriptor[];
};

const TASK_MARKER_PREFIX = "\uE200FLOETASK";
const TASK_MARKER_SUFFIX = "\uE201";
const TASK_LINE =
  /^((?:(?:[ \t]*>[ \t]*)*)[ \t]*[-+*][ \t]+)\[([ xX])\](?=$|[ \t])/u;
const FENCE_LINE =
  /^(?:(?:[ \t]*>[ \t]*)*)[ \t]*(`{3,}|~{3,})/u;

export function extractMarkdownTasks(source: string): ExtractedMarkdownTasks {
  const tasks: MarkdownTaskDescriptor[] = [];
  const output: string[] = [];
  const lines = source.split("\n");
  const markerSalt = findUnusedMarkerSalt(source);
  let sourceOffset = 0;
  let fence: { char: string; length: number } | null = null;

  for (const line of lines) {
    const lineStart = sourceOffset;
    const lineEnd = lineStart + line.length;
    const fenceMatch = FENCE_LINE.exec(line);

    if (fenceMatch) {
      const token = fenceMatch[1] ?? "";
      const char = token[0] ?? "";

      if (!fence) {
        fence = { char, length: token.length };
      } else if (char === fence.char && token.length >= fence.length) {
        fence = null;
      }

      output.push(line);
      sourceOffset = lineEnd + 1;
      continue;
    }

    if (fence) {
      output.push(line);
      sourceOffset = lineEnd + 1;
      continue;
    }

    const taskMatch = TASK_LINE.exec(line);
    if (!taskMatch) {
      output.push(line);
      sourceOffset = lineEnd + 1;
      continue;
    }

    const prefix = taskMatch[1] ?? "";
    const state = taskMatch[2] ?? " ";
    const sourceMarker = `[${state}]` as "[ ]" | "[x]" | "[X]";
    const sourceStart = lineStart + prefix.length;
    const sourceEnd = sourceStart + sourceMarker.length;
    const id = String(tasks.length);
    const marker =
      `${TASK_MARKER_PREFIX}${markerSalt}:${id}${TASK_MARKER_SUFFIX}`;

    tasks.push({
      id,
      marker,
      checked: state === "x" || state === "X",
      sourceStart,
      sourceEnd,
      lineStart,
      lineEnd,
      sourceLine: line,
      sourceMarker,
      label: line.slice(prefix.length + sourceMarker.length).trim(),
    });

    output.push(
      line.slice(0, prefix.length) +
        marker +
        line.slice(prefix.length + sourceMarker.length),
    );
    sourceOffset = lineEnd + 1;
  }

  return {
    markdown: output.join("\n"),
    tasks,
  };
}

function findUnusedMarkerSalt(source: string): number {
  let salt = 0;
  while (source.includes(`${TASK_MARKER_PREFIX}${salt}:`)) {
    salt += 1;
  }
  return salt;
}
