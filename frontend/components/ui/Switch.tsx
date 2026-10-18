"use client";

import type { ReactNode } from "react";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label (and accessible name) shown next to the switch. */
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

// Phone-settings style on/off switch (a pill with a sliding thumb) - use instead of a bare
// checkbox for immediate-effect toggles. Flips correctly in RTL.
export function Switch({ checked, onChange, label, description, disabled = false }: SwitchProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="min-w-0">
        <span className="block font-body-md text-body-md text-on-surface">{label}</span>
        {description && (
          <span className="block font-body-md text-body-md text-on-surface-variant">{description}</span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === "string" ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed ${
          checked ? "bg-primary" : "bg-outline"
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "ltr:translate-x-[1.5rem] rtl:-translate-x-[1.5rem]" : "translate-x-1 rtl:-translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
