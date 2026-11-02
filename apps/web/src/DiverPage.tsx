import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, diversQuery, keys, unwrap, type DiverView } from './api.ts';
import { BodyWeightDialog } from './BodyWeight.tsx';
import { CertificationsSection } from './Certifications.tsx';
import { DiverCodesDialog } from './DiverCodes.tsx';
import { announce } from './lib/announce.ts';
import { useErrorText } from './lib/display.ts';
import { focusHeading } from './lib/focus.ts';
import { usePageTitle } from './lib/page.ts';
import {
  ActionMenu, Button, Checkbox, ConfirmDialog, Disclosure, Form, NotFoundPage, Notice, NumberField, PageHeader, Panel, RowsSkeleton, TextField,
} from './ui/index.ts';

/** A warning when another Diver already has this name (still allowed; UI review C9). */
export function useSameName() {
  const { t } = useTranslation();
  return (divers: DiverView[] | undefined, name: string, except?: string) => {
    const wanted = name.trim().toLocaleLowerCase();
    const twin = wanted && divers?.find((d) => d.id !== except && d.name.toLocaleLowerCase() === wanted);
    return twin ? t('divers.sameName', { name: twin.name }) : undefined;
  };
}

/**
 * A Diver whose logbook the User keeps, on their own page (UI overhaul): certifications, dive numbers, codes, body
 * weight, rename and delete, which the Divers list used to open inline. `open` is the address's `open=certifications`
 * (the profile menu's "My certifications" leads here).
 */
export function DiverPage({ id, open }: { id: string; open?: 'certifications' | undefined }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const divers = useQuery(diversQuery());
  const diver = divers.data?.find((d) => d.id === id);
  usePageTitle(diver?.name ?? (divers.data ? t('divers.notFound') : undefined));
  const back = { href: '#/divers', label: t('divers.back') };
  if (divers.isPending) return <RowsSkeleton rows={4} />;
  if (divers.error) return <><PageHeader title={t('divers.title')} back={back} /><Notice tone="danger">{errorText(divers.error)}</Notice></>;
  if (!diver) return <NotFoundPage title={t('divers.notFound')} message={t('divers.notFoundBody')} back={{ href: back.href, label: t('divers.backToDivers') }} />;
  return <DiverDetails diver={diver} all={divers.data} open={open} back={back} />;
}

function DiverDetails({ diver: d, all, open, back }: {
  diver: DiverView; all: DiverView[]; open: 'certifications' | undefined; back: { href: string; label: string };
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const sameName = useSameName();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(d.name);
  const [codes, setCodes] = useState(false);
  const [weight, setWeight] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const rename = useMutation({
    mutationFn: async (name: string) => unwrap(await api.PATCH('/api/divers/{id}', { params: { path: { id: d.id } }, body: { name } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.divers });
      setRenaming(false);
      focusHeading();
    },
  });
  const remove = useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/api/divers/{id}', { params: { path: { id: d.id } } })),
  });
  const empty = d.diveCount === 0 && d.deviceCount === 0;
  const actions = [
    { id: 'rename', label: t('divers.rename'), icon: 'edit' as const, onAction: () => { setNewName(d.name); setRenaming(true); } },
    ...(!d.isOwn && empty ? [{ id: 'delete', label: t('divers.delete'), icon: 'delete' as const, onAction: () => setDeleting(true) }] : []),
  ];

  return (
    <>
      <PageHeader
        back={back} title={<span translate="no">{d.name}</span>}
        meta={<p className="meta"><a href={`#/?diver=${d.id}`}>{t('divers.dives', { count: d.diveCount })}</a>{d.isOwn && ` · ${t('divers.own')}`}</p>}
        actions={(
          <>
            <Button aria-label={t('common.forItem', { action: t('diverCodes.open'), item: d.name })} onPress={() => setCodes(true)}>{t('diverCodes.open')}</Button>
            <Button aria-label={t('common.forItem', { action: t('bodyWeight.open'), item: d.name })} onPress={() => setWeight(true)}>{t('bodyWeight.open')}</Button>
            <ActionMenu label={t('divers.actions')} aria-label={t('common.forItem', { action: t('divers.actions'), item: d.name })} actions={actions} />
          </>
        )}
      />
      {renaming && (
        <Form className="form-inline" onSubmit={(e) => { e.preventDefault(); rename.mutate(newName.trim()); }}>
          <TextField
            label={t('divers.newName')} name="name" value={newName} onChange={setNewName} isRequired maxLength={100} autoComplete="off" autoFocus
            description={sameName(all, newName, d.id) ?? ''}
          />
          <Button type="submit" variant="primary" icon="save" isPending={rename.isPending}>{t('divers.save')}</Button>
          <Button onPress={() => { setRenaming(false); focusHeading(); }}>{t('common.cancel')}</Button>
        </Form>
      )}
      {rename.error && <Notice tone="danger">{errorText(rename.error)}</Notice>}
      <Panel>
        {/* Which section is open lives in the address, so a link (the profile menu's) can point at it. */}
        <CertificationsSection
          diver={d} isOpen={open === 'certifications'}
          onOpenChange={(on) => location.replace(on ? `#/divers/${d.id}?open=certifications` : `#/divers/${d.id}`)}
        />
        <DiveNumbers diver={d} />
        <MutedRules diver={d} />
      </Panel>
      {codes && <DiverCodesDialog diverId={d.id} name={d.name} onClose={() => setCodes(false)} />}
      {weight && <BodyWeightDialog diverId={d.id} name={d.name} onClose={() => setWeight(false)} />}
      <ConfirmDialog
        isOpen={deleting} onOpenChange={setDeleting} title={t('divers.deleteTitle', { name: d.name })} body={t('divers.deleteBody', { name: d.name })}
        confirmLabel={t('divers.delete')} onConfirm={() => remove.mutateAsync()}
        // The page goes with the Diver: back to the list, which looks again.
        onDone={() => { location.hash = '#/divers'; void queryClient.invalidateQueries({ queryKey: keys.divers }); }}
      />
    </>
  );
}

