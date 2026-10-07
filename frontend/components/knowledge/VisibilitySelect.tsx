"use client";

import { useTranslations } from "next-intl";

import { Combobox } from "@/components/ui/Combobox";
import type { Visibility } from "@/lib/api/types";
import { VISIBILITY_ICONS } from "@/lib/optionIcons";

const INHERIT = "INHERIT";

interface VisibilitySelectProps {
  /** null = not explicitly chosen: inherits `inheritFrom` when given, else
   * the backend's PUBLIC default. Existing items always pass their own value. */
  value: Visibility | null;
  onChange: (value: Visibility | null) => void;
  /** The selected project's visibility, on a creation form with a project
   * picked - adds the "Inherit from project" option. */
  inheritFrom?: Visibility | null;
  placeholder: string;
}

/** What a VisibilitySelect's value actually resolves to once saved -
 * mirrors backend services.create_with_links's inheritance rule. */
export function effectiveVisibility(value: Visibility | null, inheritFrom?: Visibility | null): Visibility {
  return value ?? inheritFrom ?? "PUBLIC";
}

export function VisibilitySelect({ value, onChange, inheritFrom, placeholder }: VisibilitySelectProps) {
  const t = useTranslations("creation");
  const canInherit = inheritFrom != null;

  const options = [
    ...(canInherit
      ? [
          {
            value: INHERIT,
            label: t("visibilityInherit", { visibility: t(`visibility${inheritFrom}`) }),
            icon: "folder",
          },
        ]
      : []),
    ...(["PUBLIC", "RESTRICTED"] as Visibility[]).map((option) => ({
      value: option,
      label: t(`visibility${option}`),
      ...VISIBILITY_ICONS[option],
    })),
  ];

  return (
    <Combobox
      placeholder={placeholder}
      options={options}
      value={value ?? (canInherit ? INHERIT : "PUBLIC")}
      onChange={(next) => onChange(next === INHERIT ? null : (next as Visibility))}
    />
  );
}
