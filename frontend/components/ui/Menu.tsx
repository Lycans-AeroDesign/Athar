"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useState, useSyncExternalStore, type ReactNode } from "react";

import { Icon } from "./Icon";

export interface MenuItemConfig {
  type?: "item";
  label: string;
  onSelect: () => void;
  danger?: boolean;
  icon?: string;
}

export interface MenuSubmenuOption {
  value: string;
  label: string;
  icon?: string;
}

export interface MenuSubmenuConfig {
  type: "submenu";
  label: string;
  icon?: string;
  value: string;
  onChange: (value: string) => void;
  options: MenuSubmenuOption[];
}

export interface MenuSeparatorConfig {
  type: "separator";
}

export type MenuEntry = MenuItemConfig | MenuSubmenuConfig | MenuSeparatorConfig;

interface MenuProps {
  trigger: ReactNode;
  items: MenuEntry[];
  /** Non-interactive text shown above the items (e.g. the current user's email). */
  header?: ReactNode;
  align?: "start" | "center" | "end";
}

const itemClass =
  "flex items-center gap-2 px-4 py-2 rounded-lg font-body-md text-body-md cursor-pointer outline-none transition-colors text-on-surface hover:bg-surface-variant data-[state=open]:bg-surface-variant";
const dangerItemClass =
  "flex items-center gap-2 px-4 py-2 rounded-lg font-body-md text-body-md cursor-pointer outline-none transition-colors text-error hover:bg-error-container";

// Below Tailwind's `sm` breakpoint a side-opening submenu has nowhere to go -
// the menu is already pinned to the screen edge, so it flips over the main
// menu and gets clipped off the opposite edge. There, submenus expand inline
// (accordion-style) inside the main menu instead.
const NARROW_QUERY = "(max-width: 639px)";

function subscribeNarrow(onChange: () => void) {
  const media = window.matchMedia(NARROW_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function useIsNarrow() {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}

function SubmenuOptions({ entry }: { entry: MenuSubmenuConfig }) {
  return (
    <DropdownMenu.RadioGroup value={entry.value} onValueChange={entry.onChange}>
      {entry.options.map((option) => (
        <DropdownMenu.RadioItem key={option.value} value={option.value} className={itemClass}>
          {option.icon && <Icon name={option.icon} size={18} />}
          <span className="flex-1">{option.label}</span>
          <DropdownMenu.ItemIndicator>
            <Icon name="check" size={16} className="text-primary" />
          </DropdownMenu.ItemIndicator>
        </DropdownMenu.RadioItem>
      ))}
    </DropdownMenu.RadioGroup>
  );
}

// Action/context menu (e.g. the top bar avatar menu, row "..." actions) -
// distinct from Combobox, which is for picking a value inside a form.
// Also supports a hover-opened submenu with radio-style options (used for
// the account menu's Theme picker: Light / Dark / Match System).
export function Menu({ trigger, items, header, align = "end" }: MenuProps) {
  const isNarrow = useIsNarrow();
  // Which inline-expanded submenu (narrow screens only) is open, by label.
  const [expandedSubmenu, setExpandedSubmenu] = useState<string | null>(null);

  return (
    <DropdownMenu.Root onOpenChange={(open) => !open && setExpandedSubmenu(null)}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={8}
          collisionPadding={8}
          className="min-w-[200px] max-w-[calc(100vw-16px)] bg-surface-container-lowest border border-outline-variant rounded-xl p-1 shadow-[0_4px_16px_0_rgba(0,0,0,0.12)] z-50"
        >
          {header && (
            <DropdownMenu.Label className="px-4 py-2 font-label-caps text-label-caps text-on-surface-variant truncate">
              {header}
            </DropdownMenu.Label>
          )}
          {header && <DropdownMenu.Separator className="h-px bg-outline-variant my-1" />}

          {items.map((entry, index) => {
            if (entry.type === "separator") {
              return <DropdownMenu.Separator key={`separator-${index}`} className="h-px bg-outline-variant my-1" />;
            }

            if (entry.type === "submenu" && isNarrow) {
              const expanded = expandedSubmenu === entry.label;
              return (
                <div key={entry.label}>
                  <DropdownMenu.Item
                    className={itemClass}
                    aria-expanded={expanded}
                    onSelect={(event) => {
                      // Keep the menu open - this only toggles the inline options.
                      event.preventDefault();
                      setExpandedSubmenu(expanded ? null : entry.label);
                    }}
                  >
                    {entry.icon && <Icon name={entry.icon} size={18} />}
                    <span className="flex-1">{entry.label}</span>
                    <Icon
                      name="expand_more"
                      size={16}
                      className={`text-on-surface-variant transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </DropdownMenu.Item>
                  {expanded && (
                    <div className="ms-4 ps-1 border-s border-outline-variant">
                      <SubmenuOptions entry={entry} />
                    </div>
                  )}
                </div>
              );
            }

            if (entry.type === "submenu") {
              return (
                <DropdownMenu.Sub key={entry.label}>
                  <DropdownMenu.SubTrigger className={itemClass}>
                    {entry.icon && <Icon name={entry.icon} size={18} />}
                    <span className="flex-1">{entry.label}</span>
                    <Icon name="chevron_right" size={16} className="text-on-surface-variant" />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent
                      sideOffset={4}
                      collisionPadding={8}
                      className="min-w-[180px] bg-surface-container-lowest border border-outline-variant rounded-xl p-1 shadow-[0_4px_16px_0_rgba(0,0,0,0.12)] z-50"
                    >
                      <SubmenuOptions entry={entry} />
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
              );
            }

            return (
              <DropdownMenu.Item
                key={entry.label}
                onSelect={entry.onSelect}
                className={entry.danger ? dangerItemClass : itemClass}
              >
                {entry.icon && <Icon name={entry.icon} size={18} />}
                <span className="flex-1">{entry.label}</span>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
