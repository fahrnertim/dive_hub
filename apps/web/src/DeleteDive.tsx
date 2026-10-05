import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, ApiError, keys, ssiStatusQuery, unwrap, type DiveView } from './api.ts';
import { ssiChoice, updateDeletion } from './lib/deletion.ts';
import { useErrorText } from './lib/display.ts';
import { Button, Dialog, Muted, Notice } from './ui/index.ts';

/**
 * Deletes the Dive after saying what happens (ADR 0026): it leaves the logbook and can be restored. When it is in SSI,
 * the same dialog asks whether to delete it there too (SSI's app can't bring it back). Afterwards the logbook shows it
 * with "Undo"; if deleting in SSI fails, nothing is deleted and the dialog says why.
 */
export function DeleteDiveDialog({ dive: d, name, onClose }: { dive: DiveView; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const status = useQuery(ssiStatusQuery(d.id));
  // Without the SSI state the server still knows: a Dive in SSI then stays there, with the reminder.
  const choice = ssiChoice(status.data) ?? (status.error ? { kind: 'none' as const } : undefined);
  const remove = useMutation({
    mutationFn: async (inSsi: boolean) =>
      unwrap(await api.DELETE('/api/dives/{id}', { params: { path: { id: d.id } }, body: { version: d.version, inSsi } })),
    onSuccess: async (result) => {
      updateDeletion({
        justDeleted: { id: d.id, name, ssi: result.ssi, remoteNumber: choice && choice.kind !== 'none' ? choice.remoteNumber : null },
      });
      location.hash = '#/';
      // Every list and count changes; the deleted Dive itself would only answer "not found" now.
      await queryClient.invalidateQueries({ predicate: (q) => !(q.queryKey[0] === 'dives' && q.queryKey[1] === d.id) });
      queryClient.removeQueries({ queryKey: keys.dive(d.id) });
    },
  });
  const only = choice?.kind === 'cannot' ? t('dive.deleteHereOnly') : t('dive.deleteConfirm');

  return (
    <Dialog title={t('dive.deleteTitle', { name })} isOpen onOpenChange={(open) => !open && !remove.isPending && onClose()}>
      <p>{t('dive.deleteBody')}</p>
      {choice?.kind === 'ask' && <p>{t('dive.deleteAskSsi', { number: choice.remoteNumber ?? '' })}</p>}
      {choice?.kind === 'cannot' && <p>{t('dive.deleteCannotSsi', { number: choice.remoteNumber ?? '' })}</p>}
      {!choice && <Muted>{t('common.loading')}</Muted>}
      {remove.error && (
        <Notice tone="danger">
          {errorText(remove.error)}{remove.error instanceof ApiError && ` ${t('dive.deleteNothingDeleted')}`}
        </Notice>
      )}
      {/* The button pressed is pending, the others wait (page rules); `variables` says which: in SSI too or not. */}
      <div className="form-actions">
        {choice?.kind === 'ask' && (
          <Button variant="danger" icon="delete" isPending={remove.isPending && remove.variables} isDisabled={remove.isPending && !remove.variables} onPress={() => remove.mutate(true)}>
            {t('dive.deleteBoth')}
          </Button>
        )}
        {choice && (
          <Button variant={choice.kind === 'ask' ? 'secondary' : 'danger'} icon="delete" isPending={remove.isPending && !remove.variables} isDisabled={remove.isPending && remove.variables} onPress={() => remove.mutate(false)}>
            {choice.kind === 'ask' ? t('dive.deleteHereOnly') : only}
          </Button>
        )}
        {/* Closing while it deletes would hide the outcome; the button pressed shows it's busy. */}
        <Button isDisabled={remove.isPending} onPress={onClose}>{t('common.cancel')}</Button>
      </div>
    </Dialog>
  );
}
