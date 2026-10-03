import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, invitationsQuery, keys, meQuery, unwrap, usersQuery, type UserView } from './api.ts';
import { formatLocalDateTime } from './format.ts';

const date = (iso: string) => formatLocalDateTime(iso, null);

/** Admins invite people (copy the link, there's no mail yet) and see who has an account (ADR 0012). */
export function Admin() {
  return (
    <>
      <Invite />
      <Invitations />
      <Users />
    </>
  );
}

function Invite() {
  const queryClient = useQueryClient();
  const invite = useMutation({
    mutationFn: async (body: { email: string; role: 'user' | 'admin' }) =>
      unwrap(await api.POST('/api/invitations', { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.invitations }),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    invite.mutate({ email: String(form.get('email')), role: form.get('admin') ? 'admin' : 'user' });
    event.currentTarget.reset();
  };

  return (
    <section className="card">
      <h2>Invite someone</h2>
      <form className="form inline" onSubmit={submit}>
        <label>E-mail<input name="email" type="email" required autoComplete="off" /></label>
        <label className="check"><input name="admin" type="checkbox" /> Admin</label>
        <button type="submit" disabled={invite.isPending}>Create invitation link</button>
      </form>
      {invite.error && <p className="error">{invite.error.message}</p>}
      {invite.data && <CopyLink to={invite.data.email} url={invite.data.url} expiresAt={invite.data.expiresAt} label="Invitation link" />}
    </section>
  );
}

function Invitations() {
  const queryClient = useQueryClient();
  const invitations = useQuery(invitationsQuery());
  const revoke = useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE('/api/invitations/{id}', { params: { path: { id } } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.invitations }),
  });

  if (!invitations.data?.length) return null;
  return (
    <section className="card">
      <h2>Invitations</h2>
      {revoke.error && <p className="error">{revoke.error.message}</p>}
      <table className="table">
        <thead><tr><th>E-mail</th><th>Role</th><th>Status</th><th>Expires</th><th /></tr></thead>
        <tbody>
          {invitations.data.map((i) => (
            <tr key={i.id}>
              <td>{i.email}</td>
              <td>{i.role}</td>
              <td className={`status ${i.status}`}>{i.status}</td>
              <td>{i.status === 'pending' ? date(i.expiresAt) : '–'}</td>
              <td>
                {i.status === 'pending' && (
                  <button type="button" className="link" disabled={revoke.isPending} onClick={() => revoke.mutate(i.id)}>Revoke</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** A link shown once, for the admin to pass on (Invitations, password reset links). */
function CopyLink({ to, url, expiresAt, label }: { to: string; url: string; expiresAt: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="invite-link">
      <p>Send this link to <strong>{to}</strong>. It works once, until {date(expiresAt)}, and is shown only now.</p>
      <div className="copy">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={label} />
        <button type="button" onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); }}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function Users() {
  const users = useQuery(usersQuery());
  const me = useQuery(meQuery());
  return (
    <section className="card">
      <h2>Users</h2>
      {users.error && <p className="error">{users.error.message}</p>}
      {users.data && (
        <table className="table">
          <thead><tr><th>Name</th><th>E-mail</th><th>Role</th><th>Since</th><th>Actions</th></tr></thead>
          <tbody>
            {users.data.map((u) => <UserRow key={u.id} user={u} isMe={u.id === me.data?.user.id} />)}
          </tbody>
        </table>
      )}
    </section>
  );
}

type Panel = 'none' | 'reset' | 'delete';

/** One User with the admin's actions (ADR 0013). The server refuses what would leave no admin. */
function UserRow({ user: u, isMe }: { user: UserView; isMe: boolean }) {
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>('none');
  const [notice, setNotice] = useState<string>();
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
          return setNotice(`${u.name} was signed out everywhere.`);
      }
    },
    onMutate: () => setNotice(undefined),
    onSettled: refresh,
  });
  const reset = useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/users/{id}/password-reset', path)),
    onSuccess: () => setPanel('reset'),
  });
  const remove = useMutation({
    mutationFn: async (confirmEmail: string) => unwrap(await api.DELETE('/api/users/{id}', { ...path, body: { confirmEmail } })),
    onSuccess: refresh,
  });
  const error = act.error ?? reset.error ?? remove.error;

  return (
    <>
      <tr className={u.disabled ? 'disabled' : undefined}>
        <td>{u.name}{isMe && ' (you)'}</td>
        <td>{u.email}</td>
        <td>{u.role}{u.disabled && ', disabled'}</td>
        <td>{date(u.createdAt)}</td>
        <td className="actions">
          <button type="button" className="link" disabled={act.isPending}
            onClick={() => act.mutate(u.role === 'admin' ? 'make-user' : 'make-admin')}>
            {u.role === 'admin' ? 'Make user' : 'Make admin'}
          </button>
          {!u.disabled && (
            <button type="button" className="link" disabled={reset.isPending} onClick={() => reset.mutate()}>Password reset link</button>
          )}
          {!isMe && (
            <>
              <button type="button" className="link" disabled={act.isPending} onClick={() => act.mutate('sign-out')}>Sign out everywhere</button>
              <button type="button" className="link" disabled={act.isPending} onClick={() => act.mutate(u.disabled ? 'enable' : 'disable')}>
                {u.disabled ? 'Enable' : 'Disable'}
              </button>
              <button type="button" className="link danger" onClick={() => setPanel(panel === 'delete' ? 'none' : 'delete')}>Delete…</button>
            </>
          )}
        </td>
      </tr>
      {(error || notice || panel !== 'none') && (
        <tr className="panel">
          <td colSpan={5}>
            {error && <p className="error">{error.message}</p>}
            {notice && <p className="ok">{notice}</p>}
            {panel === 'reset' && reset.data && (
              <CopyLink to={u.email} url={reset.data.url} expiresAt={reset.data.expiresAt} label="Password reset link" />
            )}
            {panel === 'delete' && (
              <form
                className="form"
                onSubmit={(e) => {
                  e.preventDefault();
                  remove.mutate(String(new FormData(e.currentTarget).get('confirmEmail')));
                }}
              >
                <p>
                  Deleting <strong>{u.name}</strong> removes their account, their uploaded files and Imports, and their own
                  Diver with all Dives. <strong>This can't be undone.</strong> To keep the data, disable the User instead.
                </p>
                <label>Type <code>{u.email}</code> to confirm<input name="confirmEmail" required autoComplete="off" /></label>
                <div><button type="submit" className="danger" disabled={remove.isPending}>Delete {u.name}</button></div>
              </form>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
