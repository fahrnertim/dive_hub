import { useEffect, useRef, type ReactNode } from 'react';
import { announce } from '../lib/announce.ts';

/**
 * A titled area of a page. `narrow` for single forms (sign-in, setup). `level={1}` when the panel's
 * title is the page's title: every page has exactly one h1 (checked by e2e/accessibility.spec.ts).
 */
export function Panel({ title, children, narrow, actions, level = 2 }: {
  title?: ReactNode; children: ReactNode; narrow?: boolean; actions?: ReactNode; level?: 1 | 2;
}) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <section className={narrow ? 'panel panel-narrow' : 'panel'}>
      {(title || actions) && (
        <div className="panel-head">
          {title && <Heading>{title}</Heading>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * A message about what just happened. Errors are alerts, read at once; the rest is read politely
 * through the page's live region (lib/announce.ts) when the notice appears.
 */
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'success' | 'danger'; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tone !== 'danger' && ref.current) announce(ref.current.innerText);
  }, [tone]);
  return (
    <div ref={ref} className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      {children}
    </div>
  );
}

export const Muted = ({ children }: { children: ReactNode }) => <p className="muted">{children}</p>;

/**
 * A column header. Every header has text: a column of buttons gets { label: t('common.actions'), hidden: true },
 * read by screen readers but not shown (an empty header fails WCAG 1.3.1).
 */
type Column = string | { label: string; numeric: true } | { label: string; hidden: true };
const header = (c: Column, i: number) => {
  if (typeof c === 'string') return <th key={i} scope="col">{c}</th>;
  if ('numeric' in c) return <th key={i} scope="col" className="num">{c.label}</th>;
  return <th key={i} scope="col"><span className="visually-hidden">{c.label}</span></th>;
};

/**
 * A data table that scrolls sideways on narrow screens instead of breaking the layout. Numeric
 * columns ({ label, numeric: true }) are right-aligned, header included; give their cells className="num".
 */
export function Table({ label, head, children }: { label: string; head: Column[]; children: ReactNode }) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="table">
        <thead>
          <tr>{head.map(header)}</tr>
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
