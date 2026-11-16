"use client";

interface TitleInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Also used as the accessible name, since there's no visible label. */
  placeholder: string;
  /** Put the cursor here on mount. Pass true on create forms: the borderless
   * title reads as a heading, so people otherwise start typing in the body
   * below and miss that the title is a field. Leave it off on edit forms. */
  autoFocus?: boolean;
  disabled?: boolean;
}

/** The large, borderless title/name field at the top of the create/edit forms. */
export function TitleInput({ value, onChange, placeholder, autoFocus = false, disabled = false }: TitleInputProps) {
  return (
    <input
      autoFocus={autoFocus}
      aria-label={placeholder}
      disabled={disabled}
      className="w-full font-headline-lg text-headline-lg font-bold border-none bg-transparent placeholder:text-on-surface-variant/50 focus:ring-0 p-0 text-on-surface outline-none"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
