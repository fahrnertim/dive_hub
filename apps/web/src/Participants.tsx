import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api, ApiError, diverSearchQuery, keys, unwrap, type DiveView, type ParticipantRole, type ParticipantView,
} from './api.ts';
import { announce } from './lib/announce.ts';
import { useErrorText } from './lib/display.ts';
import { Button, Dialog, Muted, Notice, Panel, RadioGroup, SearchList, Select, type SearchListItem } from './ui/index.ts';

const ROLES: ParticipantRole[] = ['buddy', 'guide', 'instructor'];
/** The row that adds a new Diver by the name typed. */
const NEW = '__new__';

/**
 * Who else was on the Dive (ADR 0028): any Diver of the instance, as buddy, guide or instructor. Saved as one list with
 * the Dive's version; Providers that take buddies see the Dive changed.
 */
export function Participants({ dive: d }: { dive: DiveView }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const save = useMutation({
    mutationFn: async (participants: { diverId: string; role: ParticipantRole }[]) => unwrap(await api.PUT('/api/dives/{id}/participants', {
      params: { path: { id: d.id } }, body: { version: d.version, participants },
    })),
    onSuccess: async (updated) => {
      queryClient.setQueryData(keys.dive(d.id), updated);
      await queryClient.invalidateQueries({ queryKey: keys.revisions(d.id) });
      await queryClient.invalidateQueries({ queryKey: keys.diveProviders(d.id) });
    },
  });
  const list = d.participants.map(({ diverId, role }) => ({ diverId, role }));
  const without = (p: ParticipantView) => save.mutate(list.filter((x) => x.diverId !== p.diverId), {
    onSuccess: () => announce(t('participants.removed', { name: p.name })),
  });
  const withRole = (p: ParticipantView, role: ParticipantRole) => save.mutate(list.map((x) => (x.diverId === p.diverId ? { ...x, role } : x)), {
    onSuccess: () => announce(t('participants.roleChanged', { name: p.name, role: t(`participants.role.${role}`) })),
  });
  const stale = save.error instanceof ApiError && save.error.code === 'dive_changed';

  return (
    <Panel title={t('participants.title')}>
      {d.participants.length === 0
        ? <Muted>{t('participants.none')}</Muted>
        : (
          <ul className="diver-list">
            {d.participants.map((p) => (
              <li key={p.diverId} className="diver-row participant-row">
                <span className="diver-name">{p.name}</span>
                {/* Changing the role saves at once, like a Device's owner on the Divers page. */}
                <span className="participant-role">
                  <Select
                    label={<span className="visually-hidden">{t('participants.roleOf', { name: p.name })}</span>}
                    size="small" value={p.role}
                    onChange={(role) => role && role !== p.role && withRole(p, role)}
                    options={ROLES.map((r) => ({ id: r, label: t(`participants.role.${r}`) }))}
                  />
                </span>
                <span className="actions">
                  <Button variant="quiet" icon="delete" aria-label={t('common.forItem', { action: t('participants.remove'), item: p.name })}
                    isPending={save.isPending && save.variables?.length === list.length - 1} isDisabled={save.isPending} onPress={() => without(p)}>
                    {t('participants.remove')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      {save.error && !adding && <Notice tone="danger">{stale ? t('participants.changedMeanwhile') : errorText(save.error)}</Notice>}
      <div className="form-actions">
        <Button icon="add" onPress={() => { save.reset(); setAdding(true); }}>{t('participants.add')}</Button>
      </div>
      {adding && (
        <AddParticipant
          dive={d} onClose={() => setAdding(false)} isPending={save.isPending} error={save.error}
          onAdd={(diverId, role, name) => save.mutate([...list, { diverId, role }], {
            onSuccess: () => { announce(t('participants.added', { name, role: t(`participants.role.${role}`) })); setAdding(false); },
          })}
        />
      )}
    </Panel>
  );
}

/**
 * Picks someone to add: the role first (three choices, all shown), then the Diver from a live search over every Diver
 * of the instance by name (ux-search), or a new one by the name typed. Picking saves at once.
 */
function AddParticipant({ dive: d, onAdd, onClose, isPending, error }: {
  dive: DiveView; onAdd: (diverId: string, role: ParticipantRole, name: string) => void; onClose: () => void;
  isPending: boolean; error: Error | null;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<ParticipantRole>('buddy');
  const [text, setText] = useState('');
  const query = text.trim();
  const found = useQuery(diverSearchQuery(query));
  const create = useMutation({
    mutationFn: async (name: string) => unwrap(await api.POST('/api/external-divers', { body: { name } })),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: keys.divers });
      onAdd(created.id, role, created.name);
    },
  });
  const taken = new Set([d.diverId, ...d.participants.map((p) => p.diverId)]);
  const choices = (found.data ?? []).filter((x) => !taken.has(x.id));
  const items: SearchListItem[] = choices.map((x) => ({
    id: x.id, name: x.name,
    detail: x.managed ? t('participants.yours') : x.external ? t('participants.external') : t('participants.otherUser'),
  }));
  const exact = choices.some((x) => x.name.toLocaleLowerCase() === query.toLocaleLowerCase());
  if (query && !exact) items.push({ id: NEW, name: t('participants.addNew', { name: query }), detail: t('participants.addNewDetail') });
  const pick = (id: string) => {
    if (id === NEW) create.mutate(query);
    else onAdd(id, role, choices.find((x) => x.id === id)?.name ?? '');
  };
  // An empty list says why: React Aria shows it as the list's only option, which needs a name.
  const status = found.isPending ? t('common.loading') : null;
  const empty = query ? t('participants.noMatch', { q: query }) : t('participants.typeName');

  return (
    <Dialog title={t('participants.addTitle')} isOpen onOpenChange={(open) => !open && onClose()}>
      <div className="provider-sites">
        <RadioGroup
          label={t('participants.as')} value={role} onChange={(v) => setRole(v as ParticipantRole)}
          options={ROLES.map((r) => ({ value: r, label: t(`participants.role.${r}`) }))}
        />
        <SearchList
          label={t('participants.who')} description={t('participants.sharedHint')} query={text} onQueryChange={setText} autoFocus
          items={items} onPick={pick} isPending={isPending || create.isPending} pendingStatus={t('common.saving')}
          listLabel={t('participants.divers')} status={status} empty={empty}
        />
        {(create.error ?? error) && <Notice tone="danger">{errorText(create.error ?? error)}</Notice>}
        <div className="form-actions">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
