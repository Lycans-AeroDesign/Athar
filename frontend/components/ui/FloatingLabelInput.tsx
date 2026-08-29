"use client";

import { useTranslations } from "next-intl";
import { forwardRef, useState, type InputHTMLAttributes } from "react";

import { Icon } from "./Icon";

interface FloatingLabelInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon?: string;
}

// Text input whose label sits inside the field (like a placeholder) and
// floats to the top-left on focus or once filled - driven entirely by CSS
// (:placeholder-shown / :focus via Tailwind's peer variants), so it works
// correctly with browser autofill too, not just React-tracked focus state.
// type="password" automatically gets a show/hide toggle.
export const FloatingLabelInput = forwardRef<HTMLInputElement, FloatingLabelInputProps>(
  function FloatingLabelInput({ label, icon, id, className, type, ...props }, ref) {
    const t = useTranslations("auth");
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = type === "password";
    const leftInset = icon ? "left-10" : "left-4";

    return (
      <div className="relative">
        {icon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-on-surface-variant peer-focus:text-primary">
            <Icon name={icon} size={18} />
          </div>
        )}
        <input
          ref={ref}
          id={id}
          placeholder=" "
          type={isPassword && showPassword ? "text" : type}
          className={`peer block w-full ${icon ? "pl-10" : "pl-4"} ${isPassword ? "pr-10" : "pr-4"} pt-7 pb-3 font-mono-sm text-mono-sm text-on-surface bg-surface-container border border-outline-variant rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none transition-colors ${className ?? ""}`}
          {...props}
        />
        <label
          htmlFor={id}
          className={`absolute ${leftInset} top-1/2 -translate-y-1/2 font-body-md text-body-md text-on-surface-variant pointer-events-none transition-all duration-150 peer-focus:top-2 peer-focus:translate-y-0 peer-focus:font-label-caps peer-focus:text-label-caps peer-focus:uppercase peer-focus:text-primary peer-not-placeholder-shown:top-2 peer-not-placeholder-shown:translate-y-0 peer-not-placeholder-shown:font-label-caps peer-not-placeholder-shown:text-label-caps peer-not-placeholder-shown:uppercase`}
        >
          {label}
        </label>
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            className="absolute inset-y-0 right-0 pr-3 flex items-center text-on-surface-variant hover:text-primary transition-colors"
            aria-label={showPassword ? t("hidePassword") : t("showPassword")}
          >
            <Icon name={showPassword ? "visibility_off" : "visibility"} size={18} />
          </button>
        )}
      </div>
    );
  },
);
