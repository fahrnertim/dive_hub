import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api, certificationsQuery, connectionsQuery, keys, unwrap, type CertificationView, type ConnectionView, type ProviderView,
} from './api.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { useProviders } from './lib/providers.ts';
import { Badge, Button, ConfirmButton, Dialog, Form, Checkbox, Muted, Notice, NumberField, TextArea, TextField } from './ui/index.ts';

type ImportResult = { name: string; created: number; updated: number; unchanged: number; items: { result: string; level: string }[] };

/**
 * A Diver's certification cards (ADR 0050): typed by the Users who keep the Diver, or read from a Provider's account.
 * An imported card is the agency's record: only its notes are edited. Seen and changed only by those Users.
 */
export function CertificationsDialog({ diverId, name, onClose }: { diverId: string; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<CertificationView | 'new' | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const cards = useQuery({
    ...certificationsQuery(diverId),
    // Pictures come afterwards, by a job: look again while one is on its way.
    refetchInterval: (q) => (q.state.data?.some((c) => c.imageState === 'pending') ? 3000 : false),
  });
  const providers = useProviders();
  const connections = useQuery(connectionsQuery());
  const importable = (connections.data ?? [])
    .filter((c) => c.diverId === diverId && c.state === 'active')
    .flatMap((c) => {
      const p = providers.data?.find((x) => x.id === c.provider);
      return p?.data.certifications?.import?.operations.includes('find') ? [{ connection: c, provider: p }] : [];
    });
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.certifications(diverId) });
  const remove = useMutation({
    mutationFn: async (c: CertificationView) => unwrap(await api.DELETE('/api/divers/{id}/certifications/{certificationId}', {
      params: { path: { id: diverId, certificationId: c.id } },
    })),
    onSuccess: refresh,
  });
  const again = useMutation({
    mutationFn: async (c: CertificationView) => unwrap(await api.POST('/api/divers/{id}/certifications/{certificationId}/image', {
      params: { path: { id: diverId, certificationId: c.id } },
    })),
    onSuccess: refresh,
  });
  const importFrom = useMutation({
    mutationFn: async (x: { connection: ConnectionView; provider: ProviderView }) => ({
      name: x.provider.name,
      answer: unwrap(await api.POST('/api/connections/{id}/certifications/import', { params: { path: { id: x.connection.id } } })),
    }),
    onSuccess: async ({ name: provider, answer }) => {
      await refresh();
      setResult({ name: provider, ...answer });
      announce(t('certifications.imported', { count: answer.created + answer.updated, name: provider }));
    },
  });

  return (
    <Dialog title={t('certifications.title', { name })} isOpen onOpenChange={(open) => !open && onClose()}>
      <div className="certifications">
        <Muted>{t('certifications.privacy')} {t('certifications.intro')}</Muted>
        {editing ? (
          <CertificationForm
            diverId={diverId} card={editing === 'new' ? null : editing} suggestions={[...new Set((cards.data ?? []).map((c) => c.agency))]}
            onDone={() => setEditing(null)} onSaved={refresh}
          />
        ) : (
          <>
            {cards.isPending && <Muted>{t('common.loading')}</Muted>}
            {cards.error && <Notice tone="danger">{errorText(cards.error)}</Notice>}
            {cards.data?.length === 0 && <Muted>{t('certifications.none')}</Muted>}
            {cards.data && cards.data.length > 0 && (
              <ul className="certification-list">
                {cards.data.map((c) => (
                  <CertificationItem
                    key={c.id} card={c} onEdit={() => { setResult(null); setEditing(c); }}
                    onRemove={() => remove.mutateAsync(c)} onAgain={() => again.mutate(c)} againPending={again.isPending && again.variables?.id === c.id}
                  />
                ))}
              </ul>
            )}
            {(remove.error ?? again.error) && <Notice tone="danger">{errorText(remove.error ?? again.error)}</Notice>}
            <div className="form-actions">
              <Button icon="add" onPress={() => { setResult(null); setEditing('new'); }}>{t('certifications.add')}</Button>
              {importable.map((x) => (
                <Button
                  key={x.connection.id} icon="import" isPending={importFrom.isPending && importFrom.variables?.connection.id === x.connection.id}
                  onPress={() => { setResult(null); importFrom.mutate(x); }}
                >
                  {t('certifications.importFrom', { name: x.provider.name })}
                </Button>
              ))}
            </div>
            {importFrom.error && <Notice tone="danger">{errorText(importFrom.error)}</Notice>}
            {result && <ImportReport result={result} onDismiss={() => setResult(null)} />}
          </>
        )}
      </div>
    </Dialog>
  );
}

