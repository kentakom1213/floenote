import type { ThemePreference } from "./theme.js";

type ThemePickerProps = {
  value: ThemePreference;
  onChange: (theme: ThemePreference) => void;
};

const THEMES: readonly {
  id: Exclude<ThemePreference, "system">;
  label: string;
  description: string;
}[] = [
  {
    id: "warm-paper",
    label: "Warm Paper",
    description: "Soft ivory and muted orange.",
  },
  {
    id: "floe",
    label: "Floe",
    description: "Cool ice tones with a quiet blue accent.",
  },
  {
    id: "polar-night",
    label: "Polar Night",
    description: "Deep navy for low-light writing.",
  },
  {
    id: "charcoal",
    label: "Charcoal",
    description: "Neutral dark surfaces with warm orange.",
  },
];

export function ThemePicker({ value, onChange }: ThemePickerProps) {
  return (
    <div className="appearance-picker" role="radiogroup" aria-label="Theme">
      <div className="theme-preview-grid">
        {THEMES.map((theme) => (
          <button
            className="theme-preview-card"
            data-selected={theme.id === value}
            type="button"
            role="radio"
            aria-checked={theme.id === value}
            key={theme.id}
            onClick={() => onChange(theme.id)}
          >
            <span
              className="theme-preview-surface"
              data-theme-preview={theme.id}
              aria-hidden="true"
            >
              <span className="theme-preview-sidebar" />
              <span className="theme-preview-page">
                <span className="theme-preview-title" />
                <span className="theme-preview-line" />
                <span className="theme-preview-line short" />
              </span>
            </span>
            <span className="theme-preview-copy">
              <strong>{theme.label}</strong>
              <small>{theme.description}</small>
            </span>
            <span className="theme-preview-check" aria-hidden="true">
              {theme.id === value ? "✓" : ""}
            </span>
          </button>
        ))}
      </div>

      <button
        className="system-theme-option"
        data-selected={value === "system"}
        type="button"
        role="radio"
        aria-checked={value === "system"}
        onClick={() => onChange("system")}
      >
        <span>
          <strong>Follow system</strong>
          <small>Warm Paper in light mode, Polar Night in dark mode.</small>
        </span>
        <span className="theme-preview-check" aria-hidden="true">
          {value === "system" ? "✓" : ""}
        </span>
      </button>
    </div>
  );
}
