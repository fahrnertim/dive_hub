import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { formValues } from './Account.tsx';
import {
  aiAccessLogQuery, aiAccessQuery, aiAccessSettingQuery, api, keys, meQuery, unwrap, type AiAccessLogEntry, type AiAccessView,
} from './api.ts';
import { argumentsText, setupLines } from './lib/ai-access.ts';
import { announce } from './lib/announce.ts';
import { useDisplay, useErrorText } from './lib/display.ts';
import { refocusAfterRemoval } from './lib/focus.ts';
import { Badge, Button, Checkbox, ConfirmButton, CopyField, Form, Muted, Notice, Panel, Table, TextField } from './ui/index.ts';

/** Matches the server's limit for an AI access's name. */
const NAME_MAX = 60;
const LOG_STEP = 25;

/**
 * A User's AI accesses (ADR 0035): what an access hands to the User's AI provider, creating one (the key is shown
 * once, with lines to copy into the LLM client), the accesses with their last use, revoking, and what they read.
 */
export function AiAccess() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const me = useQuery(meQuery());
  const access = useQuery(aiAccessQuery());
  const [created, setCreated] = useState<{ name: string; key: string } | null>(null);
  if (!access.data) {
    return access.error ? <Panel title={t('aiAccess.title')}><Notice tone="danger">{errorText(access.error)}</Notice></Panel> : null;
  }
  const { enabled, endpoint, accesses } = access.data;
  return (
    <Panel title={t('aiAccess.title')}>
      <div className="ai-access">
      <p>{t('aiAccess.lead')}</p>
      {!enabled && (
        <Notice tone="info">
          <p>
            {me.data?.user.role === 'admin'
              ? <Trans i18nKey="aiAccess.offAdmin" components={{ a: <a href="#/admin" /> }} />
              : t('aiAccess.off')}
            {accesses.length > 0 && <> {t('aiAccess.offExisting')}</>}
          </p>
        </Notice>
      )}
      {enabled && (
        <>
          <div className="ai-access-part">
            <h3 className="subheading">{t('aiAccess.sharedTitle')}</h3>
            <p>{t('aiAccess.sharedLead')}</p>
            <ul className="ai-access-shared">
              <li>{t('aiAccess.sharedDives')}</li>
              <li>{t('aiAccess.sharedBuddies')}</li>
              <li>{t('aiAccess.sharedPositions')}</li>
            </ul>
            <Muted>{t('aiAccess.sharedLog')}</Muted>
          </div>
          {created
            ? <CreatedAccess created={created} endpoint={endpoint} onDone={() => setCreated(null)} />
            : <CreateAccess onCreated={setCreated} />}
        </>
      )}
      <Accesses accesses={accesses} />
      <AccessLog />
      </div>
    </Panel>
  );
}

