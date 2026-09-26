import { TAG_COLORS, type TagColor } from "@floe-note/document";

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
