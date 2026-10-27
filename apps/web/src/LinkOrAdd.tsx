import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, buddiesForQuery, keys, unwrap, type ProviderView } from './api.ts';
import { CodeScanner } from './CodeScanner.tsx';
import { announce } from './lib/announce.ts';
import { useErrorText } from './lib/display.ts';
import { useProviderText } from './lib/providers.ts';
import { Button, Dialog, Form, Muted, Notice, SearchList, TextField, type SearchListItem } from './ui/index.ts';

/** Results shown at most, without scrolling (ux-search). */
const SHOWN = 10;

/** What a send or an add did to the account's list of people at the Provider (the send's `buddies`). */
export type ListChange = {
  added: { diverId: string; name: string }[];
  knownAs: { diverId: string; diverName: string; name: string }[];
};

/**
 * The Link or add dialog for a Participant the User's list at the Provider doesn't hold (ADR 0057): pick an entry of the
 * list (with or without an account), or add the person: typed, or from their buddy code. Names and e-mail reach the
 * Provider only from here, on the User's action (ADR 0029).
 */
export function LinkOrAddDialog({ provider: p, diver, connectionId, diveId, onClose, onChanged }: {
  provider: ProviderView; diver: { id: string; name: string }; connectionId: string; diveId: string;
  onClose: () => void; onChanged: (change: ListChange) => void;
}) {
  const { t } = useTranslation();
  const pt = useProviderText(p);
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const buddies = useQuery(buddiesForQuery(connectionId, diver.id));
  const [text, setText] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  // The Provider account a scanned buddy code holds; the names typed beside it stay the User's to change.
  const [account, setAccount] = useState<string | null>(null);

  // The dialog closes at once; the Dive's line and the lists catch up behind it (the list read asks the Provider again).
  const changed = () => {
    void queryClient.invalidateQueries({ queryKey: keys.diveProviders(diveId) });
    void queryClient.invalidateQueries({ queryKey: keys.buddies(connectionId) });
    void queryClient.invalidateQueries({ queryKey: keys.divers });
  };
  const link = useMutation({
    mutationFn: async (entryId: string) => unwrap(await api.POST('/api/connections/{id}/buddies/link', {
      params: { path: { id: connectionId } }, body: { entryId, diverId: diver.id },
    })),
    onSuccess: () => { changed(); announce(pt('buddyLinked', { diver: diver.name })); onClose(); },
    // An entry gone from the list: read it again.
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'provider_buddy_not_found') void queryClient.invalidateQueries({ queryKey: keys.buddies(connectionId) });
    },
  });
  const add = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/connections/{id}/buddies/add', {
      params: { path: { id: connectionId } },
      body: { diverId: diver.id, firstName: first.trim(), lastName: last.trim(), ...(email.trim() && { email: email.trim() }), ...(account && { account }) },
    })),
    onSuccess: (answer) => {
      changed();
      onChanged({
        added: [answer.added],
        knownAs: answer.knownAs ? [{ diverId: diver.id, diverName: diver.name, name: answer.knownAs }] : [],
      });
      onClose();
    },
  });
  const read = useMutation({
    mutationFn: async (scanned: string) => unwrap(await api.POST('/api/verification-codes/read', { body: { text: scanned } })),
    onSuccess: (found) => {
      if (found.kind === 'centre') return;
      setFirst(found.firstName);
      setLast(found.lastName);
      setEmail(found.email);
      setAccount(found.accountId);
    },
  });

  const fold = (v: string) => v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const query = text.trim();
  // Every entry not yet a Diver's: with an account or without (a matching entry only comes first, the server's sort).
  const free = (buddies.data ?? []).filter((b) => !b.diver);
  const matching = query ? free.filter((b) => fold(b.name).includes(fold(query))) : free;
  const items: SearchListItem[] = matching.slice(0, SHOWN).map((b) => ({
    id: b.entryId,
    name: b.name || pt('noNameYet'),
    // An entry without a name is told apart by its account; one without an account says so.
    detail: !b.account ? pt('noAccountYet') : b.name ? undefined : pt('entryAccount', { account: b.account }),
  }));
  const status = buddies.isPending ? t('common.loading') : matching.length > SHOWN ? t('sites.showingFirst', { shown: SHOWN }) : null;
  const empty = buddies.isPending ? t('common.loading') : (buddies.data ?? []).length === 0 ? pt('noBuddies') : query ? pt('noBuddyMatch', { q: query }) : pt('allHere');
  const taken = link.error instanceof ApiError && link.error.code === 'diver_external_id_taken' ? link.error.details.diver : undefined;

  return (
    <Dialog title={pt('findTitle', { diver: diver.name })} isOpen onOpenChange={(open) => !open && onClose()}>
      <div className="link-or-add">
        <section className="provider-sites" aria-label={pt('buddyList')}>
          <p>{pt('findIntro', { diver: diver.name })}</p>
          {buddies.error && <Notice tone="danger">{errorText(buddies.error)}</Notice>}
          <SearchList
            label={pt('findInListLabel')} query={text} onQueryChange={setText} autoFocus
            items={items} onPick={(entryId) => link.mutate(entryId)} isPending={link.isPending} pendingStatus={t('common.saving')}
            listLabel={pt('buddyList')} status={status} empty={empty}
          />
          {taken ? <Notice tone="danger">{pt('accountTaken', { diver: taken.name })}</Notice>
            : link.error && <Notice tone="danger">{errorText(link.error)}</Notice>}
        </section>

        <section className="provider-sites">
          <h3>{pt('addThem')}</h3>
          <CodeScanner onText={(scanned) => read.mutate(scanned)}>
            <span className="field-label">{pt('scanCode')}</span>
          </CodeScanner>
          {read.error && <Notice tone="danger">{errorText(read.error)}</Notice>}
          {read.data?.kind === 'centre' && <Notice tone="danger">{t('diverCodes.centreCode')}</Notice>}
          {account && <Muted>{pt('fromCode', { account })}</Muted>}
          <Form className="form" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
            <TextField label={pt('firstName')} name="firstName" isRequired autoComplete="off" value={first} onChange={setFirst} />
            <TextField label={pt('lastName')} name="lastName" isRequired autoComplete="off" value={last} onChange={setLast} />
            <TextField label={pt('buddyEmail')} name="email" type="email" autoComplete="off" value={email} onChange={setEmail} />
            {add.error && <Notice tone="danger">{errorText(add.error)}</Notice>}
            <div className="form-actions">
              <Button type="submit" variant="primary" icon="add" isPending={add.isPending}>{pt('addToList')}</Button>
              <Button onPress={onClose}>{t('common.cancel')}</Button>
            </div>
          </Form>
        </section>
      </div>
    </Dialog>
  );
}

/** What a send or an add did to the list of people at the Provider: who was added, and whom the Provider knows an account as. */
export function ListChangeNotice({ provider: p, change, onClose }: { provider: ProviderView; change: ListChange; onClose: () => void }) {
  const { t } = useTranslation();
  const pt = useProviderText(p);
  if (change.added.length === 0 && change.knownAs.length === 0) return null;
  return (
    <Notice tone="info">
      {change.added.map((a) => <p key={`a-${a.diverId}`}>{pt('buddyAdded', { person: a.name })}</p>)}
      {change.knownAs.map((k) => (
        <p key={`k-${k.diverId}`}>{pt('knownAs', { known: k.name })} <a href="#/divers">{pt('openDiver', { diver: k.diverName })}</a></p>
      ))}
      <Button variant="quiet" onPress={onClose}>{t('common.close')}</Button>
    </Notice>
  );
}
