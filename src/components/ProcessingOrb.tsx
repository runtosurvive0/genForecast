import { ThinkingOrb } from "thinking-orbs";

export interface ProcessingOrbProps {
  theme: "light" | "dark";
  state: "solving" | "searching" | "connecting";
  label: string;
  size?: 20 | 32 | 64;
  className?: string;
}

/** Mount while the parent operation is pending, then unmount on completion. */
export function ProcessingOrb({
  theme,
  state,
  label,
  size = 20,
  className,
}: ProcessingOrbProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`inline-flex items-center gap-2 text-sm ${className ?? ""}`}
    >
      <ThinkingOrb
        state={state}
        size={size}
        theme={theme}
        aria-hidden="true"
        className="shrink-0"
      />
      <span>{label}</span>
    </span>
  );
}
