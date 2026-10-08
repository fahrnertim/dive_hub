import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, diverDetailsQuery, keys, unwrap, type DiverDetailsView, type ReadCodeView } from './api.ts';
import { CodeFigure } from './CentresPage.tsx';
import { CodeScanner } from './CodeScanner.tsx';
import { announce } from './lib/announce.ts';
import { useErrorText } from './lib/display.ts';
import { Button, Dialog, Form, Muted, Notice, RadioGroup, TextField } from './ui/index.ts';

const FIELDS = ['firstName', 'lastName', 'email', 'leaderNumber'] as const;
type Field = (typeof FIELDS)[number];
type PersonCode = Exclude<ReadCodeView, { kind: 'centre' }>;

/** Whatever changes a Diver's details also changes the codes on the Dives they are on. */
function useRefreshDivers() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: keys.divers });
    void queryClient.invalidateQueries({ queryKey: keys.dives });
  };
}

/**
 * A Diver's SSI codes and the details they are built from (ADR 0043): the buddy code, and with a leader number the
 * professional's. Every User sees them; whoever may change the Diver edits the details here. The text of a code comes
 * from the API and is drawn as it is.
 */
export function DiverCodesDialog({ diverId, name, onClose }: { diverId: string; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const details = useQuery(diverDetailsQuery(diverId));
  const [editing, setEditing] = useState(false);
  const d = details.data;
  return (
    <Dialog title={t('diverCodes.title', { name })} isOpen onOpenChange={(open) => !open && onClose()}>
      <div className="diver-codes">
        {details.isPending && <Muted>{t('common.loading')}</Muted>}
        {details.error && <Notice tone="danger">{errorText(details.error)}</Notice>}
        {d && !editing && (
          <>
            {d.codes.length === 0 && <Muted>{t('diverCodes.noCode')}</Muted>}
            {d.codes.map((code) => (
              <CodeFigure key={code.kind} name={d.name} text={code.text} caption={t(`diverCodes.caption.${code.kind}`)}>
                <span>{t(`diverCodes.use.${code.kind}`, { name: d.name })}</span>
              </CodeFigure>
            ))}
            <dl className="facts">
              <div><dt>{t('diverCodes.ssiAccount')}</dt><dd translate="no">{d.accounts.find((a) => a.source === 'ssi')?.externalId ?? t('diverCodes.notSet')}</dd></div>
              {FIELDS.map((field) => (
                <div key={field}><dt>{t(`diverCodes.field.${field}`)}</dt><dd translate="no">{d[field] ?? t('diverCodes.notSet')}</dd></div>
              ))}
            </dl>
            <Muted>{t('diverCodes.seenByAll')}</Muted>
            {!d.canEdit && <Muted>{t('diverCodes.readOnly', { name: d.name })}</Muted>}
            <div className="form-actions">
              {d.canEdit && <Button icon="edit" onPress={() => setEditing(true)}>{t('diverCodes.edit')}</Button>}
              <Button onPress={onClose}>{t('diverCodes.done')}</Button>
            </div>
          </>
        )}
        {d && editing && <DetailsForm diver={d} onDone={() => setEditing(false)} />}
      </div>
    </Dialog>
  );
}

function DetailsForm({ diver: d, onDone }: { diver: DiverDetailsView; onDone: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const refresh = useRefreshDivers();
  const [values, setValues] = useState<Record<Field, string>>({
    firstName: d.firstName ?? '', lastName: d.lastName ?? '', email: d.email ?? '', leaderNumber: d.leaderNumber ?? '',
  });
  const set = (field: Field) => (value: string) => setValues((v) => ({ ...v, [field]: value }));
  const save = useMutation({
    mutationFn: async () => unwrap(await api.PATCH('/api/divers/{id}/details', {
      params: { path: { id: d.id } },
      body: Object.fromEntries(FIELDS.map((f) => [f, values[f].trim() || null])) as Record<Field, string | null>,
    })),
    onSuccess: async (updated) => {
      queryClient.setQueryData(keys.diverDetails(d.id), updated);
      await refresh();
      announce(t('diverCodes.saved'));
      onDone();
    },
  });
  return (
    <Form className="form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Muted>{t('diverCodes.formIntro', { name: d.name })}</Muted>
      <TextField label={t('diverCodes.field.firstName')} name="firstName" maxLength={100} autoComplete="off" autoFocus value={values.firstName} onChange={set('firstName')} />
      <TextField label={t('diverCodes.field.lastName')} name="lastName" maxLength={100} autoComplete="off" value={values.lastName} onChange={set('lastName')} />
      <TextField label={t('diverCodes.field.email')} description={t('diverCodes.emailHint')} name="email" type="email" maxLength={254} autoComplete="off" value={values.email} onChange={set('email')} />
      <TextField label={t('diverCodes.field.leaderNumber')} description={t('diverCodes.leaderNumberHint')} name="leaderNumber" maxLength={20} autoComplete="off" value={values.leaderNumber} onChange={set('leaderNumber')} />
      {save.error && <Notice tone="danger">{errorText(save.error)}</Notice>}
      <div className="form-actions">
        <Button type="submit" variant="primary" icon="save" isPending={save.isPending}>{t('diverCodes.save')}</Button>
        <Button onPress={onDone}>{t('common.cancel')}</Button>
      </div>
    </Form>
  );
}

/**
 * Takes a buddy's or a professional's code, scanned or pasted (ADR 0043). The server says whose it is: the Diver that
 * has its SSI account, with what would change, or nobody yet, and then the User chooses a Diver of that name or a new
 * one. Nothing of the scanned text is kept in the page beyond this dialog.
 */
export function TakeCodeDialog({ onClose, onTaken }: { onClose: () => void; onTaken: (diver: { id: string; name: string }) => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const refresh = useRefreshDivers();
  const [pasted, setPasted] = useState('');
  const [text, setText] = useState('');
  const [choice, setChoice] = useState('new');
  const read = useMutation({
    mutationFn: async (scanned: string) => unwrap(await api.POST('/api/verification-codes/read', { body: { text: scanned } })),
    onMutate: (scanned) => { setText(scanned); take.reset(); },
    onSuccess: (found) => { if (found.kind !== 'centre') setChoice(found.candidates[0]?.id ?? 'new'); },
  });
  const take = useMutation({
    mutationFn: async (target: { diverId?: string; create?: boolean }) => unwrap(await api.POST('/api/divers/from-code', { body: { text, ...target } })),
    onSuccess: async (diver) => {
      await refresh();
      announce(t('diverCodes.taken', { name: diver.name }));
      onTaken(diver);
    },
  });
  const found = read.data;
  const person: PersonCode | null = found && found.kind !== 'centre' ? found : null;
  const said = person ? `${person.firstName} ${person.lastName}`.trim() : '';

  return (
    <Dialog title={t('diverCodes.scanTitle')} isOpen onOpenChange={(open) => !open && onClose()}>
      <div className="diver-codes">
        <p>{t('diverCodes.scanIntro')}</p>
        <Form className="form" onSubmit={(e) => { e.preventDefault(); if (pasted.trim()) read.mutate(pasted.trim()); }}>
          <TextField label={t('diverCodes.pasteCode')} name="code" maxLength={1000} autoComplete="off" value={pasted} onChange={setPasted} />
          <CodeScanner onText={(scanned) => { setPasted(''); read.mutate(scanned); }}>
            <Button type="submit" isPending={read.isPending} isDisabled={!pasted.trim()}>{t('diverCodes.readCode')}</Button>
          </CodeScanner>
        </Form>
        {read.error && <Notice tone="danger">{errorText(read.error)}</Notice>}
        {found?.kind === 'centre' && <Notice tone="danger">{t('diverCodes.centreCode')} <a href="#/centres">{t('diverCodes.toCentres')}</a></Notice>}
        {person?.existing && (
          <section className="code-result" aria-live="polite">
            <p>{t(`diverCodes.isCodeOf.${person.kind}`, { name: person.existing.name })}</p>
            {person.existing.changes.length === 0 && <Muted>{t('diverCodes.nothingNew')}</Muted>}
            {person.existing.changes.length > 0 && (
              <>
                <p>{t('diverCodes.changes')}</p>
                <ul>
                  {person.existing.changes.map((c) => (
                    <li key={c.field}>
                      {t(`diverCodes.field.${c.field}`)}: <span translate="no">{c.from ?? t('diverCodes.notSet')} → {c.to}</span>
                    </li>
                  ))}
                </ul>
                {person.existing.canEdit
                  ? <Muted>{t('diverCodes.seenByAllShort')}</Muted>
                  : <Notice tone="info">{t('diverCodes.notYours', { name: person.existing.name })}</Notice>}
              </>
            )}
          </section>
        )}
        {person && !person.existing && (
          <section className="code-result" aria-live="polite">
            <p>{t(`diverCodes.unknown.${person.kind}`, { name: said })}</p>
            <RadioGroup
              label={t('diverCodes.whose')} value={choice} onChange={setChoice}
              options={[
                ...person.candidates.map((c) => ({ value: c.id, label: t('diverCodes.giveTo', { name: c.name }) })),
                { value: 'new', label: t('diverCodes.newDiver', { name: said }) },
              ]}
            />
            <Muted>{t('diverCodes.seenByAllShort')}</Muted>
          </section>
        )}
        {take.error && <Notice tone="danger">{errorText(take.error)}</Notice>}
        <div className="form-actions">
          {person?.existing?.canEdit && person.existing.changes.length > 0 && (
            <Button variant="primary" icon="save" isPending={take.isPending} onPress={() => take.mutate({})}>{t('diverCodes.take')}</Button>
          )}
          {person && !person.existing && (
            <Button variant="primary" icon="save" isPending={take.isPending} onPress={() => take.mutate(choice === 'new' ? { create: true } : { diverId: choice })}>
              {choice === 'new' ? t('diverCodes.addDiver') : t('diverCodes.take')}
            </Button>
          )}
          {person?.existing && person.existing.changes.length === 0
            ? <Button variant="primary" onPress={() => onTaken({ id: person.existing!.id, name: person.existing!.name })}>{t('diverCodes.showCodes')}</Button>
            : null}
          <Button onPress={onClose}>{t('common.cancel')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
