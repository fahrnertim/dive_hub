import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formValues } from './Account.tsx';
import { api, connectionsQuery, diversQuery, keys, unwrap, type ConnectionView, type ProviderView } from './api.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { connectable, useProviders, useProviderText } from './lib/providers.ts';
import { Badge, Button, ConfirmButton, Dialog, Form, Muted, Notice, Panel, RadioGroup, Select, Table, TextField } from './ui/index.ts';

/** A choice with its explanation under it, read together by screen readers. */
const choice = (label: string, hint: string): ReactNode => (
  <span className="radio-text"><span>{label}</span><span className="field-description">{hint}</span></span>
);

/**
 * Whether Dive Hub keeps the password (ADR 0024). The User decides on every sign-in; without the server's encryption
 * key there is nothing to choose, and the panel says what that means. Only for password sign-in.
 */
function KeepSignedIn({ provider: p, value, onChange }: { provider: ProviderView; value: string; onChange: (v: string) => void }) {
  const pt = useProviderText(p);
  if (p.signIn.kind !== 'password') return null;
  if (!p.signIn.canKeepPassword) return <Muted>{pt('tokenOnly')}</Muted>;
  return (
    <RadioGroup
      label={pt('keepQuestion')} value={value} onChange={onChange}
      options={[
        { value: 'keep', label: choice(pt('keep'), pt('keepHint')) },
        { value: 'token', label: choice(pt('dontKeep'), pt('dontKeepHint')) },
      ]}
    />
  );
}

/** The fields the Provider's sign-in asks for. Its secrets are the Provider's: never saved as Dive Hub's (autocomplete off). */
function SignInFields({ provider: p, withLogin, autoFocus }: { provider: ProviderView; withLogin: boolean; autoFocus?: boolean }) {
  const pt = useProviderText(p);
  if (p.signIn.kind === 'token') {
    return <TextField label={pt('token')} description={pt('tokenHint')} name="token" type="password" autoComplete="off" isRequired {...(autoFocus && { autoFocus })} />;
  }
  return (
    <>
      {withLogin && (p.signIn.login === 'username'
        ? <TextField label={pt('username')} name="login" autoComplete="off" isRequired />
        : <TextField label={pt('email')} name="login" type="email" autoComplete="off" isRequired />)}
      <TextField label={pt('password')} name="password" type="password" autoComplete="off" isRequired {...(autoFocus && { autoFocus })} />
    </>
  );
}

/** What the sign-in fields hold, for the API. */
const signInBody = (p: ProviderView, values: Record<string, string | undefined>, keep: string) => (p.signIn.kind === 'token'
  ? { token: values.token!, keepSignedIn: false }
  : { password: values.password!, keepSignedIn: p.signIn.canKeepPassword && keep === 'keep' });

/** The account's Connections (ADR 0024, 0027): a panel per Provider the User can connect to, one Connection per Diver. */
export function Connections() {
  const providers = useProviders();
  return <>{connectable(providers.data).map((p) => <ProviderConnections key={p.id} provider={p} />)}</>;
}

