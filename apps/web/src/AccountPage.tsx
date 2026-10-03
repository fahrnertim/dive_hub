import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formValues, NewPasswordField, useUserChanged } from './Account.tsx';
import { api, authClient, keys, meQuery, sessionsQuery, unwrap, type SessionView } from './api.ts';
import { LANGUAGES } from './i18n/index.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { announce } from './lib/announce.ts';
import { refocusAfterRemoval } from './lib/focus.ts';
import { usePageTitle } from './lib/page.ts';
import { Button, ConfirmButton, Form, Notice, PageHeader, Panel, RadioGroup, Table, TextField } from './ui/index.ts';

/** The signed-in User's own account: display settings, password, and where they're signed in. */
export function AccountPage() {
  const { t } = useTranslation();
  usePageTitle(t('account.title'));
  return (
    <>
      <PageHeader title={t('account.title')} />
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.me, exact: true });
      announce(t('account.saved'));
    },
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
        <div className="form-actions"><Button type="submit" variant="primary" isPending={change.isPending}>{t('account.submitChange')}</Button></div>
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
      .find(([marker]) => userAgent.includes(marker!))?.[1] ?? t('account.browser');
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
  const list = useRef<HTMLDivElement>(null);
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
  const error = (end.variables?.current ? null : end.error) ?? sessions.error; // the dialog shows its own
  const label = (s: SessionView) => t('common.forItem', { action: t('account.signOutSession'), item: `${describe(s.userAgent)}, ${display.dateTime(s.createdAt)}` });

  return (
    <Panel
      title={t('account.sessions')}
      actions={sessions.data && sessions.data.length > 1 && (
        <ConfirmButton
          tone="primary" title={t('account.signOutOthersTitle')} body={t('account.signOutOthersBody')} confirmLabel={t('account.signOutOthers')}
          onConfirm={() => endOthers.mutateAsync()}
        >
          {t('account.signOutOthers')}
        </ConfirmButton>
      )}
    >
      {error && <Notice tone="danger">{errorText(error)}</Notice>}
      {sessions.data && (
        <div ref={list}>
        <Table cards
          label={t('account.sessions')}
          head={[t('account.device'), t('account.ipAddress'), t('account.signedIn'), t('account.lastActive'), { label: t('common.actions'), hidden: true }]}
        >
          {sessions.data.map((s, index) => (
            <tr key={s.id}>
              <td>{describe(s.userAgent)}{s.current && <> (<strong>{t('account.thisDevice')}</strong>)</>}</td>
              <td>{s.ipAddress ?? t('common.none')}</td>
              <td className="date">{display.dateTime(s.createdAt)}</td>
              <td className="date">{s.lastActiveAt ? display.dateTime(s.lastActiveAt) : t('common.none')}</td>
              <td>
                {s.current ? (
                  <ConfirmButton
                    variant="quiet" aria-label={label(s)} tone="primary"
                    title={t('account.signOutThisTitle')} body={t('account.signOutThisBody')} confirmLabel={t('account.signOutSession')}
                    onConfirm={() => end.mutateAsync(s)}
                  >
                    {t('account.signOutSession')}
                  </ConfirmButton>
                ) : (
                  <Button
                    variant="quiet" aria-label={label(s)}
                    isPending={end.isPending && end.variables?.id === s.id} isDisabled={end.isPending}
                    onPress={() => end.mutate(s, {
                      onSuccess: () => refocusAfterRemoval(list.current?.querySelector('tbody') ?? null, index, sessions.data.length),
                    })}
                  >
                    {t('account.signOutSession')}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
        </div>
      )}
    </Panel>
  );
}

