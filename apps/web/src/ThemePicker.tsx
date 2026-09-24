import type {
  ThemeMode,
  ThemePair,
  ThemePreference,
} from "./theme.js";

type ThemePickerProps = {
  value: ThemePreference;
  onChange: (theme: ThemePreference) => void;
};

const THEME_PAIRS: readonly {
  id: ThemePair;
  label: string;
  description: string;
  light: "warm-paper" | "floe";
  dark: "charcoal" | "polar-night";
}[] = [
  {
    id: "floe",
    label: "Floe",
    description: "Cool ice tones in light and dark.",
    light: "floe",
    dark: "polar-night",
  },
  {
    id: "warm",
    label: "Warm",
    description: "Soft paper tones with a charcoal dark mode.",
    light: "warm-paper",
    dark: "charcoal",
  },
];

const MODES: readonly { id: ThemeMode; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export function ThemePicker({ value, onChange }: ThemePickerProps) {
  return (
    <div className="appearance-picker">
      <div className="theme-preview-grid" role="radiogroup" aria-label="Theme">
        {THEME_PAIRS.map((pair) => (
          <button
            className="theme-preview-card theme-pair-card"
            data-selected={pair.id === value.pair}
            type="button"
            role="radio"
            aria-checked={pair.id === value.pair}
            key={pair.id}
            onClick={() => onChange({ ...value, pair: pair.id })}
          >
            <span className="theme-pair-preview" aria-hidden="true">
              <span
                className="theme-preview-surface"
                data-theme-preview={pair.light}
              >
                <span className="theme-preview-sidebar" />
                <span className="theme-preview-page">
                  <span className="theme-preview-title" />
                  <span className="theme-preview-line" />
                  <span className="theme-preview-line short" />
                </span>
              </span>
              <span
                className="theme-preview-surface"
                data-theme-preview={pair.dark}
              >
                <span className="theme-preview-sidebar" />
                <span className="theme-preview-page">
                  <span className="theme-preview-title" />
                  <span className="theme-preview-line" />
                  <span className="theme-preview-line short" />
                </span>
              </span>
            </span>
            <span className="theme-preview-copy">
              <strong>{pair.label}</strong>
              <small>{pair.description}</small>
            </span>
            <span className="theme-preview-check" aria-hidden="true">
              {pair.id === value.pair ? "✓" : ""}
            </span>
          </button>
        ))}
      </div>

      <div className="theme-mode-picker" role="radiogroup" aria-label="Theme mode">
        {MODES.map((mode) => (
          <button
            className="theme-mode-option"
            data-selected={value.mode === mode.id}
            type="button"
            role="radio"
            aria-checked={value.mode === mode.id}
            key={mode.id}
            onClick={() => onChange({ ...value, mode: mode.id })}
          >
            {mode.label}
          </button>
        ))}
      </div>
    </div>
  );
}
