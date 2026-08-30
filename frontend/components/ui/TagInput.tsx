"use client";

import { useState, type KeyboardEvent } from "react";

import { Icon } from "./Icon";

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  className?: string;
}

// Chip-style tag entry: typing then Enter turns the current text into a
// pill, each with its own remove (x) button. Comma-separated text commits
// as multiple tags at once (e.g. "servo, pixhawk, telemetry" + Enter -> 3
// chips). Backspace on an empty draft pops the last chip, and blurring the
// input commits whatever's typed so it isn't silently lost.
export function TagInput({ value, onChange, placeholder, className }: TagInputProps) {
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const names = draft
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.length === 0) {
      setDraft("");
      return;
    }
    const next = [...value];
    for (const name of names) {
      if (!next.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
        next.push(name);
      }
    }
    onChange(next);
    setDraft("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function removeTag(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 bg-surface-container-low px-3 py-1.5 rounded-xl border border-outline-variant focus-within:ring-1 focus-within:ring-primary transition-colors ${className ?? ""}`}
    >
      {value.map((tag, index) => (
        <span
          key={`${tag}-${index}`}
          className="inline-flex items-center gap-1 bg-surface-container-highest text-on-surface font-mono-sm text-mono-sm rounded-full ps-2.5 pe-1 py-0.5"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(index)}
            className="text-on-surface-variant hover:text-error transition-colors"
          >
            <Icon name="close" size={14} />
          </button>
        </span>
      ))}
      <input
        className="flex-1 min-w-[100px] bg-transparent outline-none font-body-md text-body-md text-on-surface placeholder:text-on-surface-variant/50 py-1"
        placeholder={value.length === 0 ? placeholder : ""}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commitDraft}
      />
    </div>
  );
}
