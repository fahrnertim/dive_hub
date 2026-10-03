import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api, authClient, keys, meQuery, sessionsQuery, unwrap, type SessionView } from './api.ts';
import { LANGUAGES } from './i18n/index.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { Button, Form, Muted, Notice, Panel, RadioGroup, Table, TextField } from './ui/index.ts';

const MIN_PASSWORD_LENGTH = 15;
const MAX_PASSWORD_LENGTH = 128;

/**
 * After the User changes, nothing cached for the previous one may show. resetQueries drops all
 * cached data and refetches what's on screen (so `me` picks up the new session); clear() would
 * detach the mounted queries and leave the page as it was.
 */
function useUserChanged() {
  const queryClient = useQueryClient();
  return async () => {
    history.replaceState(null, '', location.pathname); // drop tokens from the address bar
    location.hash = '/';
    await queryClient.resetQueries();
  };
}

const formValues = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
};

function NewPasswordField({ label }: { label: string }) {
  const { t } = useTranslation();
  return (
    <TextField
      label={label} name="password" type="password" autoComplete="new-password" isRequired
      minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH}
      description={t('form.passwordHint', { count: MIN_PASSWORD_LENGTH })}
    />
  );
}

export function SignIn() {
  const { t } = useTranslation();
  const signedIn = useUserChanged();
  const signIn = useMutation({
    mutationFn: async ({ email, password }: Record<string, string>) => {
      const { error } = await authClient.signIn.email({ email: email!, password: password! });
      if (!error) return;
      if (error.status === 429) throw new Error(t('signIn.tooManyAttempts'));
      if (error.code === 'BANNED_USER') throw new Error(t('signIn.disabled'));
      throw new Error(t('signIn.wrongCredentials'));
    },
    onSuccess: signedIn,
  });

  return (
    <Panel title={t('signIn.title')} narrow>
      <Form className="form" onSubmit={(e) => signIn.mutate(formValues(e))}>
        <TextField label={t('form.email')} name="email" type="email" autoComplete="username" isRequired />
        <TextField label={t('form.password')} name="password" type="password" autoComplete="current-password" isRequired />
        {signIn.error && <Notice tone="danger">{signIn.error.message}</Notice>}
        <div className="form-actions"><Button type="submit" variant="primary" isDisabled={signIn.isPending}>{t('signIn.submit')}</Button></div>
      </Form>
      <Muted>{t('signIn.noAccount')}</Muted>
    </Panel>
  );
}

/** First start: whoever has the setup token from the server log creates the first admin. */
export function Setup() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const signedIn = useUserChanged();
  const setup = useMutation({
    mutationFn: async ({ token, name, email, password }: Record<string, string>) =>
      unwrap(await api.POST('/api/setup', { body: { token: token!.trim(), name: name!, email: email!, password: password! } })),
    onSuccess: signedIn,
  });

  return (
    <Panel title={t('setup.title')} narrow>
      <p><Trans i18nKey="setup.intro" components={{ code: <code /> }} /></p>
      <Form className="form" onSubmit={(e) => setup.mutate(formValues(e))}>
        <TextField label={t('setup.token')} name="token" isRequired autoComplete="off" spellCheck="false" />
        <TextField label={t('form.name')} name="name" isRequired maxLength={100} autoComplete="name" />
        <TextField label={t('form.email')} name="email" type="email" isRequired autoComplete="username" />
        <NewPasswordField label={t('form.password')} />
        {setup.error && <Notice tone="danger">{errorText(setup.error)}</Notice>}
        <div className="form-actions"><Button type="submit" variant="primary" isDisabled={setup.isPending}>{t('setup.submit')}</Button></div>
      </Form>
    </Panel>
  );
}

