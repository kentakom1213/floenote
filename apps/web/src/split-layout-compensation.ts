export type HeadingAlignmentAnchor = {
  sourceLine: number;
  editorTop: number;
  previewTop: number;
};

export type HeadingAlignmentPlan = {
  editor: Array<{ line: number; height: number }>;
  preview: Array<{ line: number; height: number }>;
};

export function planHeadingAlignment(
  anchors: readonly HeadingAlignmentAnchor[],
  maxSpacer = 200,
  tolerance = 4,
): HeadingAlignmentPlan {
  const editor: HeadingAlignmentPlan["editor"] = [];
  const preview: HeadingAlignmentPlan["preview"] = [];
  let editorShift = 0;
  let previewShift = 0;

  for (const anchor of anchors) {
    const editorTop = anchor.editorTop + editorShift;
    const previewTop = anchor.previewTop + previewShift;
    const delta = previewTop - editorTop;

    if (Math.abs(delta) <= tolerance) continue;

    const height = Math.min(Math.abs(delta), maxSpacer);
    if (delta > 0) {
      editor.push({ line: anchor.sourceLine, height });
      editorShift += height;
    } else {
      preview.push({ line: anchor.sourceLine, height });
      previewShift += height;
    }
  }

  return { editor, preview };
}
