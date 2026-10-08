import type { ReactNode } from "react";
import "./tower.css";

export function Section({
  title,
  note,
  children,
  action,
}: {
  title: string;
  note?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="tower-section">
      <header>
        <div>
          <h2>{title}</h2>
          {note && <p>{note}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
export function Metric({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  note?: string;
}) {
  return (
    <div className="tower-metric">
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
      {note && <p>{note}</p>}
    </div>
  );
}
