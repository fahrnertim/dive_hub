import { Fragment, type ReactNode } from 'react';

/** One thing a row says about a Dive or a Recording; `text` is what the User reads, and what is compared. */
export interface Fact {
  key: string;
  text: string | undefined;
}

/** The facts of a row on one line; those in `marked` differ from the other candidate (UI redesign 4.5). */
export function Facts({ facts, marked }: { facts: Fact[]; marked: Set<string> }) {
  const shown = facts.filter((f) => f.text);
  return (
    <p className="candidate-facts">
      {shown.map((f, i) => (
        <Fragment key={f.key}>
          {i > 0 && ' · '}
          {marked.has(f.key) ? <mark className="diff">{f.text}</mark> : f.text}
        </Fragment>
      ))}
    </p>
  );
}

/** A candidate of a decision as a row of its own: what it is, a badge for what to know about it, then its facts. */
export function CandidateRow({ title, badge, facts, marked }: { title: ReactNode; badge?: ReactNode; facts: Fact[]; marked: Set<string> }) {
  return (
    <li className="candidate">
      <div className="candidate-head">{title}{badge}</div>
      <Facts facts={facts} marked={marked} />
    </li>
  );
}

/** The candidates of one decision side by side; stacked on a phone. */
export function Candidates({ children }: { children: ReactNode }) {
  return <ul className="candidates">{children}</ul>;
}
