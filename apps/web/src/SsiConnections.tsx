import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formValues } from './Account.tsx';
import { api, diversQuery, keys, ssiConnectionsQuery, unwrap, type SsiConnectionView } from './api.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { Badge, Button, ConfirmButton, Dialog, Form, Muted, Notice, Panel, RadioGroup, Select, Table, TextField } from './ui/index.ts';

/** A choice with its explanation under it, read together by screen readers. */
const choice = (label: string, hint: string): ReactNode => (
  <span className="radio-text"><span>{label}</span><span className="field-description">{hint}</span></span>
);

/**
 * Whether Dive Hub keeps the SSI password (ADR 0024). The User decides on every sign-in; without the
 * server's encryption key there is nothing to choose, and the panel says what that means.
 */
function KeepSignedIn({ canKeep, value, onChange }: { canKeep: boolean; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  if (!canKeep) return <Muted>{t('ssi.tokenOnly')}</Muted>;
  return (
    <RadioGroup
      label={t('ssi.keepQuestion')} value={value} onChange={onChange}
      options={[
        { value: 'keep', label: choice(t('ssi.keep'), t('ssi.keepHint')) },
        { value: 'token', label: choice(t('ssi.dontKeep'), t('ssi.dontKeepHint')) },
      ]}
    />
  );
}

/** The account's SSI Connections: one per Diver, to send their dives to the MySSI logbook. */
export function SsiConnections() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const connections = useQuery(ssiConnectionsQuery());
  const divers = useQuery(diversQuery());
  const [signingIn, setSigningIn] = useState<SsiConnectionView | null>(null);
  const disconnect = useMutation({
    mutationFn: async (c: SsiConnectionView) => unwrap(await api.DELETE('/api/connections/ssi/{id}', { params: { path: { id: c.id } } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.ssiConnections });
      await queryClient.invalidateQueries({ queryKey: keys.dives });
      announce(t('ssi.disconnected'));
    },
  });
  if (!connections.data || !divers.data) {
    return connections.error ? <Panel title={t('ssi.title')}><Notice tone="danger">{errorText(connections.error)}</Notice></Panel> : null;
  }
  const several = divers.data.length > 1;
  const unconnected = divers.data.filter((d) => !connections.data.connections.some((c) => c.diverId === d.id));
  const label = (c: SsiConnectionView) => (several ? `${c.diverName}, ${c.accountEmail}` : c.accountEmail);

  return (
    <Panel title={t('ssi.title')}>
      <Muted>{t('ssi.intro')}</Muted>
      {connections.data.connections.length > 0 && (
        <Table cards label={t('ssi.title')} head={[
          ...(several ? [t('ssi.diver')] : []), t('ssi.account'), t('ssi.state'), t('ssi.lastUsed'), { label: t('common.actions'), hidden: true },
        ]}>
          {connections.data.connections.map((c) => (
            <tr key={c.id}>
              {several && <td>{c.diverName}</td>}
              <td className="email">{c.accountEmail}</td>
              <td>
                {c.state === 'active'
                  ? <Badge tone="success">{c.keepSignedIn ? t('ssi.stateKept') : t('ssi.stateActive')}</Badge>
                  : <Badge tone="danger">{t('ssi.stateNeedsSignIn')}</Badge>}
              </td>
              <td className="date">{c.lastUsedAt ? display.dateTime(c.lastUsedAt) : t('common.none')}</td>
              <td>
                <span className="actions">
                  <Button variant={c.state === 'active' ? 'quiet' : 'primary'} icon="signIn"
                    aria-label={t('common.forItem', { action: t('ssi.signInAgain'), item: label(c) })} onPress={() => setSigningIn(c)}>
                    {t('ssi.signInAgain')}
                  </Button>
                  <ConfirmButton
                    variant="quiet" icon="disconnect" aria-label={t('common.forItem', { action: t('ssi.disconnect'), item: label(c) })}
                    title={t('ssi.disconnectTitle')} body={t('ssi.disconnectBody')} confirmLabel={t('ssi.disconnect')}
                    onConfirm={() => disconnect.mutateAsync(c)}
                  >
                    {t('ssi.disconnect')}
                  </ConfirmButton>
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {unconnected.length > 0 && <ConnectForm divers={unconnected} canKeep={connections.data.canKeepPasswords} several={several} />}
      {signingIn && <SignInDialog connection={signingIn} canKeep={connections.data.canKeepPasswords} onClose={() => setSigningIn(null)} />}
    </Panel>
  );
}

function ConnectForm({ divers, canKeep, several }: { divers: { id: string; name: string }[]; canKeep: boolean; several: boolean }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [diverId, setDiverId] = useState<string | null>(divers[0]?.id ?? null);
  const [keep, setKeep] = useState('token');
  const connect = useMutation({
    mutationFn: async (body: { diverId: string; email: string; password: string; keepSignedIn: boolean }) =>
      unwrap(await api.POST('/api/connections/ssi', { body })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.ssiConnections });
      await queryClient.invalidateQueries({ queryKey: keys.dives });
      announce(t('ssi.connected'));
    },
  });
  const target = divers.find((d) => d.id === diverId) ?? divers[0];
  return (
    <Form
      className="form narrow-form"
      onSubmit={(e) => {
        const values = formValues(e);
        const form = e.currentTarget;
        if (!target) return;
        connect.mutate(
          { diverId: target.id, email: values.email!, password: values.password!, keepSignedIn: canKeep && keep === 'keep' },
          { onSuccess: () => form.reset() },
        );
      }}
    >
      <h3 className="subheading">{several ? t('ssi.connectDiver', { name: target?.name ?? '' }) : t('ssi.connect')}</h3>
      {several && divers.length > 1 && (
        <Select label={t('ssi.diver')} value={diverId} onChange={setDiverId} options={divers.map((d) => ({ id: d.id, label: d.name }))} />
      )}
      <TextField label={t('ssi.email')} name="email" type="email" autoComplete="off" isRequired />
      <TextField label={t('ssi.password')} name="password" type="password" autoComplete="off" isRequired />
      <KeepSignedIn canKeep={canKeep} value={keep} onChange={setKeep} />
      {connect.error && <Notice tone="danger">{errorText(connect.error)}</Notice>}
      <div className="form-actions"><Button type="submit" variant="primary" icon="link" isPending={connect.isPending}>{t('ssi.connectSubmit')}</Button></div>
    </Form>
  );
}

function SignInDialog({ connection: c, canKeep, onClose }: { connection: SsiConnectionView; canKeep: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [keep, setKeep] = useState(c.keepSignedIn ? 'keep' : 'token');
  const signIn = useMutation({
    mutationFn: async (body: { password: string; keepSignedIn: boolean }) =>
      unwrap(await api.POST('/api/connections/ssi/{id}/sign-in', { params: { path: { id: c.id } }, body })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.ssiConnections });
      await queryClient.invalidateQueries({ queryKey: keys.dives });
      announce(t('ssi.signedIn'));
      onClose();
    },
  });
  return (
    <Dialog title={t('ssi.signInTitle')} isOpen onOpenChange={(open) => !open && onClose()}>
      <p>{t('ssi.signInBody', { email: c.accountEmail })}</p>
      <Form className="form" onSubmit={(e) => {
        const values = formValues(e);
        signIn.mutate({ password: values.password!, keepSignedIn: canKeep && keep === 'keep' });
      }}>
        <TextField label={t('ssi.password')} name="password" type="password" autoComplete="off" isRequired autoFocus />
        <KeepSignedIn canKeep={canKeep} value={keep} onChange={setKeep} />
        {signIn.error && <Notice tone="danger">{errorText(signIn.error)}</Notice>}
        <div className="form-actions">
          <Button type="submit" variant="primary" icon="signIn" isPending={signIn.isPending}>{t('ssi.signInSubmit')}</Button>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
        </div>
      </Form>
    </Dialog>
  );
}
