import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiveView } from './api.ts';
import { Disclosure, Muted, QrCode } from './ui/index.ts';

/** The element the "Send update" card points to (ADR 0043). */
const DIVE_CODES_ID = 'verification-codes';

/** A code drawn for scanning, with whose it is named beside it: a centre's, or with `caption` a person's. */
export function CodeFigure({ name, text, caption, children }: { name: string; text: string; caption?: string; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <figure className="code-figure">
      <QrCode text={text} label={caption ? `${caption}: ${name}` : t('centres.codeOf', { name })} />
      <figcaption>
        <strong translate="no">{name}</strong>
        <span>{caption ?? t('centres.codeCaption')}</span>
        {children}
      </figcaption>
    </figure>
  );
}

/**
 * On a Dive: the verification codes of the centres of its site and of the professionals on it (ADR 0043), one line
 * until opened. Shown whenever the API gives any: to verify the dive at SSI, or to show to the others who were on it.
 */
export function DiveCodes({ dive: d }: { dive: DiveView }) {
  const { t } = useTranslation();
  // Opened by the User, or from outside (the "Send update" card points here).
  const [open, setOpen] = useState(false);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const show = () => { setOpen(true); section.current?.scrollIntoView({ block: 'nearest' }); };
    const node = section.current;
    node?.addEventListener('show-codes', show);
    return () => node?.removeEventListener('show-codes', show);
  }, [d.verificationCodes.length]);
  if (d.verificationCodes.length === 0) return null;
  return (
    <section className="dive-line" id={DIVE_CODES_ID} ref={section}>
      <Disclosure
        level={2} title={t('centres.diveCodes', { count: d.verificationCodes.length })} isExpanded={open} onExpandedChange={setOpen}
        summary={<p className="provider-state" translate="no">{d.verificationCodes.map((v) => v.centre?.displayName ?? v.diver?.name ?? '').join(', ')}</p>}
      >
        <div className="code-figures">
          {d.verificationCodes.map((v) => (v.centre ? (
            <CodeFigure key={v.centre.id} name={v.centre.displayName} text={v.text}>
              <a href={`#/centres/${v.centre.id}`}>{t('centres.toCentre')}</a>
            </CodeFigure>
          ) : v.diver && (
            <CodeFigure key={v.diver.id} name={v.diver.name} text={v.text} caption={t('diverCodes.diveCaption')} />
          )))}
        </div>
        <Muted>{t('centres.diveCodesHint')}</Muted>
      </Disclosure>
    </section>
  );
}

/** Opens the Dive's codes and brings them into view. */
export function showDiveCodes() {
  document.getElementById(DIVE_CODES_ID)?.dispatchEvent(new Event('show-codes'));
}
