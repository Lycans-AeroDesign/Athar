"use client";

import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Icon } from "./Icon";

export interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxProps {
  label?: string;
  placeholder?: string;
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string) => void;
  emptyText?: string;
  /** Applied to the trigger button itself (not the outer wrapper) - e.g. an
   * explicit h-* to line this control up with sibling controls (Button,
   * a plain input) that render at a different intrinsic height because
   * they use a different text/line-height scale. */
  triggerClassName?: string;
}

// The "dropdown list" primitive - a type-to-filter select. The Stitch
// reference designs use a plain native <select> for simple option pickers,
// but that can't support search-as-you-type, so this is the searchable
// counterpart for anywhere the option list is long enough to need it.
export function Combobox({
  label,
  placeholder,
  options,
  value,
  onChange,
  emptyText,
  triggerClassName,
}: ComboboxProps) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const resolvedPlaceholder = placeholder ?? t("select");
  const resolvedEmptyText = emptyText ?? t("noResultsFound");

  return (
    <div className="space-y-2">
      {label && (
        <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
          {label}
        </label>
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={`flex items-center justify-between w-full px-4 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-shadow ${triggerClassName ?? ""}`}
          >
            <span className={selected ? "" : "text-outline"}>
              {selected ? selected.label : resolvedPlaceholder}
            </span>
            <Icon name="expand_more" className="text-on-surface-variant" size={18} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-50 w-[var(--radix-popover-trigger-width)] bg-surface-container-lowest border border-outline-variant rounded-xl shadow-[0_4px_16px_0_rgba(0,0,0,0.12)] overflow-hidden"
          >
            <Command className="flex flex-col" label={label ?? resolvedPlaceholder}>
              <Command.Input
                placeholder={t("typeToSearch")}
                className="w-full px-4 py-2 border-b border-outline-variant bg-transparent font-body-md text-body-md text-on-surface placeholder:text-outline outline-none"
              />
              <Command.List className="max-h-60 overflow-y-auto p-1">
                <Command.Empty className="px-4 py-2 font-body-md text-body-md text-on-surface-variant">
                  {resolvedEmptyText}
                </Command.Empty>
                {options.map((option) => (
                  <Command.Item
                    key={option.value}
                    value={option.label}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className="flex items-center justify-between px-4 py-2 rounded-lg font-body-md text-body-md text-on-surface cursor-pointer data-[selected=true]:bg-surface-variant"
                  >
                    {option.label}
                    {option.value === value && (
                      <Icon name="check" size={16} className="text-primary" />
                    )}
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