function CreateAccess({ onCreated }: { onCreated: (created: { name: string; key: string }) => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [positions, setPositions] = useState(false);
  const create = useMutation({
    mutationFn: async (name: string) => unwrap(await api.POST('/api/me/ai-accesses', { body: { name, positions } })),
    onSuccess: async ({ access, key }) => {
      await queryClient.invalidateQueries({ queryKey: keys.aiAccess });
      onCreated({ name: access.name, key });
    },
  });
  return (
    <Form className="form narrow-form" onSubmit={(e) => create.mutate(formValues(e).name!.trim())}>
      <h3 className="subheading">{t('aiAccess.createTitle')}</h3>
      <TextField label={t('aiAccess.name')} description={t('aiAccess.nameHint')} name="name" maxLength={NAME_MAX} isRequired autoComplete="off" />
      <Checkbox isSelected={positions} onChange={setPositions}>
        <span className="radio-text"><span>{t('aiAccess.positions')}</span><span className="field-description">{t('aiAccess.positionsHint')}</span></span>
      </Checkbox>
      {create.error && <Notice tone="danger">{errorText(create.error)}</Notice>}
      <div className="form-actions"><Button type="submit" variant="primary" icon="add" isPending={create.isPending}>{t('aiAccess.create')}</Button></div>
    </Form>
  );
}

/** The new key, shown this once (only its hash is stored), with what to paste into each kind of LLM client. */
function CreatedAccess({ created, endpoint, onDone }: { created: { name: string; key: string }; endpoint: string; onDone: () => void }) {
  const { t } = useTranslation();
  const lines = setupLines(endpoint, created.key);
  return (
    <div className="ai-access-part">
      <h3 className="subheading">{t('aiAccess.createdTitle', { name: created.name })}</h3>
      {/* The key stays out of the notice: a notice's text is also read out through the page's live region. */}
      <Notice tone="success">{t('aiAccess.createdBody')}</Notice>
      <LabelledCopy label={t('aiAccess.key')} value={created.key} />
      <p>{t('aiAccess.setupLead')}</p>
      <LabelledCopy label={t('aiAccess.setupClaudeCode')} value={lines.claudeCode} />
      <LabelledCopy label={t('aiAccess.setupVsCode')} value={lines.vsCode} />
      <LabelledCopy label={t('aiAccess.setupMcpRemote')} value={lines.mcpRemote} />
      <div className="form-actions"><Button onPress={onDone}>{t('aiAccess.done')}</Button></div>
    </div>
  );
}

function LabelledCopy({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <span className="field-label" aria-hidden="true">{label}</span>
      <CopyField label={label} value={value} />
    </div>
  );
}

function Accesses({ accesses }: { accesses: AiAccessView[] }) {
  const { t } = useTranslation();
  const display = useDisplay();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const list = useRef<HTMLDivElement>(null);
  const revoke = useMutation({
    mutationFn: async (a: AiAccessView) => {
      unwrap(await api.DELETE('/api/me/ai-accesses/{id}', { params: { path: { id: a.id } } }));
      return a;
    },
    onSuccess: async (a) => {
      await queryClient.invalidateQueries({ queryKey: keys.aiAccess });
      announce(t('aiAccess.revoked', { name: a.name }));
    },
  });
  return (
    <div className="ai-access-part" ref={list}>
      <h3 className="subheading">{t('aiAccess.list')}</h3>
      {revoke.error && <Notice tone="danger">{errorText(revoke.error)}</Notice>}
      {accesses.length === 0 ? <Muted>{t('aiAccess.empty')}</Muted> : (
        <Table cards label={t('aiAccess.list')} head={[
          t('aiAccess.name'), t('aiAccess.mayRead'), t('aiAccess.created'), t('aiAccess.lastUsed'), { label: t('common.actions'), hidden: true },
        ]}>
          {accesses.map((a, index) => (
            <tr key={a.id}>
              <td>{a.name}</td>
              <td>{a.scopes.includes('logbook:positions') ? t('aiAccess.scopeReadPositions') : t('aiAccess.scopeRead')}</td>
              <td className="date">{display.dateTime(a.createdAt)}</td>
              <td className="date">{a.lastUsedAt ? display.dateTime(a.lastUsedAt) : t('aiAccess.never')}</td>
              <td>
                <ConfirmButton
                  variant="quiet" icon="delete" aria-label={t('common.forItem', { action: t('aiAccess.revoke'), item: a.name })}
                  title={t('aiAccess.revokeTitle', { name: a.name })} body={t('aiAccess.revokeBody')} confirmLabel={t('aiAccess.revoke')}
                  onConfirm={() => revoke.mutateAsync(a)}
                  onDone={() => refocusAfterRemoval(list.current?.querySelector('tbody') ?? null, index, accesses.length)}
                >
                  {t('aiAccess.revoke')}
                </ConfirmButton>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

/** What the User's AI accesses read (ADR 0035): every tool call of the last 90 days, of revoked accesses too. */
function AccessLog() {
  const { t } = useTranslation();
  const display = useDisplay();
  const errorText = useErrorText();
  const [limit, setLimit] = useState(LOG_STEP);
  const log = useQuery(aiAccessLogQuery(limit));
  const outcome = (e: AiAccessLogEntry) => (e.outcome === 'ok'
    ? <Badge tone="success">{t('aiAccess.outcome.ok')}</Badge>
    : <Badge tone="danger">{t('aiAccess.outcome.error', { code: e.errorCode ?? '' })}</Badge>);
  return (
    <div className="ai-access-part">
      <h3 className="subheading">{t('aiAccess.logTitle')}</h3>
      <Muted>{t('aiAccess.logLead')}</Muted>
      {log.error && <Notice tone="danger">{errorText(log.error)}</Notice>}
      {log.data && (log.data.total === 0 ? <Muted>{t('aiAccess.logEmpty')}</Muted> : (
        <>
          <Table cards label={t('aiAccess.logTitle')} head={[
            t('aiAccess.logTime'), t('aiAccess.title'), t('aiAccess.logRequest'), { label: t('aiAccess.logRows'), numeric: true }, t('aiAccess.logOutcome'),
          ]}>
            {log.data.entries.map((e) => (
              <tr key={e.id}>
                <td className="date">{display.dateTime(e.at)}</td>
                <td>{e.accessName}</td>
                <td className="log-request"><code>{e.tool}</code>{Object.keys(e.arguments).length > 0 && <> {argumentsText(e.arguments)}</>}</td>
                <td className="num">{e.rows}</td>
                <td>{outcome(e)}</td>
              </tr>
            ))}
          </Table>
          <div className="form-actions">
            <Muted>{t('aiAccess.logShown', { shown: log.data.entries.length, count: log.data.total })}</Muted>
            {log.data.entries.length < log.data.total && (
              <Button isPending={log.isFetching} onPress={() => setLimit((n) => Math.min(100, n + LOG_STEP))} isDisabled={limit >= 100}>
                {t('aiAccess.logMore')}
              </Button>
            )}
          </div>
        </>
      ))}
    </div>
  );
}

/** Admins: whether this Dive Hub offers the MCP endpoint at all (off by default), and revoking every access (ADR 0035). */
export function AiAccessSetting() {
  const { t } = useTranslation();
  const display = useDisplay();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const setting = useQuery(aiAccessSettingQuery());
  const changed = async (data: NonNullable<typeof setting.data>) => {
    queryClient.setQueryData(keys.aiAccessSetting, data);
    await queryClient.invalidateQueries({ queryKey: keys.aiAccess });
  };
  const set = useMutation({
    mutationFn: async (enabled: boolean) => unwrap(await api.PUT('/api/admin/ai-access', { body: { enabled } })),
    onSuccess: async (data) => {
      await changed(data);
      announce(t(data.enabled ? 'aiAccess.adminNowOn' : 'aiAccess.adminNowOff'));
    },
  });
  const revokeAll = useMutation({
    mutationFn: async () => unwrap(await api.DELETE('/api/admin/ai-accesses')),
    onSuccess: async ({ revoked }) => {
      await queryClient.invalidateQueries({ queryKey: keys.aiAccessSetting });
      await queryClient.invalidateQueries({ queryKey: keys.aiAccess });
      announce(t('aiAccess.adminRevokedAll', { count: revoked }));
    },
  });
  const s = setting.data;
  if (!s) return setting.error ? <Panel title={t('aiAccess.title')}><Notice tone="danger">{errorText(setting.error)}</Notice></Panel> : null;
  const when = s.changedAt ? display.dateTime(s.changedAt) : '';
  return (
    <Panel title={t('aiAccess.title')}>
      <p>{t('aiAccess.adminLead')}</p>
      <p>
        <Badge tone={s.enabled ? 'success' : 'neutral'}>{t(s.enabled ? 'aiAccess.adminOn' : 'aiAccess.adminOff')}</Badge>{' '}
        {s.changedAt && (s.changedBy
          ? t(s.enabled ? 'aiAccess.adminSwitchedOnBy' : 'aiAccess.adminSwitchedOffBy', { by: s.changedBy, date: when })
          : t(s.enabled ? 'aiAccess.adminSwitchedOn' : 'aiAccess.adminSwitchedOff', { date: when }))}
      </p>
      <p>{t('aiAccess.adminCount', { count: s.accesses })}</p>
      {(set.error ?? revokeAll.error) && <Notice tone="danger">{errorText(set.error ?? revokeAll.error)}</Notice>}
      <div className="form-actions">
        {s.enabled ? (
          <ConfirmButton
            title={t('aiAccess.adminOffTitle')} body={t('aiAccess.adminOffBody')} confirmLabel={t('aiAccess.adminSwitchOff')}
            onConfirm={() => set.mutateAsync(false)}
          >
            {t('aiAccess.adminSwitchOffOpen')}
          </ConfirmButton>
        ) : (
          <Button variant="primary" isPending={set.isPending} onPress={() => set.mutate(true)}>{t('aiAccess.adminSwitchOn')}</Button>
        )}
        {s.accesses > 0 && (
          <ConfirmButton
            icon="delete" title={t('aiAccess.adminRevokeAllTitle')} body={t('aiAccess.adminRevokeAllBody', { count: s.accesses })}
            confirmLabel={t('aiAccess.adminRevokeAll')} onConfirm={() => revokeAll.mutateAsync()}
          >
            {t('aiAccess.adminRevokeAllOpen')}
          </ConfirmButton>
        )}
      </div>
    </Panel>
  );
}
