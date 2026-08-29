import type { CSSProperties } from "react";

interface IconProps {
  name: string;
  className?: string;
  filled?: boolean;
  size?: number;
}

// Wraps a Material Symbols Outlined glyph (see app/layout.tsx for the font
// <link>) - matches the icon system used throughout ref/aerokms_*/code.html.
export function Icon({ name, className, filled, size }: IconProps) {
  const style: CSSProperties = {};
  if (filled) style.fontVariationSettings = "'FILL' 1";
  if (size) style.fontSize = size;

  return (
    <span className={`material-symbols-outlined ${className ?? ""}`} style={style} aria-hidden="true">
      {name}
    </span>
  );
}