function ImportReport({ result, onDismiss }: { result: ImportResult; onDismiss: () => void }) {
  const { t } = useTranslation();
  const left = result.items.filter((i) => i.result === 'deleted_earlier' || i.result === 'not_at_provider');
  const nothing = result.created + result.updated + result.unchanged + left.length === 0;
  return (
    <Notice tone="success">
      <p>
        {nothing
          ? t('certifications.report.nothing', { name: result.name })
          : t('certifications.report.summary', { name: result.name, created: result.created, updated: result.updated, unchanged: result.unchanged })}
      </p>
      {left.length > 0 && (
        <ul>
          {left.map((i, n) => <li key={n}>{t(`certifications.report.${i.result as 'deleted_earlier' | 'not_at_provider'}`, { level: i.level })}</li>)}
        </ul>
      )}
      <Button
        variant="quiet" size="small" aria-label={t('common.forItem', { action: t('common.dismiss'), item: t('certifications.report.title', { name: result.name }) })}
        onPress={onDismiss}
      >
        {t('common.dismiss')}
      </Button>
    </Notice>
  );
}

function CertificationItem({ card: c, onEdit, onRemove, onAgain, againPending }: {
  card: CertificationView; onEdit: () => void; onRemove: () => Promise<unknown>; onAgain: () => void; againPending: boolean;
}) {
  const { t } = useTranslation();
  const display = useDisplay();
  const label = `${c.agency} ${c.level}`;
  const where = [c.centreName, c.centreCity, c.centreCountry].filter(Boolean).join(', ');
  const facts: [string, string][] = [
    ...(c.number ? [[t('certifications.number'), c.number] as [string, string]] : []),
    ...(c.issuedOn ? [[t('certifications.issuedOn'), display.date(c.issuedOn)] as [string, string]] : []),
    ...(c.expiresOn ? [[t('certifications.expiresOn'), display.date(c.expiresOn)] as [string, string]] : []),
    ...(c.divesAtIssue !== null ? [[t('certifications.divesAtIssue'), String(c.divesAtIssue)] as [string, string]] : []),
    ...(c.instructorName ? [[t('certifications.instructor'), [c.instructorName, c.instructorNumber].filter(Boolean).join(' · ')] as [string, string]] : []),
    ...(where ? [[t('certifications.centre'), where] as [string, string]] : []),
  ];
  return (
    <li className="certification">
      <div className="certification-head">
        <strong className="certification-title">{label}</strong>
        <Badge tone={c.verification === 'verified_with_agency' ? 'success' : 'neutral'}>{t(`certifications.verification.${c.verification}`)}</Badge>
      </div>
      {facts.length > 0 && (
        <dl className="certification-facts">
          {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      {c.notes && <p className="certification-notes">{c.notes}</p>}
      {c.imageState === 'stored' && c.imageUrl && (
        <img className="certification-picture" src={c.imageUrl} alt={t('certifications.pictureAlt', { name: label })} loading="lazy" />
      )}
      {c.imageState === 'pending' && <Muted>{t('certifications.picturePending')}</Muted>}
      {c.imageState === 'failed' && (
        <p className="certification-picture-failed">
          <span className="muted">{t('certifications.pictureFailed')}</span>{' '}
          <Button size="small" icon="undo" isPending={againPending} aria-label={t('common.forItem', { action: t('certifications.fetchAgain'), item: label })} onPress={onAgain}>
            {t('certifications.fetchAgain')}
          </Button>
        </p>
      )}
      <span className="actions">
        <Button variant="quiet" size="small" icon="edit" aria-label={t('common.forItem', { action: t('certifications.edit'), item: label })} onPress={onEdit}>
          {t('certifications.edit')}
        </Button>
        <ConfirmButton
          variant="quiet" size="small" icon="delete" aria-label={t('common.forItem', { action: t('certifications.delete'), item: label })}
          title={t('certifications.deleteTitle', { name: label })}
          body={c.source ? t('certifications.deleteImportedBody') : t('certifications.deleteBody')}
          confirmLabel={t('certifications.delete')} onConfirm={onRemove}
        >
          {t('certifications.delete')}
        </ConfirmButton>
      </span>
    </li>
  );
}

const orNull = (s: string) => (s.trim() === '' ? null : s.trim());

/** Typing a card, or (an imported one) its notes only. Agency suggestions are the agencies of the Diver's other cards. */
function CertificationForm({ diverId, card, suggestions, onDone, onSaved }: {
  diverId: string; card: CertificationView | null; suggestions: string[]; onDone: () => void; onSaved: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const readOnly = !!card?.source;
  const [agency, setAgency] = useState(card?.agency ?? '');
  const [level, setLevel] = useState(card?.level ?? '');
  const [number, setNumber] = useState(card?.number ?? '');
  const [issuedOn, setIssuedOn] = useState(card?.issuedOn ?? '');
  const [expiresOn, setExpiresOn] = useState(card?.expiresOn ?? '');
  const [dives, setDives] = useState(card?.divesAtIssue ?? Number.NaN);
  const [instructorName, setInstructorName] = useState(card?.instructorName ?? '');
  const [instructorNumber, setInstructorNumber] = useState(card?.instructorNumber ?? '');
  const [centreName, setCentreName] = useState(card?.centreName ?? '');
  const [centreCity, setCentreCity] = useState(card?.centreCity ?? '');
  const [centreCountry, setCentreCountry] = useState(card?.centreCountry ?? '');
  const [cardSeen, setCardSeen] = useState(card?.verification === 'card_seen');
  const [notes, setNotes] = useState(card?.notes ?? '');
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        agency: agency.trim(), level: level.trim(), number: orNull(number), issuedOn: orNull(issuedOn), expiresOn: orNull(expiresOn),
        divesAtIssue: Number.isNaN(dives) ? null : dives, instructorName: orNull(instructorName), instructorNumber: orNull(instructorNumber),
        centreName: orNull(centreName), centreCity: orNull(centreCity), centreCountry: orNull(centreCountry),
        notes: orNull(notes), cardSeen,
      };
      if (!card) return unwrap(await api.POST('/api/divers/{id}/certifications', { params: { path: { id: diverId } }, body }));
      // An imported card takes notes only: the other fields are the agency's.
      const sent = readOnly ? { notes: body.notes } : body;
      return unwrap(await api.PUT('/api/divers/{id}/certifications/{certificationId}', {
        params: { path: { id: diverId, certificationId: card.id } },
        body: { version: card.version, agency: card.agency, level: card.level, ...sent },
      }));
    },
    onSuccess: async () => { await onSaved(); onDone(); },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); save.mutate(); };
  const others = suggestions.filter((s) => s.toLowerCase() !== agency.trim().toLowerCase());

  return (
    <Form className="certification-form" onSubmit={submit}>
      <h3 className="certification-form-title">{card ? t('certifications.editTitle', { name: `${card.agency} ${card.level}` }) : t('certifications.addTitle')}</h3>
      {readOnly && <Notice>{t('certifications.readOnly', { source: card.source ?? '' })}</Notice>}
      {!readOnly && (
        <>
          <TextField label={t('certifications.agency')} name="agency" isRequired maxLength={100} value={agency} onChange={setAgency} autoComplete="off" autoFocus />
          {others.length > 0 && (
            <div className="certification-suggestions" role="group" aria-label={t('certifications.suggestions')}>
              {others.map((s) => <Button key={s} size="small" variant="quiet" onPress={() => setAgency(s)}>{s}</Button>)}
            </div>
          )}
          <TextField label={t('certifications.level')} name="level" isRequired maxLength={200} value={level} onChange={setLevel} autoComplete="off" description={t('certifications.levelHelp')} />
          <TextField label={t('certifications.number')} name="number" maxLength={60} value={number} onChange={setNumber} autoComplete="off" />
          <div className="certification-row">
            <TextField label={t('certifications.issuedOn')} name="issuedOn" type="date" value={issuedOn} onChange={setIssuedOn} />
            <TextField label={t('certifications.expiresOn')} name="expiresOn" type="date" value={expiresOn} onChange={setExpiresOn} />
            <NumberField label={t('certifications.divesAtIssue')} value={dives} onChange={setDives} minValue={0} maxValue={100000} formatOptions={{ maximumFractionDigits: 0 }} />
          </div>
          <div className="certification-row">
            <TextField label={t('certifications.instructorName')} name="instructorName" maxLength={200} value={instructorName} onChange={setInstructorName} autoComplete="off" />
            <TextField label={t('certifications.instructorNumber')} name="instructorNumber" maxLength={60} value={instructorNumber} onChange={setInstructorNumber} autoComplete="off" />
          </div>
          <div className="certification-row">
            <TextField label={t('certifications.centreName')} name="centreName" maxLength={200} value={centreName} onChange={setCentreName} autoComplete="off" />
            <TextField label={t('certifications.centreCity')} name="centreCity" maxLength={100} value={centreCity} onChange={setCentreCity} autoComplete="off" />
            <TextField label={t('certifications.centreCountry')} name="centreCountry" maxLength={100} value={centreCountry} onChange={setCentreCountry} autoComplete="off" />
          </div>
          <Checkbox isSelected={cardSeen} onChange={setCardSeen}>{t('certifications.cardSeen')}</Checkbox>
        </>
      )}
      <TextArea label={t('certifications.notes')} name="notes" maxLength={2000} value={notes} onChange={setNotes} />
      {save.error && <Notice tone="danger">{errorText(save.error)}</Notice>}
      <div className="form-actions">
        <Button type="submit" variant="primary" icon="save" isPending={save.isPending}>{t('certifications.save')}</Button>
        <Button onPress={onDone}>{t('common.cancel')}</Button>
      </div>
    </Form>
  );
}
