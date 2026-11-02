import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api, invitationsQuery, keys, meQuery, siteDataQuery, unwrap, usersQuery, type SiteDataView, type UserView } from './api.ts';
import { AiAccessSetting } from './AiAccess.tsx';
import { announce } from './lib/announce.ts';
import { useProviders, useProviderText } from './lib/providers.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { focusHeading } from './lib/focus.ts';
import { SITE_IMPORTS_HREF } from './lib/settings.ts';
import { ActionMenu, Badge, Button, Checkbox, ConfirmButton, ConfirmDialog, CopyField, Dialog, Form, Icon, Notice, Panel, Table, TextField } from './ui/index.ts';

/**
 * Settings' Administration section: admins invite people (copy the link, there's no mail yet) and manage Users (ADR 0012,
 * 0013). The section's name is the h1.
 */
export function AdminSettings() {
  const { t } = useTranslation();
  return (
    <>
      <Invite />
      <Invitations />
      <Users />
      <Panel title={t('siteImport.title')}>
        <p>{t('siteImport.adminLead')}</p>
        <a href={SITE_IMPORTS_HREF} className="btn btn-secondary"><Icon name="siteImport" />{t('siteImport.open')}</a>
      </Panel>
      <ProviderSiteData />
      <AiAccessSetting />
    </>
  );
}

/**
 * Whether Users' imports may make Dive sites from a Provider's site data (ADR 0030): one panel per Provider whose dives
 * are imported. Without a licence, it is the operator's decision, confirmed once, like an SSI site import.
 */
function ProviderSiteData() {
  const data = useQuery(siteDataQuery());
  const providers = useProviders();
  return (
    <>
      {(data.data ?? []).map((s) => {
        const p = providers.data?.find((x) => x.id === s.provider);
        return p ? <SiteDataPanel key={s.provider} provider={{ id: p.id, name: p.name }} state={s} /> : null;
      })}
    </>
  );
}

function SiteDataPanel({ provider: p, state: s }: { provider: { id: string; name: string }; state: SiteDataView }) {
  const pt = useProviderText(p);
  const display = useDisplay();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const set = useMutation({
    mutationFn: async (allowed: boolean) => unwrap(await api.PUT('/api/admin/provider-site-data/{provider}', {
      params: { path: { provider: p.id } }, body: allowed ? { allowed, confirm: true } : { allowed },
    })),
    onSuccess: (providers, allowed) => {
      queryClient.setQueryData(keys.siteData, providers);
      setConfirmed(false);
      announce(pt(allowed ? 'siteDataAllowedNow' : 'siteDataStopped'));
    },
  });
  return (
    <Panel title={pt('siteDataTitle')}>
      <p>{pt('siteDataLead')}</p>
      {s.allowedAt ? (
        <>
          <p><Badge tone="success">{pt('siteDataOn')}</Badge>{' '}
            {pt('siteDataAllowed', { by: s.allowedBy ?? '', date: display.dateTime(s.allowedAt) })}</p>
          {set.error && <Notice tone="danger">{errorText(set.error)}</Notice>}
          <div className="form-actions">
            <Button isPending={set.isPending} onPress={() => set.mutate(false)}>{pt('siteDataStop')}</Button>
          </div>
        </>
      ) : (
        <>
          <Notice tone="info">
            <p><strong>{pt('siteDataNoLicence')}</strong></p>
            <p>{pt('siteDataRisk')}</p>
            <p>{pt('siteDataTaken')}</p>
          </Notice>
          <Checkbox isSelected={confirmed} onChange={setConfirmed}>{pt('siteDataConfirm')}</Checkbox>
          {set.error && <Notice tone="danger">{errorText(set.error)}</Notice>}
          <div className="form-actions">
            <Button variant="primary" isDisabled={!confirmed} isPending={set.isPending} onPress={() => set.mutate(true)}>{pt('siteDataAllow')}</Button>
          </div>
        </>
      )}
    </Panel>
  );
}

