import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formValues, NewPasswordField, useUserChanged } from './Account.tsx';
import { api, authClient, keys, meQuery, sessionsQuery, unwrap, type SessionView } from './api.ts';
import { LANGUAGES } from './i18n/index.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { Button, Form, Notice, Panel, RadioGroup, Table, TextField } from './ui/index.ts';

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

