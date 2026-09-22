import type { ThemePreference } from "./theme.js";

type ThemePickerProps = {
  value: ThemePreference;
  onChange: (theme: ThemePreference) => void;
};

const THEMES: readonly {
  id: ThemePreference;
  label: string;
  swatch: string;
}[] = [
  { id: "system", label: "System", swatch: "system" },
  { id: "warm-paper", label: "Warm Paper", swatch: "warm-paper" },
  { id: "floe", label: "Floe", swatch: "floe" },
  { id: "polar-night", label: "Polar Night", swatch: "polar-night" },
  { id: "charcoal", label: "Charcoal", swatch: "charcoal" },
];

export function ThemePicker({ value, onChange }: ThemePickerProps) {
  return (
    <details className="theme-picker">
      <summary className="footer-action">Theme</summary>
      <div className="theme-menu" role="menu" aria-label="Theme">
        {THEMES.map((theme) => (
          <button
            className="theme-option"
            type="button"
            role="menuitemradio"
            aria-checked={theme.id === value}
            key={theme.id}
            onClick={(event) => {
              onChange(theme.id);
              event.currentTarget
                .closest("details")
                ?.removeAttribute("open");
            }}
          >
            <span className="theme-swatch" data-theme-swatch={theme.swatch} />
            <span>{theme.label}</span>
            <span className="theme-check" aria-hidden="true">
              {theme.id === value ? "✓" : ""}
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}