/**
 * How this Diver's Dives are numbered (ADR 0048): by start time, after the dives they did before this logbook, and
 * with or without apnea sessions. The numbers follow at once, in the logbook and at the Providers that follow them.
 */
function DiveNumbers({ diver: d }: { diver: DiverView }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: async (body: { divesBefore?: number; apneaCounts?: boolean }) => unwrap(await api.PATCH('/api/divers/{id}', { params: { path: { id: d.id } }, body })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.divers });
      // Every Dive's number may have moved.
      await queryClient.invalidateQueries({ queryKey: keys.dives });
      announce(t('divers.numbersSaved', { name: d.name }));
    },
  });
  // Behind a line that shows the current values (UI/UX pass C7): three Divers no longer make a page of number fields.
  const summary = <span className="meta">{t(d.apneaCounts ? 'divers.numbersSummary' : 'divers.numbersSummaryNoApnea', { next: d.divesBefore + 1 })}</span>;
  return (
    <Disclosure
      className="diver-section" summary={summary}
      title={<><span aria-hidden="true">{t('divers.numbersShort')}</span><span className="visually-hidden">{t('common.forItem', { action: t('divers.numbersShort'), item: d.name })}</span></>}
    >
      <fieldset className="dive-numbers">
        <legend className="visually-hidden">{t('divers.numbers', { name: d.name })}</legend>
        <NumberField
          label={t('divers.divesBefore')} description={t('divers.divesBeforeHint')} value={d.divesBefore} minValue={0} maxValue={100_000} step={1}
          onChange={(n) => { if (!Number.isNaN(n) && n !== d.divesBefore) save.mutate({ divesBefore: n }); }}
        />
        <Checkbox isSelected={d.apneaCounts} onChange={(on) => save.mutate({ apneaCounts: on })}>
          {t('divers.apneaCounts')}
        </Checkbox>
        {save.error && <Notice tone="danger">{errorText(save.error)}</Notice>}
      </fieldset>
    </Disclosure>
  );
}

/**
 * Rules of the dive assessment a User stopped showing for this Diver (ADR 0036), with the way back: a muted rule shows
 * on no Dive, so this is where it is found again.
 */
function MutedRules({ diver: d }: { diver: DiverView }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const show = useMutation({
    mutationFn: async (rule: string) => {
      unwrap(await api.PUT('/api/divers/{id}/muted-rules/{rule}', { params: { path: { id: d.id, rule: rule as 'ascent_rate' } }, body: { muted: false } }));
      return rule;
    },
    onSuccess: async (rule) => {
      await queryClient.invalidateQueries({ queryKey: keys.divers });
      // The Dives' marks and assessments follow.
      void queryClient.invalidateQueries({ queryKey: keys.dives });
      announce(t('assessment.restored', { title: t(`assessment.title.${rule}` as 'assessment.title.ascent_rate') }));
    },
  });
  if (d.mutedRules.length === 0) return null;
  return (
    <div className="muted-rules">
      <span className="meta">{t('divers.mutedRules', { name: d.name })}</span>
      <ul>
        {d.mutedRules.map((rule) => {
          const title = t(`assessment.title.${rule}` as 'assessment.title.ascent_rate');
          return (
            <li key={rule}>
              {title}
              <Button
                variant="quiet" size="small" aria-label={t('common.forItem', { action: t('divers.showRule'), item: `${title}, ${d.name}` })}
                isPending={show.isPending && show.variables === rule} isDisabled={show.isPending} onPress={() => show.mutate(rule)}
              >
                {t('divers.showRule')}
              </Button>
            </li>
          );
        })}
      </ul>
      {show.error && <Notice tone="danger">{errorText(show.error)}</Notice>}
    </div>
  );
}
