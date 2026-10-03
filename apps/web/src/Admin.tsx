import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { api, invitationsQuery, keys, meQuery, unwrap, usersQuery, type UserView } from './api.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { focusHeading } from './lib/focus.ts';
import { usePageTitle } from './lib/page.ts';
import { Button, Checkbox, ConfirmButton, CopyField, Dialog, Form, Notice, Panel, Table, TextField } from './ui/index.ts';

/** Admins invite people (copy the link, there's no mail yet) and manage Users (ADR 0012, 0013). */
export function Admin() {
  const { t } = useTranslation();
  usePageTitle(t('nav.admin'));
  return (
    <>
      <h1>{t('nav.admin')}</h1>
      <Invite />
      <Invitations />
      <Users />
    </>
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
        <Button type="submit" variant="primary" isPending={invite.isPending}>{t('admin.createInvitation')}</Button>
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
  const errorText = useErrorText();
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
      <Table label={t('admin.invitations')} head={[t('admin.email'), t('admin.role'), t('admin.status'), t('admin.expires'), { label: t('common.actions'), hidden: true }]}>
        {invitations.data.map((i) => (
          <tr key={i.id}>
            <td>{i.email}</td>
            <td>{t(`admin.roles.${i.role}`)}</td>
            <td className={`status status-${i.status}`}>{t(`admin.invitationStatus.${i.status}`)}</td>
            <td>{i.status === 'pending' ? display.dateTime(i.expiresAt) : t('common.none')}</td>
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
        <Table label={t('admin.users')} head={[t('admin.name'), t('admin.email'), t('admin.role'), t('admin.since'), t('admin.actions')]}>
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
  const confirmed = (action: 'disable' | 'sign-out', text: string, title: string, body: string) => (
    <ConfirmButton
      variant="quiet" aria-label={label(text)} isDisabled={act.isPending}
      title={title} body={body} confirmLabel={text}
      onConfirm={() => act.mutateAsync(action)}
    >
      {text}
    </ConfirmButton>
  );
  const actionButton = (action: 'make-admin' | 'make-user' | 'enable', text: string) => (
    <Button
      variant="quiet" aria-label={label(text)}
      isPending={act.isPending && act.variables === action} isDisabled={act.isPending}
      onPress={() => (isMe && action === 'make-user' ? setDemotingSelf(true) : act.mutate(action))}
    >
      {text}
    </Button>
  );

  return (
    <>
      <tr className={u.disabled ? 'is-disabled' : undefined}>
        <td>{u.name}{isMe && ` (${t('admin.you')})`}</td>
        <td>{u.email}</td>
        <td>{t(`admin.roles.${u.role}`)}{u.disabled && `, ${t('admin.disabled')}`}</td>
        <td>{display.dateTime(u.createdAt)}</td>
        <td>
          <div className="actions">
            {u.role === 'user' && actionButton('make-admin', t('admin.makeAdmin'))}
            {u.role === 'admin' && !isLastAdmin && actionButton('make-user', t('admin.makeUser'))}
            {!u.disabled && (
              <Button variant="quiet" aria-label={label(t('admin.createResetLink'))} isPending={reset.isPending} onPress={() => reset.mutate()}>
                {t('admin.createResetLink')}
              </Button>
            )}
            {!isMe && (
              <>
                {confirmed('sign-out', t('admin.signOutEverywhere'), t('admin.signOutTitle', { name: u.name }), t('admin.signOutBody'))}
                {u.disabled
                  ? actionButton('enable', t('admin.enable'))
                  : confirmed('disable', t('admin.disable'), t('admin.disableTitle', { name: u.name }), t('admin.disableBody'))}
                <Button variant="quiet" aria-label={label(t('admin.delete'))} onPress={() => setDeleting(true)}>{t('admin.delete')}</Button>
              </>
            )}
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
