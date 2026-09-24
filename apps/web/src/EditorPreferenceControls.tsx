import type {
  EditorContentWidth,
  EditorLineHeight,
  EditorPreference,
  EditorTextSize,
} from "./editor-preference.js";

type EditorPreferenceControlsProps = {
  value: EditorPreference;
  onChange: (preference: EditorPreference) => void;
};

const TEXT_SIZES: readonly {
  value: EditorTextSize;
  label: string;
  detail: string;
}[] = [
  { value: "small", label: "Small", detail: "14 px" },
  { value: "default", label: "Default", detail: "16 px" },
  { value: "large", label: "Large", detail: "18 px" },
  { value: "extra-large", label: "Extra large", detail: "20 px" },
];

const LINE_HEIGHTS: readonly {
  value: EditorLineHeight;
  label: string;
  detail: string;
}[] = [
  { value: "compact", label: "Compact", detail: "1.45" },
  { value: "default", label: "Default", detail: "1.62" },
  { value: "relaxed", label: "Relaxed", detail: "1.8" },
];

const CONTENT_WIDTHS: readonly {
  value: EditorContentWidth;
  label: string;
  detail: string;
}[] = [
  { value: "narrow", label: "Narrow", detail: "680 px" },
  { value: "default", label: "Default", detail: "820 px" },
  { value: "wide", label: "Wide", detail: "1000 px" },
];

export function EditorPreferenceControls({
  value,
  onChange,
}: EditorPreferenceControlsProps) {
  return (
    <div className="editor-preference-controls">
      <fieldset className="editor-preference-fieldset">
        <legend>Text size</legend>
        <div
          className="editor-preference-options editor-preference-options-four"
        >
          {TEXT_SIZES.map((option) => (
            <label className="editor-preference-option" key={option.value}>
              <input
                type="radio"
                name="editor-text-size"
                value={option.value}
                checked={value.textSize === option.value}
                onChange={() =>
                  onChange({ ...value, textSize: option.value })
                }
              />
              <span>{option.label}</span>
              <small>{option.detail}</small>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="editor-preference-fieldset">
        <legend>Line height</legend>
        <div className="editor-preference-options">
          {LINE_HEIGHTS.map((option) => (
            <label className="editor-preference-option" key={option.value}>
              <input
                type="radio"
                name="editor-line-height"
                value={option.value}
                checked={value.lineHeight === option.value}
                onChange={() =>
                  onChange({ ...value, lineHeight: option.value })
                }
              />
              <span>{option.label}</span>
              <small>{option.detail}</small>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="editor-preference-fieldset">
        <legend>Content width</legend>
        <div className="editor-preference-options">
          {CONTENT_WIDTHS.map((option) => (
            <label className="editor-preference-option" key={option.value}>
              <input
                type="radio"
                name="editor-content-width"
                value={option.value}
                checked={value.contentWidth === option.value}
                onChange={() =>
                  onChange({ ...value, contentWidth: option.value })
                }
              />
              <span>{option.label}</span>
              <small>{option.detail}</small>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
