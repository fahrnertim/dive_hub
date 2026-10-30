// Providers in the web client (ADR 0027): what the server says each offers (GET /api/providers), and their texts. The
// panels render from the capabilities; texts name the Provider, in its own words where it has them.
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { providersQuery, type ConflictFieldView, type ProblemCode, type ProviderView, type RequirementView } from '../api.ts';
import type en from '../i18n/locales/en.json';

/** A field the two sides exchange both ways and compare (ADR 0056). */
export type SyncedField = ConflictFieldView['field'];

type Paths<T> = { [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}` }[keyof T & string];
/** A text under `provider` in en.json; a Provider may word it itself under `providers.<id>`. */
export type ProviderTextKey = Paths<(typeof en)['provider']>;
/**
 * What a Provider may word itself under `providers.<id>`: a text of `provider.*` (useProviderText), or a problem's
 * text `errors.<code>` (useProblemText in display.ts). Anything else there would never be shown.
 */
export type ProviderOverrideKey = ProviderTextKey | `errors.${ProblemCode}`;
type Overrides = (typeof en)['providers'];
/** The keys under `providers.<id>` in en.json that override nothing: `never` while every one does (test/translations.test.ts). */
export type StrayOverride = { [Id in keyof Overrides]: Exclude<Paths<Overrides[Id]>, ProviderOverrideKey> }[keyof Overrides];

/** The Providers that take dives (Targets of dives), in the server's order. */
export const diveTargets = (providers: ProviderView[] | undefined) => (providers ?? []).filter((p) => p.data.dives?.export);
/**
 * Whether the Dive at a Provider has something that waits for the User: it changed since it was sent, the last
 * sending failed, the connection needs a new sign-in, a run left Conflicts to decide, or an entry of the queue waits (ADR 0056). Its line on the dive
 * page then opens by itself.
 */
export const waitsForUser = (s: {
  connection: { state: string } | null; current: { upToDate: boolean } | null; pushes: { state: string }[]; conflicts?: unknown[] | null;
  waiting?: unknown;
}) => !!s.connection && (s.connection.state === 'needs_sign_in' || s.pushes[0]?.state === 'failed' || (!!s.current && !s.current.upToDate)
  || (s.conflicts?.length ?? 0) > 0 || !!s.waiting);

/** The fields a send named (taken from or left at the Provider), in the import preview's words: "notes and buddies". */
export function useFieldNames() {
  const { t, i18n } = useTranslation();
  return (fields: readonly SyncedField[]) => new Intl.ListFormat(i18n.language, { type: 'conjunction' })
    .format(fields.map((f) => t(`provider.importField.${f}`)));
}
/** The Providers a User connects to (any sign-in but none). */
export const connectableProviders = (providers: ProviderView[] | undefined) => (providers ?? []).filter((p) => p.signIn.kind !== 'none');

export function useProviders() {
  return useQuery(providersQuery());
}

/** A Provider by what names it: all a dive's copy or a deleted dive needs, also of a Provider the server no longer lists. */
export type ProviderRef = Pick<ProviderView, 'id' | 'name'>;

/** A Provider by its id, from what the server says it has; a name it no longer lists stays the id. */
export function useProviderOf() {
  const providers = useProviders();
  return (id: string): ProviderRef => providers.data?.find((p) => p.id === id) ?? { id, name: id };
}

/** Texts about one Provider: `providers.<id>.<key>` where it words them itself, else `provider.<key>` with its name. */
export function useProviderText(p: ProviderRef) {
  const { t, i18n } = useTranslation();
  return (key: ProviderTextKey, options: Record<string, unknown> = {}): string => {
    const own = `providers.${p.id}.${key}`;
    return t((i18n.exists(own) ? own : `provider.${key}`) as `provider.${ProviderTextKey}`, { name: p.name, ...options });
  };
}

/**
 * What a User typed, as a site ID of the requirement's Source: a prefix the Source shows before it is dropped (SSI's
 * QR code says "site:3314"). Undefined when it isn't one. The forms come from the Provider (GET /api/providers).
 */
export function typedSiteId(r: Pick<RequirementView, 'pattern' | 'prefixes'>, text: string): string | undefined {
  let value = text.trim();
  const prefix = (r.prefixes ?? []).find((x) => value.toLowerCase().startsWith(x.toLowerCase()));
  if (prefix) value = value.slice(prefix.length).trim();
  return r.pattern && new RegExp(r.pattern).test(value) ? value : undefined;
}

/** "SSI", "SSI and PADI": names joined the way the UI language does. */
export function useJoinNames() {
  const { i18n } = useTranslation();
  return (names: string[]) => new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(names);
}
