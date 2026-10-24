import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConflictChoices, ConflictFieldView } from './api.ts';
import { useCylinderText } from './Cylinders.tsx';
import { useDisplay } from './lib/display.ts';
import type { SyncedField } from './lib/providers.ts';
import { formatDiveTime } from './lib/units.ts';
import { Button, Muted, RadioGroup } from './ui/index.ts';

/**
 * A value of a field changed on both sides as the User reads it (ADR 0030, 0056): depths, temperatures and durations in
 * their units, names listed, a tank in words, the start as the Provider keeps it. The import preview says them the same way.
 */
export function useConflictValueText() {
  const { t, i18n } = useTranslation();
  const display = useDisplay();
  const cylinderText = useCylinderText();
  return (field: SyncedField, v: ConflictFieldView['hub']): string => {
    if (v === null || (Array.isArray(v) && v.length === 0)) return t('common.none');
    if (Array.isArray(v)) return new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(v);
    // The tank typed at the Provider, or the Dive's only Cylinder, in a Cylinder's words.
    if (typeof v === 'object') return cylinderText({ ...v, workingPressureBar: null });
    // The local time as the Provider keeps it, without a time zone.
    if (field === 'startsAt' && typeof v === 'string') return formatDiveTime(`${v.replace(' ', 'T')}Z`, null, display.locale, true);
    if (typeof v === 'number') {
      if (field === 'durationSeconds') return display.duration(v);
      if (field === 'waterTemperatureC') return display.temperature(v);
      if (field === 'lead') return display.mass(v);
      return display.depth(v);
    }
    return v;
  };
}

/** A choice with the value it keeps under it, read together by screen readers. */
const option = (label: string, value: string) => (
  <span className="radio-text"><span>{label}</span><span className="field-description provider-conflict-value">{value}</span></span>
);

/**
 * Fields changed both here and at a Provider since the last exchange (a Conflict, ADR 0056): one row per field with both
 * values and a choice, Dive Hub's preselected as in the import preview. "Send with these choices" hands them on; the
 * caller sends the Dive again with them. On the Dive's page it has its own heading (`waiting`: a run left them, so part of
 * the Dive was sent already); on the Review page (`item` names the Dive) the section around it says what it is.
 */
export function ProviderConflicts({ conflicts, providerName, onSend, onCancel, isPending, isDisabled, item, waiting }: {
  conflicts: ConflictFieldView[]; providerName: string; onSend: (choices: ConflictChoices) => void;
  onCancel?: (() => void) | undefined; isPending?: boolean; isDisabled?: boolean; item?: string; waiting?: boolean;
}) {
  const { t } = useTranslation();
  const valueText = useConflictValueText();
  const headingId = useId();
  const [choices, setChoices] = useState<ConflictChoices>({});
  // The import preview's field names, as a label of their own.
  const label = (field: SyncedField) => {
    const name = t(`provider.importField.${field}`);
    return name.charAt(0).toLocaleUpperCase() + name.slice(1);
  };
  const send = t('provider.conflictsSend');
  const body = (
    <>
      {conflicts.map((c) => (
        <RadioGroup
          key={c.field} label={label(c.field)} value={choices[c.field] ?? 'hub'}
          onChange={(value) => setChoices({ ...choices, [c.field]: value as 'hub' | 'provider' })}
          options={[
            { value: 'hub', label: option(t('provider.conflictKeep'), valueText(c.field, c.hub)) },
            { value: 'provider', label: option(t('provider.conflictTake', { name: providerName }), valueText(c.field, c.provider)) },
          ]}
        />
      ))}
      <div className="form-actions">
        <Button
          variant="primary" icon="send" isPending={!!isPending} isDisabled={!!isDisabled}
          {...(item && { 'aria-label': t('common.forItem', { action: send, item }) })}
          onPress={() => onSend(Object.fromEntries(conflicts.map((c) => [c.field, choices[c.field] ?? 'hub'])))}
        >
          {send}
        </Button>
        {onCancel && <Button isDisabled={!!isPending} onPress={onCancel}>{t('common.cancel')}</Button>}
      </div>
    </>
  );
  if (item) return <div className="provider-conflicts">{body}</div>;
  return (
    <section className="provider-conflicts provider-conflicts-asked" aria-labelledby={headingId}>
      <h3 id={headingId}>{t('provider.conflictsTitle')}</h3>
      <Muted>{t(waiting ? 'provider.conflictsWaiting' : 'provider.conflictsIntro', { name: providerName })}</Muted>
      {body}
    </section>
  );
}
