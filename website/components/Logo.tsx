/**
 * Athar mark: three linked nodes fading along a diagonal - a trace (أثر)
 * left behind, and the connected records that make it up.
 * Placeholder until an official Athar logo exists; app/icon.svg mirrors it.
 */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="7" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
      <path d="M9 23 16 16 23 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeOpacity="0.55" />
      <circle cx="9" cy="23" r="2.4" fill="currentColor" fillOpacity="0.35" />
      <circle cx="16" cy="16" r="2.6" fill="currentColor" fillOpacity="0.65" />
      <circle cx="23" cy="9" r="3" fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark className="h-7 w-7 text-accent" />
      <span className="text-[1.05rem] font-semibold tracking-tight text-fg">Athar</span>
      <span lang="ar" dir="rtl" className="font-arabic text-[1.05rem] font-semibold text-accent">
        أثر
      </span>
    </span>
  );
}
