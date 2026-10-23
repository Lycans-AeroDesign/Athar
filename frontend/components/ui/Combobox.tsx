"use client";

import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Icon } from "./Icon";

export interface ComboboxOption {
  value: string;
  label: string;
  /** An Icon name shown before the label, in the list and on the trigger -
   * see lib/optionIcons.ts for the shared per-enum mappings. */
  icon?: string;
  /** Overrides the icon's default muted color (e.g. text-error for a
   * failing/high-severity value). */
  iconClassName?: string;
}

function OptionLabel({ option }: { option: ComboboxOption }) {
  if (!option.icon) return <>{option.label}</>;
  return (
    <span className="flex items-center gap-2 min-w-0">
      <Icon name={option.icon} size={16} className={`shrink-0 ${option.iconClassName ?? "text-on-surface-variant"}`} />
      <span className="truncate">{option.label}</span>
    </span>
  );
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
  /** Given, the list grows a pinned "Create {typed text}" row (shown when
   * the query is non-empty and matches no option) - e.g. a category.manage
   * holder adding a missing category without leaving the editor. The caller
   * owns the actual creation. */
  onCreate?: (query: string) => void;
  /** Overrides the create row's label template ({query} is replaced). */
  createLabel?: string;
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
  onCreate,
  createLabel,
}: ComboboxProps) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  // The typed search, tracked so the pinned create row (onCreate above) can
  // echo it. Reset on close so the previous open's query doesn't linger.
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const resolvedPlaceholder = placeholder ?? t("select");
  const resolvedEmptyText = emptyText ?? t("noResultsFound");
  const trimmedQuery = query.trim();
  // Hide the create row when it would duplicate an existing option's label.
  const queryMatchesAnOption = options.some(
    (option) => option.label.toLowerCase() === trimmedQuery.toLowerCase(),
  );

  function handleCreate() {
    onCreate?.(trimmedQuery);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="space-y-2">
      {label && (
        <label className="block font-label-caps text-label-caps text-on-surface-variant uppercase">
          {label}
        </label>
      )}
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            className={`flex items-center justify-between w-full px-4 py-2 bg-surface border border-outline-variant rounded-lg font-body-md text-body-md text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-shadow ${triggerClassName ?? ""}`}
          >
            <span className={`min-w-0 ${selected ? "" : "text-outline"}`}>
              {selected ? <OptionLabel option={selected} /> : resolvedPlaceholder}
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
                onValueChange={setQuery}
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
                      setQuery("");
                      setOpen(false);
                    }}
                    className="flex items-center justify-between px-4 py-2 rounded-lg font-body-md text-body-md text-on-surface cursor-pointer data-[selected=true]:bg-surface-variant"
                  >
                    <OptionLabel option={option} />
                    {option.value === value && (
                      <Icon name="check" size={16} className="text-primary" />
                    )}
                  </Command.Item>
                ))}
              </Command.List>
              {onCreate && trimmedQuery !== "" && !queryMatchesAnOption && (
                <button
                  type="button"
                  onClick={handleCreate}
                  className="flex w-full items-center gap-2 border-t border-outline-variant px-4 py-2.5 font-body-md text-body-md text-primary hover:bg-surface-variant transition-colors"
                >
                  <Icon name="add" size={16} className="shrink-0" />
                  {createLabel
                    ? createLabel.replace("{query}", trimmedQuery)
                    : t("comboboxCreate", { query: trimmedQuery })}
                </button>
              )}
            </Command>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
