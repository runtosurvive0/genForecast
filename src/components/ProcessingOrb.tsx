import { useEffect, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";

export type OrbTheme = "light" | "dark";
export type OrbState = "solving" | "searching" | "connecting";

const documentTheme = (): OrbTheme =>
  typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";

/** App.tsx가 <html>에 붙이는 dark 클래스를 따라간다. theme를 넘기지 않은 화면에서 쓴다. */
export function useDocumentTheme(): OrbTheme {
  const [theme, setTheme] = useState<OrbTheme>(documentTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(documentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export interface ProcessingOrbProps {
  theme?: OrbTheme;
  state: OrbState;
  label: string;
  size?: 20 | 32 | 64;
  className?: string;
  /** 칸 안의 자리표시처럼 글을 보일 자리가 없으면 글은 화면 읽기 프로그램에만 알린다. */
  hideLabel?: boolean;
}

/** Mount while the parent operation is pending, then unmount on completion. */
export function ProcessingOrb({
  theme,
  state,
  label,
  size = 20,
  className,
  hideLabel = false,
}: ProcessingOrbProps) {
  const fallback = useDocumentTheme();
  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`gf-processing-orb inline-flex items-center gap-2 text-sm ${className ?? ""}`}
    >
      <ThinkingOrb
        state={state}
        size={size}
        theme={theme ?? fallback}
        aria-hidden="true"
        className="shrink-0"
      />
      {hideLabel ? <span className="sr-only">{label}</span> : <span>{label}</span>}
    </span>
  );
}

/** 버튼 안처럼 상태 알림을 따로 두는 곳의 장식용 오브. */
export function InlineOrb({ state, size = 20, theme, className }: { state: OrbState; size?: 20 | 32 | 64; theme?: OrbTheme; className?: string }) {
  const fallback = useDocumentTheme();
  return <ThinkingOrb state={state} size={size} theme={theme ?? fallback} aria-hidden="true" className={`shrink-0 ${className ?? ""}`} />;
}
