export type PreviewSourceAnchor = {
  sourceStart: number;
  sourceEnd: number;
  top: number;
};

type PreviewScrollPoint = {
  sourcePosition: number;
  top: number;
};

export function interpolatePreviewScrollTop(
  anchors: readonly PreviewSourceAnchor[],
  sourcePosition: number,
  maxScrollTop: number,
): number {
  const points = buildPreviewScrollPoints(anchors, maxScrollTop);
  if (points.length === 0 || maxScrollTop <= 0) return 0;

  const first = points[0];
  if (!first) return 0;

  const position = Math.max(1, sourcePosition);
  if (position <= first.sourcePosition) return 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current || position > current.sourcePosition) continue;

    const sourceSpan = current.sourcePosition - previous.sourcePosition;
    if (sourceSpan <= 0) {
      return clamp(current.top, 0, maxScrollTop);
    }

    const ratio = clamp(
      (position - previous.sourcePosition) / sourceSpan,
      0,
      1,
    );
    return clamp(
      previous.top + (current.top - previous.top) * ratio,
      0,
      maxScrollTop,
    );
  }

  return maxScrollTop;
}

export function interpolateSourcePositionFromPreviewScrollTop(
  anchors: readonly PreviewSourceAnchor[],
  scrollTop: number,
  maxScrollTop: number,
): number | null {
  const points = buildPreviewScrollPoints(anchors, maxScrollTop);
  const first = points[0];
  if (!first) return null;
  if (maxScrollTop <= 0 || scrollTop <= first.top) {
    return first.sourcePosition;
  }

  const top = clamp(scrollTop, 0, maxScrollTop);

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current || top > current.top) continue;

    const topSpan = current.top - previous.top;
    if (topSpan <= 0) {
      return current.sourcePosition;
    }

    const ratio = clamp((top - previous.top) / topSpan, 0, 1);
    return (
      previous.sourcePosition +
      (current.sourcePosition - previous.sourcePosition) * ratio
    );
  }

  return points[points.length - 1]?.sourcePosition ?? null;
}

export function syncPreviewToSourcePosition(
  previewPane: HTMLElement,
  sourcePosition: number,
): void {
  const anchors = readPreviewSourceAnchors(previewPane);
  if (anchors.length === 0) return;

  const maxScrollTop = Math.max(
    0,
    previewPane.scrollHeight - previewPane.clientHeight,
  );
  previewPane.scrollTop = interpolatePreviewScrollTop(
    anchors,
    sourcePosition,
    maxScrollTop,
  );
}

export function getPreviewViewportSourcePosition(
  previewPane: HTMLElement,
): number | null {
  const anchors = readPreviewSourceAnchors(previewPane);
  if (anchors.length === 0) return null;

  const maxScrollTop = Math.max(
    0,
    previewPane.scrollHeight - previewPane.clientHeight,
  );
  return interpolateSourcePositionFromPreviewScrollTop(
    anchors,
    previewPane.scrollTop,
    maxScrollTop,
  );
}

function buildPreviewScrollPoints(
  anchors: readonly PreviewSourceAnchor[],
  maxScrollTop: number,
): PreviewScrollPoint[] {
  if (anchors.length === 0) return [];

  const points = anchors.map((anchor) => ({
    sourcePosition: anchor.sourceStart,
    top: anchor.top,
  }));
  const first = points[0];
  const lastAnchor = anchors[anchors.length - 1];

  if (!first || !lastAnchor) return [];

  // The source and rendered document should share their natural endpoints,
  // even when preview padding shifts the first/last rendered block.
  first.top = 0;

  if (lastAnchor.sourceEnd > lastAnchor.sourceStart) {
    points.push({
      sourcePosition: lastAnchor.sourceEnd,
      top: maxScrollTop,
    });
  }

  return points;
}

function readPreviewSourceAnchors(
  previewPane: HTMLElement,
): PreviewSourceAnchor[] {
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
      },
    ];
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
