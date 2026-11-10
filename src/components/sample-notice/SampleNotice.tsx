import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import "./sample-notice.css";

/** 실제 운영 자료가 아닌 가상·합성 표본으로 계산하는 화면임을 알린다. */
export function SampleNotice({ title, children, action }: { title: string; children: ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <aside className="gf-sample-notice" role="note" aria-label={title}>
      <FlaskConical size={16} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
      {action && <button type="button" onClick={action.onClick}>{action.label}</button>}
    </aside>
  );
}
