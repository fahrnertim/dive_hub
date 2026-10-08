import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, bodyWeightsQuery, keys, unwrap } from './api.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { massFromDisplay, massIn } from './lib/units.ts';
import { Button, Dialog, Form, Muted, Notice, NumberField, TextField } from './ui/index.ts';

const today = () => new Date().toLocaleDateString('sv-SE');

/**
 * A Diver's body weight (ADR 0031): dated values, in kg or lb as the User counts, seen and set only by the Users who keep
 * the Diver. The server holds kilograms. Setting a date that has a weight replaces it.
 */
export function BodyWeightDialog({ diverId, name, onClose }: { diverId: string; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const weights = useQuery(bodyWeightsQuery(diverId));
  const [date, setDate] = useState(today);
  const [typed, setTyped] = useState(Number.NaN);
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.bodyWeights(diverId) });
  const set = useMutation({
    mutationFn: async (v: { date: string; kg: number }) => unwrap(await api.PUT('/api/divers/{id}/body-weights/{date}', {
      params: { path: { id: diverId, date: v.date } }, body: { kg: v.kg },
    })),
    onSuccess: async () => { await refresh(); setTyped(Number.NaN); },
  });
  const remove = useMutation({
    mutationFn: async (d: string) => unwrap(await api.DELETE('/api/divers/{id}/body-weights/{date}', { params: { path: { id: diverId, date: d } } })),
    onSuccess: refresh,
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (Number.isNaN(typed) || !date) return;
    set.mutate({ date, kg: Math.round(massFromDisplay(typed, display.units) * 100) / 100 });
  };

  return (
    <Dialog title={t('bodyWeight.title', { name })} isOpen onOpenChange={(open) => !open && onClose()}>
      <div className="body-weight">
        <Muted>{t('bodyWeight.privacy')} {t('bodyWeight.intro')}</Muted>
        {weights.isPending && <Muted>{t('common.loading')}</Muted>}
        {weights.error && <Notice tone="danger">{errorText(weights.error)}</Notice>}
        {weights.data?.length === 0 && <Muted>{t('bodyWeight.none')}</Muted>}
        {weights.data && weights.data.length > 0 && (
          <ul className="body-weight-list">
            {weights.data.map((w) => (
              <li key={w.date}>
                <span className="date">{display.date(w.date)}</span>
                <strong>{display.mass(w.kg)}</strong>
                <Button
                  variant="quiet" size="small" icon="delete" isPending={remove.isPending && remove.variables === w.date}
                  aria-label={t('common.forItem', { action: t('bodyWeight.remove'), item: display.date(w.date) })} onPress={() => remove.mutate(w.date)}
                >
                  {t('bodyWeight.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {remove.error && <Notice tone="danger">{errorText(remove.error)}</Notice>}
        <Form className="form-inline" onSubmit={submit}>
          <TextField label={t('bodyWeight.date')} name="date" type="date" isRequired value={date} onChange={setDate} />
          <NumberField
            label={t('bodyWeight.weight')} unit={display.unit('mass')} value={typed} onChange={setTyped} isRequired
            minValue={Math.ceil(massIn(20, display.units))} maxValue={Math.floor(massIn(400, display.units))} formatOptions={{ maximumFractionDigits: 1 }}
            description={t('bodyWeight.addHelp')}
          />
          <Button type="submit" icon="add" isPending={set.isPending}>{t('bodyWeight.add')}</Button>
        </Form>
        {set.error && <Notice tone="danger">{errorText(set.error)}</Notice>}
      </div>
    </Dialog>
  );
}
