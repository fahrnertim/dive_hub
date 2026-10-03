import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api, authClient, unwrap } from './api.ts';
import { useErrorText } from './lib/display.ts';
import { usePageTitle } from './lib/page.ts';
import { Button, Form, Muted, Notice, Panel, TextField } from './ui/index.ts';

const MIN_PASSWORD_LENGTH = 15;
const MAX_PASSWORD_LENGTH = 128;

/**
 * After the User changes, nothing cached for the previous one may show. resetQueries drops all
 * cached data and refetches what's on screen (so `me` picks up the new session); clear() would
 * detach the mounted queries and leave the page as it was.
 */
export function useUserChanged() {
  const queryClient = useQueryClient();
  return async () => {
    history.replaceState(null, '', location.pathname); // drop tokens from the address bar
    location.hash = '/';
    await queryClient.resetQueries();
  };
}

export const formValues = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
};

export function NewPasswordField({ label }: { label: string }) {
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
  usePageTitle(t('signIn.title'));
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
    <Panel title={t('signIn.title')} narrow level={1}>
      <p className="muted">{t('signIn.about')}</p>
      <Form className="form" onSubmit={(e) => signIn.mutate(formValues(e))}>
        <TextField label={t('form.email')} name="email" type="email" autoComplete="username" spellCheck="false" isRequired />
        <TextField label={t('form.password')} name="password" type="password" autoComplete="current-password" isRequired />
        {signIn.error && <Notice tone="danger">{signIn.error.message}</Notice>}
        <div className="form-actions"><Button type="submit" variant="primary" isPending={signIn.isPending}>{t('signIn.submit')}</Button></div>
      </Form>
      <Muted>{t('signIn.noAccount')}</Muted>
    </Panel>
  );
}

/** First start: whoever has the setup token from the server log creates the first admin. */
export function Setup() {
  const { t } = useTranslation();
  usePageTitle(t('setup.title'));
  const errorText = useErrorText();
  const signedIn = useUserChanged();
  const setup = useMutation({
    mutationFn: async ({ token, name, email, password }: Record<string, string>) =>
      unwrap(await api.POST('/api/setup', { body: { token: token!.trim(), name: name!, email: email!, password: password! } })),
    onSuccess: signedIn,
  });

  return (
    <Panel title={t('setup.title')} narrow level={1}>
      <p><Trans i18nKey="setup.intro" components={{ code: <code /> }} /></p>
      <Form className="form" onSubmit={(e) => setup.mutate(formValues(e))}>
        <TextField label={t('setup.token')} name="token" isRequired autoComplete="off" autoCorrect="off" spellCheck="false" />
        <TextField label={t('form.name')} name="name" isRequired maxLength={100} autoComplete="name" />
        <TextField label={t('form.email')} name="email" type="email" isRequired autoComplete="username" spellCheck="false" />
        <NewPasswordField label={t('form.password')} />
        {setup.error && <Notice tone="danger">{errorText(setup.error)}</Notice>}
        <div className="form-actions"><Button type="submit" variant="primary" isPending={setup.isPending}>{t('setup.submit')}</Button></div>
      </Form>
    </Panel>
  );
}

export function AcceptInvitation({ token }: { token: string }) {
  const { t } = useTranslation();
  usePageTitle(t('invitation.title'));
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
      <Panel title={t('invitation.title')} narrow level={1}>
        <Notice tone="danger">{errorText(invitation.error)}</Notice>
        <Muted>{t('invitation.askForNewLink')}</Muted>
      </Panel>
    );
  }
  return (
    <Panel title={t('invitation.title')} narrow level={1}>
      <p className="muted">{t('signIn.about')}</p>
      <p><Trans i18nKey="invitation.intro" values={{ email: invitation.data.email }} components={{ strong: <strong /> }} /></p>
      <Form className="form" onSubmit={(e) => accept.mutate(formValues(e))}>
        {/* Lets password managers save the e-mail with the new password. */}
        <input type="email" name="email" value={invitation.data.email} autoComplete="username" readOnly hidden />
        <TextField label={t('form.name')} name="name" isRequired maxLength={100} autoComplete="name" />
        <NewPasswordField label={t('form.password')} />
        {accept.error && <Notice tone="danger">{errorText(accept.error)}</Notice>}
        <div className="form-actions"><Button type="submit" variant="primary" isPending={accept.isPending}>{t('invitation.submit')}</Button></div>
      </Form>
    </Panel>
  );
}

/** Opened from a password reset link an admin passed on (ADR 0013). */
export function ResetPassword({ token }: { token: string }) {
  const { t } = useTranslation();
  usePageTitle(t('reset.title'));
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
      <Panel title={t('reset.title')} narrow level={1}>
        <Notice tone="danger">{errorText(link.error)}</Notice>
        <Muted>{t('invitation.askForNewLink')}</Muted>
      </Panel>
    );
  }
  return (
    <Panel title={t('reset.title')} narrow level={1}>
      <p><Trans i18nKey="reset.intro" values={{ email: link.data.email }} components={{ strong: <strong /> }} /></p>
      <Form className="form" onSubmit={(e) => reset.mutate(formValues(e))}>
        <input type="email" name="email" value={link.data.email} autoComplete="username" readOnly hidden />
        <NewPasswordField label={t('reset.newPassword')} />
        {reset.error && <Notice tone="danger">{errorText(reset.error)}</Notice>}
        <div className="form-actions"><Button type="submit" variant="primary" isPending={reset.isPending}>{t('reset.submit')}</Button></div>
      </Form>
    </Panel>
  );
}

/** Signs out and shows the sign-in page. */
export function useSignOut() {
  const userChanged = useUserChanged();
  return async () => {
    await authClient.signOut();
    await userChanged(); // `me` refetches as nobody, which shows the sign-in page
  };
}
