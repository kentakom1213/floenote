import { useEffect, useState } from "react";

export type ThemePreference =
  | "system"
  | "warm-paper"
  | "floe"
  | "polar-night"
  | "charcoal";

export type ResolvedTheme = Exclude<ThemePreference, "system">;

const STORAGE_KEY = "floe-note-theme";

const THEME_IDS = new Set<ThemePreference>([
  "system",
  "warm-paper",
  "floe",
  "polar-night",
  "charcoal",
]);

function readThemePreference(): ThemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored && THEME_IDS.has(stored as ThemePreference)
    ? (stored as ThemePreference)
    : "warm-paper";
}

function resolveSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "polar-night"
    : "warm-paper";
}

function applyTheme(preference: ThemePreference): void {
  document.documentElement.dataset.theme =
    preference === "system" ? resolveSystemTheme() : preference;
  document.documentElement.style.colorScheme =
    document.documentElement.dataset.theme === "polar-night" ||
    document.documentElement.dataset.theme === "charcoal"
      ? "dark"
      : "light";
}

export function clearThemePreference(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function useThemePreference(): [
  ThemePreference,
  (preference: ThemePreference) => void,
] {
  const [preference, setPreference] =
    useState<ThemePreference>(readThemePreference);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      if (preference === "system") applyTheme("system");
    };

    applyTheme(preference);
    window.localStorage.setItem(STORAGE_KEY, preference);
    media.addEventListener("change", handleSystemThemeChange);

    return () => media.removeEventListener("change", handleSystemThemeChange);
  }, [preference]);

  return [preference, setPreference];
}
