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
  if (anchors.length === 0 || maxScrollTop <= 0) return 0;

  const line = Math.max(1, sourceLine);
  const first = anchors[0];
  if (!first) return 0;

  if (line <= first.sourceStart) {
    return clamp(first.top, 0, maxScrollTop);
  }

  for (let index = 0; index < anchors.length; index += 1) {
    const current = anchors[index];
    if (!current) continue;

    const next = anchors[index + 1];

    if (line < current.sourceEnd) {
      const sourceSpan = Math.max(1, current.sourceEnd - current.sourceStart);
      const ratio = clamp(
        (line - current.sourceStart) / sourceSpan,
        0,
        1,
      );
      const visualEnd = next?.top ?? Math.max(current.bottom, current.top);
      return clamp(
        current.top + (visualEnd - current.top) * ratio,
        0,
        maxScrollTop,
      );
    }

    if (next && line < next.sourceStart) {
      const sourceSpan = Math.max(1, next.sourceStart - current.sourceEnd);
      const ratio = clamp((line - current.sourceEnd) / sourceSpan, 0, 1);
      return clamp(
        current.bottom + (next.top - current.bottom) * ratio,
        0,
        maxScrollTop,
      );
    }
  }

  const last = anchors[anchors.length - 1];
  return clamp(last?.top ?? 0, 0, maxScrollTop);
}

export function syncPreviewToSourceLine(
  previewPane: HTMLElement,
  sourceLine: number,
): void {
  const paneRect = previewPane.getBoundingClientRect();
  const anchors = Array.from(
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
