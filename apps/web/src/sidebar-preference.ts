export const DEFAULT_SIDEBAR_WIDTH = 276;
export const MIN_SIDEBAR_WIDTH = 248;
export const MAX_SIDEBAR_WIDTH = 420;

const STORAGE_KEY = "floe-note-sidebar";

export type SidebarPreference = {
  width: number;
  collapsed: boolean;
};

export function readSidebarPreference(): SidebarPreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaultPreference();

    const parsed = JSON.parse(stored) as Partial<SidebarPreference>;
    return {
      width: normalizeSidebarWidth(parsed.width),
      collapsed: parsed.collapsed === true,
    };
  } catch {
    return defaultPreference();
  }
}

export function writeSidebarPreference(
  preference: SidebarPreference,
): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        width: normalizeSidebarWidth(preference.width),
        collapsed: preference.collapsed,
      }),
    );
  } catch {
    // Layout preferences are best-effort only.
  }
}

export function clearSidebarPreference(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Layout preferences are best-effort only.
  }
}

export function normalizeSidebarWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }

  return Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, Math.round(value)),
  );
}

function defaultPreference(): SidebarPreference {
  return {
    width: DEFAULT_SIDEBAR_WIDTH,
    collapsed: false,
  };
}
