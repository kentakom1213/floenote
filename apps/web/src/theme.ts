import { useEffect, useState } from "react";

export type ThemePair = "warm" | "floe";
export type ThemeMode = "system" | "light" | "dark";

export type ThemePreference = {
  pair: ThemePair;
  mode: ThemeMode;
};

export type ResolvedTheme =
  | "warm-paper"
  | "charcoal"
  | "floe"
  | "polar-night";

const STORAGE_KEY = "floe-note-theme";

const DEFAULT_THEME_PREFERENCE: ThemePreference = {
  pair: "floe",
  mode: "system",
};

function readThemePreference(): ThemePreference {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return { ...DEFAULT_THEME_PREFERENCE };

  const legacy = migrateLegacyThemePreference(stored);
  if (legacy) return legacy;

  try {
    const parsed = JSON.parse(stored) as unknown;
    return normalizeThemePreference(parsed);
  } catch {
    return { ...DEFAULT_THEME_PREFERENCE };
  }
}

function migrateLegacyThemePreference(stored: string): ThemePreference | null {
  switch (stored) {
    case "warm-paper":
      return { pair: "warm", mode: "light" };
    case "charcoal":
      return { pair: "warm", mode: "dark" };
    case "floe":
      return { pair: "floe", mode: "light" };
    case "polar-night":
      return { pair: "floe", mode: "dark" };
    case "system":
      return { pair: "floe", mode: "system" };
    default:
      return null;
  }
}

function normalizeThemePreference(value: unknown): ThemePreference {
  if (!isRecord(value)) return { ...DEFAULT_THEME_PREFERENCE };

  return {
    pair: value.pair === "warm" || value.pair === "floe" ? value.pair : "floe",
    mode:
      value.mode === "system" || value.mode === "light" || value.mode === "dark"
        ? value.mode
        : "system",
  };
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  const dark =
    preference.mode === "dark" ||
    (preference.mode === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  if (preference.pair === "warm") {
    return dark ? "charcoal" : "warm-paper";
  }

  return dark ? "polar-night" : "floe";
}

function applyTheme(preference: ThemePreference): void {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme =
    resolved === "polar-night" || resolved === "charcoal" ? "dark" : "light";
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
      if (preference.mode === "system") applyTheme(preference);
    };

    applyTheme(preference);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
    media.addEventListener("change", handleSystemThemeChange);

    return () => media.removeEventListener("change", handleSystemThemeChange);
  }, [preference]);

  return [preference, setPreference];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