function ProviderConnections({ provider: p }: { provider: ProviderView }) {
  const { t } = useTranslation();
  const pt = useProviderText(p);
  const errorText = useErrorText();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const connections = useQuery(connectionsQuery());
  const divers = useQuery(diversQuery());
  const [signingIn, setSigningIn] = useState<ConnectionView | null>(null);
  const disconnect = useMutation({
    mutationFn: async (c: ConnectionView) => unwrap(await api.DELETE('/api/connections/{id}', { params: { path: { id: c.id } } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.connections });
      await queryClient.invalidateQueries({ queryKey: keys.dives });
      announce(pt('disconnected'));
    },
  });
  if (!connections.data || !divers.data) {
    return connections.error ? <Panel title={p.name}><Notice tone="danger">{errorText(connections.error)}</Notice></Panel> : null;
  }
  const own = connections.data.filter((c) => c.provider === p.id);
  const several = divers.data.length > 1;
  const unconnected = divers.data.filter((d) => !own.some((c) => c.diverId === d.id));
  const label = (c: ConnectionView) => (several ? `${c.diverName}, ${c.accountLabel}` : c.accountLabel);

  return (
    <Panel title={p.name}>
      <Muted>{pt('intro')}</Muted>
      {own.length > 0 && (
        <Table cards label={p.name} head={[
          ...(several ? [pt('diver')] : []), pt('account'), pt('state'), pt('lastUsed'), { label: t('common.actions'), hidden: true },
        ]}>
          {own.map((c) => (
            <tr key={c.id}>
              {several && <td>{c.diverName}</td>}
              <td className="email">{c.accountLabel}</td>
              <td>
                {c.state === 'active'
                  ? <Badge tone="success">{c.keepSignedIn ? pt('stateKept') : pt('stateActive')}</Badge>
                  : <Badge tone="danger">{pt('stateNeedsSignIn')}</Badge>}
              </td>
              <td className="date">{c.lastUsedAt ? display.dateTime(c.lastUsedAt) : t('common.none')}</td>
              <td>
                <span className="actions">
                  <Button variant={c.state === 'active' ? 'quiet' : 'primary'} icon="signIn"
                    aria-label={t('common.forItem', { action: pt('signInAgain'), item: label(c) })} onPress={() => setSigningIn(c)}>
                    {pt('signInAgain')}
                  </Button>
                  <ConfirmButton
                    variant="quiet" icon="disconnect" aria-label={t('common.forItem', { action: pt('disconnect'), item: label(c) })}
                    title={pt('disconnectTitle')} body={pt('disconnectBody')} confirmLabel={pt('disconnect')}
                    onConfirm={() => disconnect.mutateAsync(c)}
                  >
                    {pt('disconnect')}
                  </ConfirmButton>
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {unconnected.length > 0 && <ConnectForm provider={p} divers={unconnected} several={several} />}
      {signingIn && <SignInDialog provider={p} connection={signingIn} onClose={() => setSigningIn(null)} />}
    </Panel>
  );
}

function ConnectForm({ provider: p, divers, several }: { provider: ProviderView; divers: { id: string; name: string }[]; several: boolean }) {
  const pt = useProviderText(p);
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [diverId, setDiverId] = useState<string | null>(divers[0]?.id ?? null);
  const [keep, setKeep] = useState('token');
  const connect = useMutation({
    mutationFn: async (body: { diverId: string; login?: string; password?: string; token?: string; keepSignedIn: boolean }) =>
      unwrap(await api.POST('/api/connections/{provider}', { params: { path: { provider: p.id } }, body })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.connections });
      await queryClient.invalidateQueries({ queryKey: keys.dives });
      announce(pt('connected'));
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
          { diverId: target.id, ...(p.signIn.kind === 'password' && { login: values.login! }), ...signInBody(p, values, keep) },
          { onSuccess: () => form.reset() },
        );
      }}
    >
      <h3 className="subheading">{several ? pt('connectDiver', { diver: target?.name ?? '' }) : pt('connect')}</h3>
      {several && divers.length > 1 && (
        <Select label={pt('diver')} value={diverId} onChange={setDiverId} options={divers.map((d) => ({ id: d.id, label: d.name }))} />
      )}
      <SignInFields provider={p} withLogin />
      <KeepSignedIn provider={p} value={keep} onChange={setKeep} />
      {connect.error && <Notice tone="danger">{errorText(connect.error)}</Notice>}
      <div className="form-actions"><Button type="submit" variant="primary" icon="link" isPending={connect.isPending}>{pt('connectSubmit')}</Button></div>
    </Form>
  );
}

function SignInDialog({ provider: p, connection: c, onClose }: { provider: ProviderView; connection: ConnectionView; onClose: () => void }) {
  const { t } = useTranslation();
  const pt = useProviderText(p);
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [keep, setKeep] = useState(c.keepSignedIn ? 'keep' : 'token');
  const signIn = useMutation({
    mutationFn: async (body: { password?: string; token?: string; keepSignedIn: boolean }) =>
      unwrap(await api.POST('/api/connections/{id}/sign-in', { params: { path: { id: c.id } }, body })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.connections });
      await queryClient.invalidateQueries({ queryKey: keys.dives });
      announce(pt('signedIn'));
      onClose();
    },
  });
  return (
    <Dialog title={pt('signInTitle')} isOpen onOpenChange={(open) => !open && onClose()}>
      <p>{pt(p.signIn.kind === 'token' ? 'signInBodyToken' : 'signInBody', { account: c.accountLabel })}</p>
      <Form className="form" onSubmit={(e) => signIn.mutate(signInBody(p, formValues(e), keep))}>
        <SignInFields provider={p} withLogin={false} autoFocus />
        <KeepSignedIn provider={p} value={keep} onChange={setKeep} />
        {signIn.error && <Notice tone="danger">{errorText(signIn.error)}</Notice>}
        <div className="form-actions">
          <Button type="submit" variant="primary" icon="signIn" isPending={signIn.isPending}>{pt('signInSubmit')}</Button>
          <Button onPress={onClose}>{t('common.cancel')}</Button>
        </div>
      </Form>
    </Dialog>
  );
}
