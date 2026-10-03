import type { ReactNode } from 'react';

/** A titled area of a page. `narrow` for single forms (sign-in, setup). */
export function Panel({ title, children, narrow, actions }: {
  title?: ReactNode; children: ReactNode; narrow?: boolean; actions?: ReactNode;
}) {
  return (
    <section className={narrow ? 'panel panel-narrow' : 'panel'}>
      {(title || actions) && (
        <div className="panel-head">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** A message about what just happened. Errors are announced at once; the rest politely. */
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'success' | 'danger'; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export const Muted = ({ children }: { children: ReactNode }) => <p className="muted">{children}</p>;

type Column = ReactNode | { label: ReactNode; numeric: true };
const isNumeric = (c: Column): c is { label: ReactNode; numeric: true } => typeof c === 'object' && c !== null && 'numeric' in c;

/**
 * A data table that scrolls sideways on narrow screens instead of breaking the layout. Numeric
 * columns ({ label, numeric: true }) are right-aligned, header included; give their cells className="num".
 */
export function Table({ label, head, children }: { label: string; head: Column[]; children: ReactNode }) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="table">
        <thead>
          <tr>{head.map((h, i) => (isNumeric(h) ? <th key={i} scope="col" className="num">{h.label}</th> : <th key={i} scope="col">{h}</th>))}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** The diver-down flag: red with a white diagonal, flown above divers in the water. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={(size * 3) / 4} viewBox="0 0 40 30" aria-hidden="true" focusable="false">
      <rect width="40" height="30" rx="2" fill="var(--color-brand-flag)" />
      <path d="M0 4 L4 0 L40 26 L36 30 Z" fill="#fff" />
    </svg>
  );
}