export function AcceptInvitation({ token }: { token: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const signedIn = useUserChanged();
  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: async () => unwrap(await api.POST('/api/invitations/lookup', { body: { token } })),
    retry: false,
  });
  const accept = useMutation({
    mutationFn: async ({ name, password }: Record<string, string>) =>
      unwrap(await api.POST('/api/invitations/accept', { body: { token, name: name!, password: password! } })),
    onSuccess: signedIn,
  });

  if (invitation.isPending) return <Muted>{t('invitation.checking')}</Muted>;
  if (invitation.error) {
    return (
      <Panel title={t('invitation.title')} narrow>
        <Notice tone="danger">{errorText(invitation.error)}</Notice>
        <Muted>{t('invitation.askForNewLink')}</Muted>
      </Panel>
    );
  }
  return (
    <Panel title={t('invitation.title')} narrow>
      <p><Trans i18nKey="invitation.intro" values={{ email: invitation.data.email }} components={{ strong: <strong /> }} /></p>
      <Form className="form" onSubmit={(e) => accept.mutate(formValues(e))}>
        {/* Lets password managers save the e-mail with the new password. */}
        <input type="email" name="email" value={invitation.data.email} autoComplete="username" readOnly hidden />
        <TextField label={t('form.name')} name="name" isRequired maxLength={100} autoComplete="name" />
        <NewPasswordField label={t('form.password')} />
        {accept.error && <Notice tone="danger">{errorText(accept.error)}</Notice>}
        <div className="form-actions"><Button type="submit" variant="primary" isDisabled={accept.isPending}>{t('invitation.submit')}</Button></div>
      </Form>
    </Panel>
  );
}

/** Opened from a password reset link an admin passed on (ADR 0013). */
export function ResetPassword({ token }: { token: string }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const signedIn = useUserChanged();
  const link = useQuery({
    queryKey: ['password-reset', token],
    queryFn: async () => unwrap(await api.POST('/api/password-resets/lookup', { body: { token } })),
    retry: false,
  });
  const reset = useMutation({
    mutationFn: async ({ password }: Record<string, string>) =>
      unwrap(await api.POST('/api/password-resets/complete', { body: { token, password: password! } })),
    onSuccess: signedIn,
  });

  if (link.isPending) return <Muted>{t('reset.checking')}</Muted>;
  if (link.error) {
    return (
      <Panel title={t('reset.title')} narrow>
        <Notice tone="danger">{errorText(link.error)}</Notice>
        <Muted>{t('invitation.askForNewLink')}</Muted>
      </Panel>
    );
  }
  return (
    <Panel title={t('reset.title')} narrow>
      <p><Trans i18nKey="reset.intro" values={{ email: link.data.email }} components={{ strong: <strong /> }} /></p>
      <Form className="form" onSubmit={(e) => reset.mutate(formValues(e))}>
        <input type="email" name="email" value={link.data.email} autoComplete="username" readOnly hidden />
        <NewPasswordField label={t('reset.newPassword')} />
        {reset.error && <Notice tone="danger">{errorText(reset.error)}</Notice>}
        <div className="form-actions"><Button type="submit" variant="primary" isDisabled={reset.isPending}>{t('reset.submit')}</Button></div>
      </Form>
    </Panel>
  );
}

/** The signed-in User's own account: display settings, password, and where they're signed in. */
export function AccountPage() {
  const { t } = useTranslation();
  return (
    <>
      <h1>{t('account.title')}</h1>
      <DisplaySettings />
      <ChangePassword />
      <Sessions />
    </>
  );
}

const AUTO = 'auto';

function DisplaySettings() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const me = useQuery(meQuery());
  const save = useMutation({
    mutationFn: async (body: { language?: string | null; units?: 'metric' | 'imperial' | null }) =>
      unwrap(await api.PATCH('/api/me/preferences', { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.me, exact: true }),
  });
  const prefs = me.data?.preferences;
  if (!prefs) return null;

  return (
    <Panel title={t('account.display')}>
      <div className="form-inline">
        <RadioGroup
          label={t('account.language')}
          value={prefs.language ?? AUTO}
          onChange={(value) => save.mutate({ language: value === AUTO ? null : value })}
          options={[
            { value: AUTO, label: t('account.languageAuto') },
            ...Object.entries(LANGUAGES).map(([value, name]) => ({ value, label: <span lang={value}>{name}</span> })),
          ]}
        />
        <RadioGroup
          label={t('account.units')}
          value={prefs.units ?? AUTO}
          onChange={(value) => save.mutate({ units: value === AUTO ? null : (value as 'metric' | 'imperial') })}
          options={[
            { value: AUTO, label: t('account.unitsAuto') },
            { value: 'metric', label: t('account.metric') },
            { value: 'imperial', label: t('account.imperial') },
          ]}
        />
      </div>
      {save.error && <Notice tone="danger">{errorText(save.error)}</Notice>}
    </Panel>
  );
}

