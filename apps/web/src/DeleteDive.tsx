import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError, diveProvidersQuery, keys, unwrap, type DiveView, type ProviderView } from './api.ts';
import { deleteChoice, updateDeletion, type CopyAt } from './lib/deletion.ts';
import { useErrorText } from './lib/display.ts';
import { useNames, useProviders, useProviderText } from './lib/providers.ts';
import { Button, Dialog, Muted, Notice } from './ui/index.ts';

/** What the dialog says about one copy: delete it there too, or it stays there (in the Provider's words where it has them). */
function CopySentence({ provider: p, copy, canDelete }: { provider: ProviderView; copy: CopyAt; canDelete: boolean }) {
  const pt = useProviderText(p);
  return <p>{pt(canDelete ? 'deleteAsk' : 'deleteCannot', { number: copy.remoteNumber ?? '' })}</p>;
}

/**
 * Deletes the Dive after saying what happens (ADR 0026): it leaves the logbook and can be restored. When it is at
 * Providers (ADR 0027), the same dialog asks whether to delete it there too. Afterwards the logbook shows it with
 * "Undo"; if deleting at a Provider fails, nothing is deleted and the dialog says why.
 */
export function DeleteDiveDialog({ dive: d, name, onClose }: { dive: DiveView; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const names = useNames();
  const queryClient = useQueryClient();
  const providers = useProviders();
  const statuses = useQuery(diveProvidersQuery(d.id));
  // Without the state at the Providers the server still knows: a copy then stays there, with the reminder.
  const choice = deleteChoice(statuses.data) ?? (statuses.error ? { ask: [], cannot: [] } : undefined);
  const providerOf = (id: string) => providers.data?.find((p) => p.id === id) ?? { id, name: id } as ProviderView;
  const remove = useMutation({
    mutationFn: async (alsoThere: boolean) => unwrap(await api.DELETE('/api/dives/{id}', {
      params: { path: { id: d.id } }, body: { version: d.version, alsoAt: alsoThere ? choice!.ask.map((c) => c.provider) : [] },
    })),
    onSuccess: async (result) => {
      const numberAt = (id: string) => [...(choice?.ask ?? []), ...(choice?.cannot ?? [])].find((c) => c.provider === id)?.remoteNumber ?? null;
      updateDeletion({
        justDeleted: {
          id: d.id, name,
          copies: result.providers.map((r) => ({ provider: r.provider, name: providerOf(r.provider).name, copy: r.copy, remoteNumber: numberAt(r.provider) })),
        },
      });
      location.hash = '#/';
      // Every list and count changes; the deleted Dive itself would only answer "not found" now.
      await queryClient.invalidateQueries({ predicate: (q) => !(q.queryKey[0] === 'dives' && q.queryKey[1] === d.id) });
      queryClient.removeQueries({ queryKey: keys.dive(d.id) });
    },
  });
  const asking = (choice?.ask.length ?? 0) > 0;
  const only = choice && choice.cannot.length > 0 ? t('dive.deleteHereOnly') : t('dive.deleteConfirm');

  return (
    <Dialog title={t('dive.deleteTitle', { name })} isOpen onOpenChange={(open) => !open && !remove.isPending && onClose()}>
      <p>{t('dive.deleteBody')}</p>
      {choice?.ask.map((c) => <CopySentence key={c.provider} provider={providerOf(c.provider)} copy={c} canDelete />)}
      {choice?.cannot.map((c) => <CopySentence key={c.provider} provider={providerOf(c.provider)} copy={c} canDelete={false} />)}
      {!choice && <Muted>{t('common.loading')}</Muted>}
      {remove.error && (
        <Notice tone="danger">
          {errorText(remove.error)}{remove.error instanceof ApiError && ` ${t('dive.deleteNothingDeleted')}`}
        </Notice>
      )}
      {/* The button pressed is pending, the others wait (page rules); `variables` says which: there too or not. */}
      <div className="form-actions">
        {asking && (
          <Button variant="danger" icon="delete" isPending={remove.isPending && remove.variables} isDisabled={remove.isPending && !remove.variables} onPress={() => remove.mutate(true)}>
            {t('dive.deleteBoth', { name: names(choice!.ask.map((c) => providerOf(c.provider).name)) })}
          </Button>
        )}
        {choice && (
          <Button variant={asking ? 'secondary' : 'danger'} icon="delete" isPending={remove.isPending && !remove.variables} isDisabled={remove.isPending && remove.variables} onPress={() => remove.mutate(false)}>
            {asking ? t('dive.deleteHereOnly') : only}
          </Button>
        )}
        {/* Closing while it deletes would hide the outcome; the button pressed shows it's busy. */}
        <Button isDisabled={remove.isPending} onPress={onClose}>{t('common.cancel')}</Button>
      </div>
    </Dialog>
  );
}
