import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, keys, unwrap, type ConnectionView, type ProviderView } from './api.ts';
import { announce } from './lib/announce.ts';
import { useErrorText } from './lib/display.ts';
import { useProviderText } from './lib/providers.ts';
import { Checkbox, Muted, Notice } from './ui/index.ts';

/**
 * Whether dives are numbered at the Provider as Dive Hub numbers them (ADR 0048). Off until the User turns it on; it
 * sends nothing by itself: the number goes with a send, or on its own with "Set number" on the dive page.
 */
export function ProviderDiveNumbers({ provider: p, connection: c }: { provider: ProviderView; connection: ConnectionView }) {
  const pt = useProviderText(p);
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: async (follow: boolean) => unwrap(await api.PATCH('/api/connections/{id}', { params: { path: { id: c.id } }, body: { diveNumbers: { follow } } })),
    onSuccess: async (updated) => {
      queryClient.setQueryData<ConnectionView[]>(keys.connections, (all) => all?.map((x) => (x.id === updated.id ? updated : x)));
      // The dives' status at the Provider shows the number it wants.
      await queryClient.invalidateQueries({ queryKey: keys.dives });
      announce(updated.diveNumbers?.follow ? pt('numbersOn') : pt('numbersOff'));
    },
  });
  if (!c.diveNumbers || c.state !== 'active') return null;
  return (
    <div className="provider-import">
      <Checkbox isSelected={c.diveNumbers.follow} onChange={(on) => save.mutate(on)}>
        {pt('numbersFollow')}
      </Checkbox>
      <Muted>{pt('numbersHint')}</Muted>
      {save.error && <Notice tone="danger">{errorText(save.error)}</Notice>}
    </div>
  );
}
