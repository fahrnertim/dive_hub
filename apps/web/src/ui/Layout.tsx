import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { announce } from '../lib/announce.ts';
import { Icon } from './Icon.tsx';

/**
 * A titled area of a page. `narrow` for single forms (sign-in, setup). `level={1}` when the panel's
 * title is the page's title: every page has exactly one h1 (checked by e2e/accessibility.spec.ts).
 */
export function Panel({ title, children, narrow, actions, level = 2, attention }: {
  title?: ReactNode; children: ReactNode; narrow?: boolean; actions?: ReactNode; level?: 1 | 2;
  /** Something that waits for the User: the panel is tinted (ADR 0019). */
  attention?: boolean;
}) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <section className={['panel', narrow && 'panel-narrow', attention && 'panel-attention'].filter(Boolean).join(' ')}>
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
 * The head of a page (visual refresh 2): its h1 first, then optional meta (date, Diver) and a lead
 * sentence, and the page's actions beside it. Sections follow as panels. Single forms (sign-in, setup)
 * use a narrow `Panel level={1}` instead.
 */
export function PageHeader({ title, meta, lead, actions }: { title: ReactNode; meta?: ReactNode; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {meta}
        {lead && <p className="muted">{lead}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/** A short state next to a value ("done", "edited"). Neutral unless it reports success or failure. */
export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'danger'; children: ReactNode }) {
  return <span className={tone === 'neutral' ? 'badge' : `badge badge-${tone}`}>{children}</span>;
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
      <Icon name={tone} />
      <div className="notice-body">{children}</div>
    </div>
  );
}

/** A secondary sentence (an intro, an empty list) in the muted colour, at body size. */
export const Muted = ({ children }: { children: ReactNode }) => <p className="muted">{children}</p>;

/**
 * A column header. Every header has text: a column of buttons gets { label: t('common.actions'), hidden: true },
 * read by screen readers but not shown (an empty header fails WCAG 1.3.1).
 */
type Column = string | {
  label: string;
  numeric?: true;
  hidden?: true;
  /** A sortable column: the header is a button, and aria-sort says the current order. */
  sort?: { direction: 'ascending' | 'descending' | undefined; onSort: () => void };
};
const header = (c: Column, i: number) => {
  if (typeof c === 'string') return <th key={i} scope="col">{c}</th>;
  if (c.hidden) return <th key={i} scope="col" data-hidden="true"><span className="visually-hidden">{c.label}</span></th>;
  const mark = c.sort?.direction === 'ascending' ? <Icon name="sortAscending" />
    : c.sort?.direction === 'descending' ? <Icon name="sortDescending" /> : null;
  return (
    <th key={i} scope="col" className={c.numeric ? 'num' : undefined} aria-sort={c.sort ? c.sort.direction ?? 'none' : undefined}>
      {c.sort ? (
        <AriaButton className="sort-button" onPress={c.sort.onSort}>
          {c.label}<span className="sort-mark">{mark}</span>
        </AriaButton>
      ) : c.label}
    </th>
  );
};

/**
 * A data table that scrolls sideways on narrow screens instead of breaking the layout. Numeric
 * columns ({ label, numeric: true }) are right-aligned, header included; give their cells className="num".
 * `cards`: on a phone each row becomes a card with the column names next to the values, for tables
 * whose last column holds actions that would otherwise scroll out of sight (UI review C5).
 * `stacked`: on a phone each row becomes two lines, the cell marked `cell-main` beside `cell-lead`, the
 * `cell-sub` cells joined below it, e.g. the logbook's date over "Erika · 18.5 m · 30 min" (visual refresh 6).
 */
export function Table({ label, head, children, cards, stacked }: {
  label: string; head: Column[]; children: ReactNode; cards?: boolean; stacked?: boolean;
}) {
  const table = useRef<HTMLTableElement>(null);
  // Cards show each cell's column name (data-label, via CSS). Explicit roles keep the table a
  // table for screen readers when CSS lays it out as blocks.
  useLayoutEffect(() => {
    const el = table.current;
    if (!(cards || stacked) || !el?.tHead?.rows[0]) return;
    const headers = [...el.tHead.rows[0].cells];
    el.setAttribute('role', 'table');
    for (const section of [el.tHead, ...el.tBodies]) section.setAttribute('role', 'rowgroup');
    for (const row of el.rows) row.setAttribute('role', 'row');
    for (const th of headers) th.setAttribute('role', 'columnheader');
    for (const row of [...el.tBodies].flatMap((b) => [...b.rows])) {
      [...row.cells].forEach((cell, i) => {
        cell.setAttribute('role', 'cell');
        const th = headers[i];
        cell.dataset.label = cell.colSpan === 1 && th && !th.dataset.hidden ? th.textContent ?? '' : '';
      });
    }
  });
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className={['table', cards && 'table-cards', stacked && 'table-stacked'].filter(Boolean).join(' ')} ref={table}>
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
