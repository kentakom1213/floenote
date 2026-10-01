export type PreviewAnchorPosition = {
  sourceStart: number;
  sourceEnd: number;
  top: number;
  bottom: number;
};

export function interpolatePreviewScrollTop(
  anchors: readonly PreviewAnchorPosition[],
  sourceLine: number,
  maxScrollTop: number,
): number {
  const points = toInterpolationPoints(anchors);
  if (points.length === 0 || maxScrollTop <= 0) return 0;

  const line = Math.max(1, sourceLine);
  const first = points[0];
  if (!first) return 0;
  if (line <= first.sourceLine) {
    return clamp(first.top, 0, maxScrollTop);
  }

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current || line > current.sourceLine) continue;

    const sourceSpan = Math.max(1, current.sourceLine - previous.sourceLine);
    const ratio = clamp(
      (line - previous.sourceLine) / sourceSpan,
      0,
      1,
    );
    return clamp(
      previous.top + (current.top - previous.top) * ratio,
      0,
      maxScrollTop,
    );
  }

  const last = points[points.length - 1];
  return clamp(last?.top ?? 0, 0, maxScrollTop);
}

export function interpolateSourceLine(
  anchors: readonly PreviewAnchorPosition[],
  scrollTop: number,
): number {
  const points = toInterpolationPoints(anchors);
  if (points.length === 0) return 1;

  const top = Math.max(0, scrollTop);
  const first = points[0];
  if (!first) return 1;
  if (top <= first.top) return first.sourceLine;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current || top > current.top) continue;

    const visualSpan = current.top - previous.top;
    if (visualSpan <= 0) return current.sourceLine;

    const ratio = clamp((top - previous.top) / visualSpan, 0, 1);
    return Math.max(
      1,
      Math.round(
        previous.sourceLine +
          (current.sourceLine - previous.sourceLine) * ratio,
      ),
    );
  }

  return points[points.length - 1]?.sourceLine ?? 1;
}

export function syncPreviewToSourceLine(
  previewPane: HTMLElement,
  sourceLine: number,
): void {
  const anchors = readPreviewAnchors(previewPane);
  const maxScrollTop = Math.max(
    0,
    previewPane.scrollHeight - previewPane.clientHeight,
  );
  previewPane.scrollTop = interpolatePreviewScrollTop(
    anchors,
    sourceLine,
    maxScrollTop,
  );
}

export function sourceLineAtPreviewTop(
  previewPane: HTMLElement,
): number | null {
  const anchors = readPreviewAnchors(previewPane);
  if (anchors.length === 0) return null;

  return interpolateSourceLine(anchors, previewPane.scrollTop);
}

function readPreviewAnchors(
  previewPane: HTMLElement,
): PreviewAnchorPosition[] {
  const paneRect = previewPane.getBoundingClientRect();

  return Array.from(
    previewPane.querySelectorAll<HTMLElement>(
      "[data-floe-source-start][data-floe-source-end]",
    ),
  ).flatMap((element) => {
    const sourceStart = Number(element.dataset.floeSourceStart);
    const sourceEnd = Number(element.dataset.floeSourceEnd);
    if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd)) {
      return [];
    }

    const rect = element.getBoundingClientRect();
    return [
      {
        sourceStart,
        sourceEnd,
        top: rect.top - paneRect.top + previewPane.scrollTop,
        bottom: rect.bottom - paneRect.top + previewPane.scrollTop,
      },
    ];
  });
}

function toInterpolationPoints(
  anchors: readonly PreviewAnchorPosition[],
): Array<{ sourceLine: number; top: number }> {
  if (anchors.length === 0) return [];

  const points = anchors.map((anchor) => ({
    sourceLine: anchor.sourceStart,
    top: anchor.top,
  }));
  const last = anchors[anchors.length - 1];

  if (
    last &&
    (last.sourceEnd > last.sourceStart || last.bottom > last.top)
  ) {
    points.push({
      sourceLine: Math.max(last.sourceStart, last.sourceEnd),
      top: Math.max(last.top, last.bottom),
    });
  }

  return points;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