/** A link shown once, for the admin to pass on (Invitations, password reset links). */
function LinkToPassOn({ to, url, expiresAt, label }: { to: string; url: string; expiresAt: string; label: string }) {
  const display = useDisplay();
  return (
    <Notice tone="info">
      <p><Trans i18nKey="admin.linkIntro" values={{ to, until: display.dateTime(expiresAt) }} components={{ strong: <strong /> }} /></p>
      <CopyField value={url} label={label} />
    </Notice>
  );
}

function Invite() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [asAdmin, setAsAdmin] = useState(false);
  const invite = useMutation({
    mutationFn: async (body: { email: string; role: 'user' | 'admin' }) => unwrap(await api.POST('/api/invitations', { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.invitations }),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    invite.mutate(
      { email: String(new FormData(form).get('email')), role: asAdmin ? 'admin' : 'user' },
      { onSuccess: () => { form.reset(); setAsAdmin(false); } },
    );
  };

  return (
    <Panel title={t('admin.inviteTitle')}>
      <Form className="form-inline" onSubmit={submit}>
        <TextField label={t('admin.email')} name="email" type="email" isRequired autoComplete="off" />
        <Checkbox isSelected={asAdmin} onChange={setAsAdmin}>{t('admin.inviteAsAdmin')}</Checkbox>
        <Button type="submit" variant="primary" icon="link" isPending={invite.isPending}>{t('admin.createInvitation')}</Button>
      </Form>
      {invite.error && <Notice tone="danger">{errorText(invite.error)}</Notice>}
      {invite.data && (
        <LinkToPassOn to={invite.data.email} url={invite.data.url} expiresAt={invite.data.expiresAt} label={t('admin.invitationLink')} />
      )}
    </Panel>
  );
}

function Invitations() {
  const { t } = useTranslation();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const invitations = useQuery(invitationsQuery());
  const table = useRef<HTMLDivElement>(null);
  const revoke = useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE('/api/invitations/{id}', { params: { path: { id } } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.invitations }),
  });

  if (!invitations.data?.length) return null;
  return (
    <Panel title={t('admin.invitations')}>
      <div ref={table}>
      <Table cards label={t('admin.invitations')} head={[t('admin.email'), t('admin.role'), t('admin.status'), t('admin.expires'), { label: t('common.actions'), hidden: true }]}>
        {invitations.data.map((i) => (
          <tr key={i.id}>
            <td className="email">{i.email}</td>
            <td>{t(`admin.roles.${i.role}`)}</td>
            <td><Badge tone={i.status === 'accepted' ? 'success' : 'neutral'}>{t(`admin.invitationStatus.${i.status}`)}</Badge></td>
            <td className="date">{i.status === 'pending' ? display.dateTime(i.expiresAt) : t('common.none')}</td>
            <td>
              {i.status === 'pending' && (
                <ConfirmButton
                  variant="quiet"
                  aria-label={t('common.forItem', { action: t('admin.revoke'), item: i.email })}
                  title={t('admin.revokeTitle', { email: i.email })} body={t('admin.revokeBody')} confirmLabel={t('admin.revoke')}
                  onConfirm={() => revoke.mutateAsync(i.id)}
                  onDone={() => requestAnimationFrame(() => focusHeading(table.current))}
                >
                  {t('admin.revoke')}
                </ConfirmButton>
              )}
            </td>
          </tr>
        ))}
      </Table>
      </div>
    </Panel>
  );
}

function Users() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const users = useQuery(usersQuery());
  const me = useQuery(meQuery());
  // The server refuses to remove the last admin; don't offer it.
  const admins = users.data?.filter((u) => u.role === 'admin' && !u.disabled).length ?? 0;
  const panel = useRef<HTMLDivElement>(null);
  // After a User is deleted their row is gone; focus goes to the Users heading, not the page top.
  const onRemoved = () => requestAnimationFrame(() => focusHeading(panel.current));
  return (
    <Panel title={t('admin.users')}>
      <div ref={panel}>
      {users.error && <Notice tone="danger">{errorText(users.error)}</Notice>}
      {users.data && (
        <Table cards label={t('admin.users')} head={[t('admin.name'), t('admin.email'), t('admin.role'), t('admin.since'), { label: t('common.actions'), hidden: true }]}>
          {users.data.map((u) => <UserRow key={u.id} user={u} isMe={u.id === me.data?.user.id} isLastAdmin={u.role === 'admin' && admins <= 1} onRemoved={onRemoved} />)}
        </Table>
      )}
      </div>
    </Panel>
  );
}

