import {
  TAG_COLORS,
  type NoteProject,
  type TagColor,
} from "@floe-note/document";

export const RANDOM_TAG_COLORS = TAG_COLORS.filter(
  (color): color is Exclude<TagColor, "gray"> => color !== "gray",
);

export function pickRandomTagColor(
  random: () => number = Math.random,
): Exclude<TagColor, "gray"> {
  const value = random();
  const index = Math.min(
    RANDOM_TAG_COLORS.length - 1,
    Math.max(0, Math.floor(value * RANDOM_TAG_COLORS.length)),
  );
  return RANDOM_TAG_COLORS[index] ?? "blue";
}

export function assignRandomTagColorIfMissing(
  project: Pick<NoteProject, "hasTagColor" | "setTagColor">,
  tag: string,
  random: () => number = Math.random,
): TagColor | null {
  if (project.hasTagColor(tag)) return null;

  const color = pickRandomTagColor(random);
  project.setTagColor(tag, color);
  return color;
}
