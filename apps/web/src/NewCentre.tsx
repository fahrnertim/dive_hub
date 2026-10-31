import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, unwrap, type CentreView } from './api.ts';
import { CodeScanner } from './CodeScanner.tsx';
import { announce } from './lib/announce.ts';
import { useCentreRefresh } from './lib/centres.ts';
import { useErrorText } from './lib/display.ts';
import { Button, Form, Notice, TextField } from './ui/index.ts';

/** "Another centre already has this number", with the way to it. */
export function TakenNotice({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  if (!error) return null;
  const centre = error instanceof ApiError ? error.details.centre : undefined;
  return (
    <Notice tone="danger">
      {errorText(error)}{centre && <> <a href={`#/centres/${centre.id}`}>{t('centres.open', { name: centre.name })}</a></>}
    </Notice>
  );
}

/**
 * A new centre: typed, or from the text of its SSI code, which the server reads (the format is the server's, ADR 0043).
 * `siteId`: the Dive site it is created for, linked in the same step.
 */
export function NewCentre({ siteId, onCreated, onCancel }: { siteId?: string; onCreated: (centre: CentreView) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const refresh = useCentreRefresh();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [other, setOther] = useState<'buddy' | 'professional' | null>(null);
  const [existing, setExisting] = useState<{ id: string; name: string } | null>(null);
  const read = useMutation({
    mutationFn: async (text: string) => unwrap(await api.POST('/api/verification-codes/read', { body: { text } })),
    onMutate: () => { setOther(null); setExisting(null); },
    onSuccess: (found) => {
      if (found.kind !== 'centre') { setOther(found.kind); return; }
      setName(found.name);
      setNumber(found.centreNumber);
      setExisting(found.existing);
      announce(t('centres.codeRead', { name: found.name }));
    },
  });
  const create = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/dive-centres', {
      body: {
        name: name.trim(),
        ...(number.trim() && { externalIds: [{ source: 'ssi' as const, externalId: number.trim() }] }),
        ...(siteId && { siteIds: [siteId] }),
      },
    })),
    onSuccess: async (created) => { await refresh(created); onCreated(created); },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <div className="form">
      <Form className="form" onSubmit={(e) => { e.preventDefault(); if (code.trim()) read.mutate(code.trim()); }}>
        <TextField
          label={t('centres.pasteCode')} description={t('centres.pasteCodeHint')} name="code" maxLength={1000} autoComplete="off" spellCheck="false"
          value={code} onChange={setCode}
        />
        {/* A scanned text goes to the server and not into the field: a diver's code holds an e-mail. */}
        <CodeScanner onText={(text) => read.mutate(text)}>
          <Button type="submit" icon="code" isPending={read.isPending} isDisabled={!code.trim()}>{t('centres.readCode')}</Button>
        </CodeScanner>
        {read.error && <Notice tone="danger">{errorText(read.error)}</Notice>}
        {other && <Notice tone="danger">{t(`centres.otherCode.${other}`)}</Notice>}
        {existing && <Notice>{t('centres.alreadyHere', { name: existing.name })} <a href={`#/centres/${existing.id}`}>{t('centres.open', { name: existing.name })}</a></Notice>}
      </Form>
      <Form className="form" onSubmit={submit}>
        <TextField label={t('centres.name')} description={t('centres.nameHint')} name="name" isRequired maxLength={200} autoComplete="off" value={name} onChange={setName} />
        <TextField
          label={t('centres.ssiNumber')} description={t('centres.ssiNumberHint')} name="ssiNumber" inputMode="numeric" pattern="[0-9]*"
          maxLength={10} autoComplete="off" value={number} onChange={setNumber}
        />
        <TakenNotice error={create.error} />
        <div className="form-actions">
          <Button type="submit" variant="primary" icon="add" isPending={create.isPending}>{t('centres.create')}</Button>
          <Button onPress={onCancel}>{t('common.cancel')}</Button>
        </div>
      </Form>
    </div>
  );
}
