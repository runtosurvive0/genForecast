import { useState, type ReactNode } from 'react';

/** Mount charts only after their section has a measurable, visible layout. */
export function ForecastDetails({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className="gf-forecast-details" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><strong>{title}</strong><span>{note}</span></summary>
    {open && <div className="gf-forecast-details-content">{children}</div>}
  </details>;
}