function ChangePassword() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [done, setDone] = useState(false);
  const change = useMutation({
    mutationFn: async ({ currentPassword, password }: Record<string, string>) => {
      const { error } = await authClient.changePassword({
        currentPassword: currentPassword!, newPassword: password!, revokeOtherSessions: true,
      });
      if (error) throw new Error(error.code === 'INVALID_PASSWORD' ? t('account.wrongCurrent') : t('errors.unknown'));
    },
    onSuccess: () => {
      setDone(true);
      void queryClient.invalidateQueries({ queryKey: keys.sessions });
    },
  });

  return (
    <Panel title={t('account.changePassword')}>
      <Form
        className="form narrow-form"
        onSubmit={(e) => {
          const values = formValues(e);
          const form = e.currentTarget;
          setDone(false);
          change.mutate(values, { onSuccess: () => form.reset() });
        }}
      >
        <TextField label={t('account.currentPassword')} name="currentPassword" type="password" autoComplete="current-password" isRequired />
        <NewPasswordField label={t('account.newPassword')} />
        {change.error && <Notice tone="danger">{change.error.message}</Notice>}
        {done && <Notice tone="success">{t('account.changed')}</Notice>}
        <div className="form-actions"><Button type="submit" variant="primary" isDisabled={change.isPending}>{t('account.submitChange')}</Button></div>
      </Form>
    </Panel>
  );
}

/** "Firefox on Windows" from a user agent string; good enough to recognise one's own devices. */
function useDescribeAgent() {
  const { t } = useTranslation();
  return (userAgent: string | null): string => {
    if (!userAgent) return t('account.unknownDevice');
    const browser = [['Edg/', 'Edge'], ['Firefox/', 'Firefox'], ['Chrome/', 'Chrome'], ['Safari/', 'Safari']]
      .find(([marker]) => userAgent.includes(marker!))?.[1] ?? 'Browser';
    const os = [['Windows', 'Windows'], ['Android', 'Android'], ['iPhone', 'iOS'], ['iPad', 'iPadOS'], ['Mac OS X', 'macOS'], ['Linux', 'Linux']]
      .find(([marker]) => userAgent.includes(marker!))?.[1];
    return os ? t('account.agent', { browser, os }) : browser;
  };
}

function Sessions() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const describe = useDescribeAgent();
  const queryClient = useQueryClient();
  const userChanged = useUserChanged();
  const sessions = useQuery(sessionsQuery());
  const end = useMutation({
    mutationFn: async (s: SessionView) => {
      unwrap(await api.DELETE('/api/me/sessions/{id}', { params: { path: { id: s.id } } }));
      return s;
    },
    onSuccess: async (s) => (s.current ? userChanged() : queryClient.invalidateQueries({ queryKey: keys.sessions })),
  });
  const endOthers = useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/api/me/sessions')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.sessions }),
  });
  const error = end.error ?? endOthers.error ?? sessions.error;

  return (
    <Panel
      title={t('account.sessions')}
      actions={sessions.data && sessions.data.length > 1 && (
        <Button isDisabled={endOthers.isPending} onPress={() => endOthers.mutate()}>{t('account.signOutOthers')}</Button>
      )}
    >
      {error && <Notice tone="danger">{errorText(error)}</Notice>}
      {sessions.data && (
        <Table
          label={t('account.sessions')}
          head={[t('account.device'), t('account.ipAddress'), t('account.signedIn'), t('account.lastActive'), '']}
        >
          {sessions.data.map((s) => (
            <tr key={s.id}>
              <td>{describe(s.userAgent)}{s.current && <> (<strong>{t('account.thisDevice')}</strong>)</>}</td>
              <td>{s.ipAddress ?? t('common.none')}</td>
              <td>{display.dateTime(s.createdAt)}</td>
              <td>{s.lastActiveAt ? display.dateTime(s.lastActiveAt) : t('common.none')}</td>
              <td><Button variant="quiet" isDisabled={end.isPending} onPress={() => end.mutate(s)}>{t('account.signOutSession')}</Button></td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}

export function SignOutButton() {
  const { t } = useTranslation();
  const userChanged = useUserChanged();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="quiet"
      isDisabled={busy}
      onPress={async () => {
        setBusy(true);
        await authClient.signOut();
        await userChanged(); // `me` refetches as nobody, which shows the sign-in page
      }}
    >
      {t('common.signOut')}
    </Button>
  );
}
