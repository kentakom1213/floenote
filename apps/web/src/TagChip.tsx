import type { TagColor } from "@floe-note/document";

type TagChipProps = {
  tag: string;
  color: TagColor;
  compact?: boolean;
};

export function TagChip({
  tag,
  color,
  compact = false,
}: TagChipProps) {
  return (
    <span
      className={compact ? "tag-chip tag-chip-compact" : "tag-chip"}
      data-tag-color={color}
      title={compact ? tag : undefined}
    >
      <span className="tag-chip-label">{tag}</span>
    </span>
  );
}
