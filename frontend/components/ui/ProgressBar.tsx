interface ProgressBarProps {
  /** 0-1 fraction, e.g. from uploadFile's onProgress. */
  progress: number;
  className?: string;
}

export function ProgressBar({ progress, className }: ProgressBarProps) {
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`h-1.5 w-full rounded-full bg-surface-variant overflow-hidden ${className ?? ""}`}
    >
      <div className="h-full bg-primary transition-[width] duration-150 ease-out rounded-full" style={{ width: `${percent}%` }} />
    </div>
  );
}
