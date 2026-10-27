import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  api, ApiError, buddiesQuery, diverSearchQuery, keys, unwrap, type BuddyView, type ConnectionView, type ProviderView,
} from './api.ts';
import { announce } from './lib/announce.ts';
import { useErrorText } from './lib/display.ts';
import { useProviderText } from './lib/providers.ts';
import { Button, Dialog, Muted, Notice, SearchList, Table, type SearchListItem } from './ui/index.ts';

/**
 * The account's own list of people at a Provider (ADR 0029; SSI's buddy list), read only when asked: who is a Diver
 * here already, and adding the others, one by one or all at once, with their name, account and what their code says
 * (ADR 0043). An entry can also be linked to a Diver here by hand, and Divers already here get what they lack.
 */
export function ProviderBuddies({ provider: p, connection: c }: { provider: ProviderView; connection: ConnectionView }) {
  const pt = useProviderText(p);
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [linking, setLinking] = useState<BuddyView | null>(null);
  const buddies = useQuery({ ...buddiesQuery(c.id), enabled: open });
  const add = useMutation({
    mutationFn: async (chosen: { accounts: string[]; entries: string[] }) => unwrap(await api.POST('/api/connections/{id}/buddies/import', {
      params: { path: { id: c.id } }, body: chosen,
    })),
    onSuccess: async (answer) => {
      queryClient.setQueryData(keys.buddies(c.id), answer.buddies);
      await queryClient.invalidateQueries({ queryKey: keys.divers });
      announce(pt('buddiesAdded' as 'buddiesAdded_one', { count: answer.created }));
    },
  });
  // Divers already here: the same call fills what they lack of what the list says about them, and overwrites nothing.
  const fill = useMutation({
    mutationFn: async (accounts: string[]) => unwrap(await api.POST('/api/connections/{id}/buddies/import', {
      params: { path: { id: c.id } }, body: { accounts },
    })),
    onSuccess: async (answer) => {
      await queryClient.invalidateQueries({ queryKey: keys.divers });
      void queryClient.invalidateQueries({ queryKey: keys.dives });
      announce(answer.updated > 0 ? pt('detailsFilled' as 'detailsFilled_one', { count: answer.updated }) : pt('nothingToFill'));
    },
  });
  if (!p.data.buddies?.import?.operations.includes('find') || c.state !== 'active') return null;
  if (!open) {
    return (
      <div className="form-actions">
        <Button icon="divers" aria-label={t('common.forItem', { action: pt('showBuddies'), item: c.accountLabel })} onPress={() => setOpen(true)}>
          {pt('showBuddies')}
        </Button>
      </div>
    );
  }
  const list = buddies.data ?? [];
  // An entry with an account is added by it; one without by its entry (it needs a name to become a Diver).
  const addable = list.filter((b) => !b.diver && (b.account || b.name));
  const here = list.filter((b) => b.account && b.diver);
  const chosen = (bs: BuddyView[]) => ({ accounts: bs.flatMap((b) => (b.account ? [b.account] : [])), entries: bs.flatMap((b) => (!b.account ? [b.entryId] : [])) });
  const count = (v: { accounts: string[]; entries: string[] } | undefined) => (v?.accounts.length ?? 0) + (v?.entries.length ?? 0);
  const isAdding = (b: BuddyView) => count(add.variables) === 1 && (add.variables?.accounts[0] === b.account || add.variables?.entries[0] === b.entryId);

  return (
    <section className="provider-buddies">
      <h3>{pt('buddyList')}</h3>
      <Muted>{pt('buddiesIntro')}</Muted>
      {buddies.isPending && <Muted>{t('common.loading')}</Muted>}
      {buddies.error && <Notice tone="danger">{errorText(buddies.error)}</Notice>}
      {buddies.data && list.length === 0 && <Muted>{pt('noBuddies')}</Muted>}
      {list.length > 0 && (
        <Table cards label={pt('buddyList')} head={[pt('buddyName'), pt('buddyHere'), { label: t('common.actions'), hidden: true }]}>
          {list.map((b) => (
            <tr key={b.entryId}>
              <td>{b.name || pt('noNameYet')}</td>
              <td>{b.diver ? b.diver.name : b.account ? pt('notHereYet') : pt('noAccount')}</td>
              <td>
                {!b.diver && (
                  <span className="actions">
                    {(b.account || b.name) && (
                      <Button variant="quiet" icon="add" aria-label={t('common.forItem', { action: pt('addBuddy'), item: b.name || pt('noNameYet') })}
                        isPending={add.isPending && isAdding(b)} isDisabled={add.isPending}
                        onPress={() => add.mutate(chosen([b]))}>
                        {pt('addBuddy')}
                      </Button>
                    )}
                    <Button variant="quiet" icon="link" aria-label={t('common.forItem', { action: pt('linkBuddy'), item: b.name || pt('noNameYet') })}
                      onPress={() => setLinking(b)}>
                      {pt('linkBuddy')}
                    </Button>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {(add.error ?? fill.error) && <Notice tone="danger">{errorText(add.error ?? fill.error)}</Notice>}
      {fill.data && <Notice tone="info">{fill.data.updated > 0 ? pt('detailsFilled' as 'detailsFilled_one', { count: fill.data.updated }) : pt('nothingToFill')}</Notice>}
      <div className="form-actions">
        {addable.length > 1 && (
          <Button variant="primary" icon="add" isPending={add.isPending && count(add.variables) > 1} isDisabled={add.isPending}
            onPress={() => add.mutate(chosen(addable))}>
            {pt('addAllBuddies' as 'addAllBuddies_one', { count: addable.length })}
          </Button>
        )}
        {here.length > 0 && (
          <Button isPending={fill.isPending} isDisabled={add.isPending} onPress={() => fill.mutate(here.map((b) => b.account!))}>{pt('fillDetails')}</Button>
        )}
        <Button onPress={() => setOpen(false)}>{pt('hideBuddies')}</Button>
      </div>
      <Muted>{pt('buddiesKept')}</Muted>
      {linking && <LinkBuddy provider={p} connection={c} buddy={linking} onClose={() => setLinking(null)} />}
    </section>
  );
}

/** Links an entry of the list to a Diver here, by giving that Diver the entry's account (ADR 0028). */
function LinkBuddy({ provider: p, connection: c, buddy: b, onClose }: {
  provider: ProviderView; connection: ConnectionView; buddy: BuddyView; onClose: () => void;
}) {
  const pt = useProviderText(p);
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const found = useQuery(diverSearchQuery(text.trim()));
  // An entry with an account gives the Diver that account; one without is only remembered for the Diver.
  const link = useMutation({
    mutationFn: async (diverId: string) => unwrap(await api.POST('/api/connections/{id}/buddies/link', {
      params: { path: { id: c.id } }, body: { entryId: b.entryId, diverId },
    })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.buddies(c.id) });
      await queryClient.invalidateQueries({ queryKey: keys.divers });
      announce(pt('buddyLinkedTo', { name: b.name || pt('noNameYet') }));
      onClose();
    },
  });
  const items: SearchListItem[] = (found.data ?? []).map((x) => ({
    id: x.id, name: x.name, detail: x.managed ? t('participants.yours') : x.external ? t('participants.external') : t('participants.otherUser'),
  }));
  const taken = link.error instanceof ApiError && link.error.code === 'diver_external_id_taken' ? link.error.details.diver : undefined;

  return (
    <Dialog title={pt('linkTitle', { buddy: b.name || pt('noNameYet') })} isOpen onOpenChange={(open) => !open && onClose()}>
      <div className="provider-sites">
        <p>{pt('linkIntro', { buddy: b.name || pt('noNameYet') })}</p>
        <SearchList
          label={t('participants.who')} query={text} onQueryChange={setText} autoFocus items={items} onPick={(id) => link.mutate(id)}
          isPending={link.isPending} pendingStatus={t('common.saving')} listLabel={t('participants.divers')}
          status={found.isPending ? t('common.loading') : null}
          empty={text.trim() ? t('participants.noMatch', { q: text.trim() }) : t('participants.typeName')}
        />
        {taken ? <Notice tone="danger">{pt('accountTaken', { diver: taken.name })}</Notice>
          : link.error && <Notice tone="danger">{errorText(link.error)}</Notice>}
        <div className="form-actions">
          <Button onPress={onClose}>{t('common.cancel')}</Button>
        </div>
      </div>
    </Dialog>
  );
}
