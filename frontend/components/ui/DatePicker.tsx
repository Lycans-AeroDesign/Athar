"use client";

import * as Popover from "@radix-ui/react-popover";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { DayPicker } from "react-day-picker";

import { formatDateTime, localDateToUtcIsoString, utcToLocalDate } from "@/lib/datetime";

import { Icon } from "./Icon";

interface DatePickerProps {
  label?: string;
  /** A UTC ISO 8601 string (as returned by the backend), or null. */
  value: string | null;
  /** Called with a UTC ISO 8601 string - never a bare local Date. */
  onChange: (utcIsoString: string | null) => void;
  includeTime?: boolean;
}

const DAY_PICKER_CLASS_NAMES = {
  root: "p-4 font-body-md text-body-md",
  months: "flex flex-col gap-4",
  month_caption: "flex items-center justify-center font-headline-md text-headline-md text-on-surface mb-2",
  nav: "flex items-center justify-between",
  button_previous:
    "h-8 w-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-variant transition-colors",
  button_next:
    "h-8 w-8 flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-variant transition-colors",
  weekdays: "flex",
  weekday: "w-9 h-9 flex items-center justify-center font-label-caps text-label-caps text-on-surface-variant uppercase",
  week: "flex",
  day: "w-9 h-9 flex items-center justify-center",
  day_button: "h-8 w-8 flex items-center justify-center rounded-lg text-on-surface hover:bg-surface-variant transition-colors",
  today: "font-bold text-primary",
  selected: "[&>button]:bg-primary-container [&>button]:text-on-primary [&>button]:hover:bg-primary-container",
  outside: "text-outline",
  disabled: "text-outline opacity-50",
};

// Reusable date(-time) picker for fields that represent an absolute instant
// (e.g. "scheduled at", "reported at") - NOT for timezone-less calendar
// dates like a birthday, which should just be a plain "YYYY-MM-DD" string
// with no UTC conversion at all. See lib/datetime.ts for the convention:
// this component always speaks UTC ISO strings at its props boundary and
// only converts to/from a local Date internally, for the calendar UI.
export function DatePicker({ label, value, onChange, includeTime = false }: DatePickerProps) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const localDate = utcToLocalDate(value);

  function commitDate(nextDate: Date | undefined, timeString?: string) {
    if (!nextDate) {
      onChange(null);
      return;
    }
    const combined = new Date(nextDate);
    if (includeTime && timeString) {
      const [hours, minutes] = timeString.split(":").map(Number);
      combined.setHours(hours, minutes, 0, 0);
    } else if (localDate) {
      combined.setHours(localDate.getHours(), localDate.getMinutes(), 0, 0);
    }
    onChange(localDateToUtcIsoString(combined));
  }

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
            className="flex items-center justify-between w-full px-4 py-2 bg-surface border border-outline-variant rounded-lg font-mono-sm text-mono-sm text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-shadow"
          >
            <span className={localDate ? "" : "text-outline"}>
              {localDate ? formatDateTime(value) : t("selectDate")}
            </span>
            <Icon name="calendar_month" size={18} className="text-on-surface-variant" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-50 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-[0_4px_16px_0_rgba(0,0,0,0.12)]"
          >
            <DayPicker
              mode="single"
              selected={localDate ?? undefined}
              onSelect={(date) => commitDate(date)}
              classNames={DAY_PICKER_CLASS_NAMES}
            />
            {includeTime && (
              <div className="flex items-center gap-2 px-4 pb-4">
                <Icon name="schedule" size={18} className="text-on-surface-variant" />
                <input
                  type="time"
                  className="flex-1 px-4 py-2 bg-surface border border-outline-variant rounded-lg font-mono-sm text-mono-sm text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  value={
                    localDate
                      ? `${String(localDate.getHours()).padStart(2, "0")}:${String(localDate.getMinutes()).padStart(2, "0")}`
                      : ""
                  }
                  onChange={(e) => commitDate(localDate ?? new Date(), e.target.value)}
                />
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