/** One User with the admin's actions (ADR 0013). The server refuses what would leave no admin. */
function UserRow({ user: u, isMe, isLastAdmin, onRemoved }: { user: UserView; isMe: boolean; isLastAdmin: boolean; onRemoved: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const [demotingSelf, setDemotingSelf] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.users });
  const path = { params: { path: { id: u.id } } };

  const act = useMutation({
    mutationFn: async (action: 'make-admin' | 'make-user' | 'disable' | 'enable' | 'sign-out') => {
      switch (action) {
        case 'make-admin': case 'make-user':
          return void unwrap(await api.PATCH('/api/users/{id}', { ...path, body: { role: action === 'make-admin' ? 'admin' : 'user' } }));
        case 'disable': return void unwrap(await api.POST('/api/users/{id}/disable', path));
        case 'enable': return void unwrap(await api.POST('/api/users/{id}/enable', path));
        case 'sign-out':
          unwrap(await api.DELETE('/api/users/{id}/sessions', path));
          return setNotice(t('admin.signedOutEverywhere', { name: u.name }));
      }
    },
    onMutate: () => setNotice(undefined),
    onSettled: async (_data, _error, action) => {
      setDemotingSelf(false);
      await refresh();
      // Without the admin role the navigation and this page change; `me` says so.
      if (isMe && action === 'make-user') await queryClient.invalidateQueries({ queryKey: keys.me, exact: true });
    },
  });
  const reset = useMutation({ mutationFn: async () => unwrap(await api.POST('/api/users/{id}/password-reset', path)) });
  // Errors of confirmed actions show in their dialog.
  const error = (act.variables === 'disable' || act.variables === 'sign-out' ? null : act.error) ?? reset.error;
  /** Names the User for screen readers: every row has the same buttons (WCAG 2.4.6). */
  const label = (action: string) => t('common.forItem', { action, item: u.name });
  /** Disabling and signing out everywhere end someone's sessions: those ask first (UI review B2). */
  const [confirming, setConfirming] = useState<'disable' | 'sign-out'>();
  const roleAction = (action: 'make-admin' | 'make-user') => (isMe && action === 'make-user' ? setDemotingSelf(true) : act.mutate(action));
  const actions: { id: string; label: string; pendingNow?: boolean | undefined; run: () => void }[] = [
    ...(u.role === 'user' ? [{ id: 'make-admin', label: t('admin.makeAdmin'), run: () => roleAction('make-admin') }] : []),
    ...(u.role === 'admin' && !isLastAdmin ? [{ id: 'make-user', label: t('admin.makeUser'), run: () => roleAction('make-user') }] : []),
    ...(!u.disabled ? [{ id: 'reset', label: t('admin.createResetLink'), pendingNow: reset.isPending, run: () => reset.mutate() }] : []),
    ...(!isMe ? [
      { id: 'sign-out', label: t('admin.signOutEverywhere'), run: () => setConfirming('sign-out') },
      u.disabled
        ? { id: 'enable', label: t('admin.enable'), run: () => act.mutate('enable') }
        : { id: 'disable', label: t('admin.disable'), run: () => setConfirming('disable') },
      { id: 'delete', label: t('admin.delete'), run: () => setDeleting(true) },
    ] : []),
  ];
  // More than two actions go in one menu, as on the Divers page; its dialogs below stay mounted when the menu closes.
  const inMenu = actions.length > 2;

  return (
    <>
      <tr className={u.disabled ? 'is-disabled' : undefined}>
        <td>{u.name}{isMe && ` (${t('admin.you')})`}</td>
        <td className="email">{u.email}</td>
        <td>{t(`admin.roles.${u.role}`)}{u.disabled && `, ${t('admin.disabled')}`}</td>
        <td className="date">{display.dateTime(u.createdAt)}</td>
        <td>
          <div className="actions">
            {inMenu ? (
              <ActionMenu
                label={t('common.actions')} aria-label={label(t('common.actions'))}
                actions={actions.map((a) => ({ id: a.id, label: a.label, onAction: () => { if (!act.isPending) a.run(); } }))}
              />
            ) : actions.map((a) => (
              <Button
                key={a.id} variant="quiet" aria-label={label(a.label)}
                isPending={act.isPending && act.variables === a.id || !!a.pendingNow} isDisabled={act.isPending} onPress={a.run}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </td>
      </tr>
      {(error || notice || reset.data) && (
        <tr>
          <td colSpan={5}>
            {error && <Notice tone="danger">{errorText(error)}</Notice>}
            {notice && <Notice tone="success">{notice}</Notice>}
            {reset.data && <LinkToPassOn to={u.email} url={reset.data.url} expiresAt={reset.data.expiresAt} label={t('admin.resetLink')} />}
          </td>
        </tr>
      )}
      <ConfirmDialog
        isOpen={confirming === 'sign-out'} onOpenChange={(open) => !open && setConfirming(undefined)}
        title={t('admin.signOutTitle', { name: u.name })} body={t('admin.signOutBody')} confirmLabel={t('admin.signOutEverywhere')}
        onConfirm={() => act.mutateAsync('sign-out')}
      />
      <ConfirmDialog
        isOpen={confirming === 'disable'} onOpenChange={(open) => !open && setConfirming(undefined)}
        title={t('admin.disableTitle', { name: u.name })} body={t('admin.disableBody')} confirmLabel={t('admin.disable')}
        onConfirm={() => act.mutateAsync('disable')}
      />
      <DeleteUserDialog
        user={u} isOpen={deleting} onOpenChange={setDeleting}
        // The row is gone afterwards; focus goes to the Users heading instead of the page top.
        onDeleted={async () => { await refresh(); onRemoved(); }}
      />
      <Dialog title={t('admin.demoteSelfTitle')} isOpen={demotingSelf} onOpenChange={setDemotingSelf}>
        <p>{t('admin.demoteSelfBody')}</p>
        <div className="form-actions">
          <Button variant="danger" isPending={act.isPending} onPress={() => act.mutate('make-user')}>{t('admin.demoteSelfSubmit')}</Button>
          <Button onPress={() => setDemotingSelf(false)}>{t('common.cancel')}</Button>
        </div>
      </Dialog>
    </>
  );
}

function DeleteUserDialog({ user: u, isOpen, onOpenChange, onDeleted }: {
  user: UserView; isOpen: boolean; onOpenChange: (open: boolean) => void; onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const remove = useMutation({
    mutationFn: async (confirmEmail: string) =>
      unwrap(await api.DELETE('/api/users/{id}', { params: { path: { id: u.id } }, body: { confirmEmail } })),
    onSuccess: () => { onOpenChange(false); onDeleted(); },
  });
  return (
    <Dialog title={t('admin.deleteTitle', { name: u.name })} isOpen={isOpen} onOpenChange={onOpenChange}>
      <p>{t('admin.deleteBody')}</p>
      <Form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          remove.mutate(String(new FormData(e.currentTarget).get('confirmEmail')));
        }}
      >
        <TextField label={t('admin.deleteConfirm', { email: u.email })} name="confirmEmail" type="email" isRequired autoComplete="off" spellCheck="false" autoFocus />
        {remove.error && <Notice tone="danger">{errorText(remove.error)}</Notice>}
        <div className="form-actions">
          <Button type="submit" variant="danger" isPending={remove.isPending}>{t('admin.deleteSubmit', { name: u.name })}</Button>
          <Button onPress={() => onOpenChange(false)}>{t('common.cancel')}</Button>
        </div>
      </Form>
    </Dialog>
  );
}
