// The seam between Dive Hub and an outside service it talks to (ADR 0027): a Provider is one adapter that declares
// its capabilities (how Users sign in, what it imports or exports, with which operations, how fast it may be called)
// and does only what is its own. Connections, credentials, Pushes, leases, pacing, problem codes and the routes are
// the generic layer's (connection-service.ts, push-service.ts, leases.ts, routes.ts).
import type { ParticipantRole, ProviderImportPlan } from '../db/schema.js';
import type { SiteWaterType } from '../vocabulary.js';
import type { SiteSource } from '../sites/sources.js';

export type DiverSource = 'ssi' | 'padi';

/** A Provider's id, e.g. `ssi`. The registry knows which exist; a test-only adapter registers its own in tests. */
export type ProviderId = string;

/** How a User signs in at the Provider. OAuth in the User's browser is designed in ADR 0027, not built. */
export type SignIn =
  | { kind: 'none' }
  /** E-mail (or user name) and password. The User may let Dive Hub keep the password, sealed, to renew by itself. */
  | { kind: 'password'; login: 'email' | 'username' }
  /** A token the User copies from the Provider. */
  | { kind: 'token' };

export const OPERATIONS = ['create', 'update', 'delete', 'link', 'find', 'list', 'readBack'] as const;
export type Operation = (typeof OPERATIONS)[number];
export const FIND_BY = ['reference', 'time', 'position'] as const;
export type FindBy = (typeof FIND_BY)[number];

/** What one direction (import or export) of a kind of data offers. */
export interface Direction {
  operations: Operation[];
  /** How `find` finds a record: by the reference we sent, by a time window, near a position. */
  findBy?: FindBy[];
}

/**
 * What an export needs (ADR 0029), checked against Dive Hub's own data only (requirements.ts). `blocking`: sending
 * refuses while it is unmet. `advisory`: sent without it, and the Push says what was left out. `description` is shown
 * only by a client that doesn't know the type.
 */
export type Requirement = { severity: 'blocking' | 'advisory'; description: string } & (
  /** The Dive's site has an External ID at this site Source (SSI site ID). */
  | { type: 'site_external_id'; source: SiteSource }
  /** The Provider can tell who each Participant in these roles is: today, by the Diver's account at `source`. */
  | { type: 'diver_mapping'; source: DiverSource; roles: ParticipantRole[] }
);

export interface DiveExport extends Direction {
  /** `confirmed`: an ID comes back. `handed_over`: delivered without one (QR, browser automation), so no update or delete. */
  delivery: 'confirmed' | 'handed_over';
  /** What sending needs (ADR 0029). */
  requirements: Requirement[];
  /** Field names a read-back reports differences under; clients translate them. */
  readBackFields?: string[];
}

export interface Capabilities {
  /** Proper name, the same in every UI language. */
  name: string;
  signIn: SignIn;
  data: {
    dives?: { export?: DiveExport; import?: Direction };
    diveSites?: { import?: Direction };
    /** `find`: the account's own list of people (SSI's buddy list), through a Connection (ADR 0029). */
    buddies?: { import?: Direction };
  };
  /** Things a client must say about this Provider, e.g. that it shows dives sent this way as unconfirmed. */
  notices: ('shows_unconfirmed')[];
  limits: {
    /** Pause between two actions on one Connection, in ms. */
    pauseMs: number;
  };
}

/** Why the Provider didn't do what was asked; the generic layer turns it into a problem code. */
export type ProviderErrorReason = 'wrong_credentials' | 'signed_out' | 'refused' | 'unavailable' | 'bad_response';

export class ProviderError extends Error {
  constructor(readonly reason: ProviderErrorReason, detail: string) {
    super(`${reason}: ${detail}`);
  }
}

/** What the User typed to sign in. */
export type SignInInput =
  | { kind: 'password'; login: string; password: string }
  | { kind: 'token'; token: string };

export interface SignedIn {
  /** The account at the Provider: its stable ID (SSI: user master ID) and what the User recognises it by. */
  account: { id: string; label: string };
  /** What later calls carry (a token). Sealed by the generic layer, never returned by the API. */
  access: string;
}

/** A Participant as it leaves Dive Hub: the Diver, its role, and its accounts at services by Source, nothing else. */
export interface OutgoingParticipant {
  diverId: string;
  name: string;
  role: ParticipantRole;
  ids: Partial<Record<DiverSource, string>>;
}

export interface Series {
  offsetsMs: number[];
  values: number[];
}

/** A Dive as it leaves Dive Hub, the same for every Provider. Times are ours: UTC plus the offset at the dive. */
export interface OutgoingDive {
  startsAt: Date;
  utcOffsetSeconds: number | null;
  durationSeconds: number;
  maxDepthM: number | null;
  avgDepthM: number | null;
  /** Lowest water temperature, as on the Dive. */
  waterTemperatureC: number | null;
  maxTemperatureC: number | null;
  /** The Dive site's water type (ADR 0025). */
  waterType: SiteWaterType | null;
  notes: string | null;
  /** The Dive site's External IDs by Source (e.g. its SSI site ID). */
  siteIds: Partial<Record<SiteSource, string>>;
  /** Who else was on the Dive (ADR 0028); the adapter takes the reference it needs from `ids`. */
  participants: OutgoingParticipant[];
  entry: { latitude: number; longitude: number } | null;
  exit: { latitude: number; longitude: number } | null;
  /** The first gas is the one single-gas logbooks describe. */
  gases: { o2: number; he: number }[];
  gfLow: number | null;
  gfHigh: number | null;
  cnsStart: number | null;
  cnsEnd: number | null;
  device: { manufacturer: string; product: string | null; serialNumber: string; firmware: string | null } | null;
  samples: { depth?: Series | undefined; temperature?: Series | undefined; ndl?: Series | undefined };
}

/** A dive as the Provider keeps it, in typed values. */
export interface RemoteDive {
  remoteId: string;
  number: number | null;
  /** Local time as the Provider keeps it, "YYYY-MM-DD HH:MM". */
  startsAt: string | null;
  maxDepthM: number | null;
  durationMinutes: number | null;
}

export interface ReadBackDifference {
  field: string;
  sent: string | number | null;
  stored: string | number | null;
}

/** What a create or update left at the Provider. */
export interface Delivered {
  /** Null when delivery is `handed_over`. */
  remoteId: string | null;
  remoteNumber: number | null;
  /** The record sent, without bulky parts such as samples. */
  payload: Record<string, unknown> | null;
  /** What the Provider stored differently; null when it couldn't be read back (or doesn't read back). */
  differences: ReadBackDifference[] | null;
  /** Participants it couldn't put on the remote dive, though it knew who they are (SSI: not in the buddy list). */
  leftOut?: { diverId: string; reason: 'not_at_provider' }[];
}

/** Who an action is for: the Connection's ID and account, and what calls carry. */
export interface ActionContext {
  connectionId: string;
  accountId: string;
  access: string;
}

/** The dive operations of one action. An adapter may share reads between them (one logbook read per action). */
export interface DiveExportAction {
  /** A dive we sent before (by our reference), and one at about the same time, if the Provider has them. */
  find?(dive: OutgoingDive, reference: string): Promise<{ ours: RemoteDive | null; sameTime: RemoteDive | null }>;
  create(dive: OutgoingDive, reference: string): Promise<Delivered>;
  /**
   * Null when the remote dive is gone (deleted at the Provider). `previous` is the payload the current Push recorded,
   * so the adapter can tell what it set before from what the User set in the Provider's own app.
   */
  update?(remoteId: string, dive: OutgoingDive, previous: Record<string, unknown> | null): Promise<Delivered | null>;
  /** `gone`: it was already deleted at the Provider. */
  remove?(remoteId: string): Promise<'deleted' | 'gone'>;
  /**
   * Whether the remote dive is still there, asked before deleting at several Providers so that none is deleted while
   * another would refuse. With `delete`, in whatever way the Provider can tell.
   */
  exists?(remoteId: string): Promise<boolean>;
}

/** A dive site at the Provider, to take its site ID from. */
export interface RemoteSite {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  /** As the Provider gives it. */
  country: string | null;
}

/** An entry in the account's own list of people at the Provider (SSI's buddy list). */
export interface RemoteBuddy {
  remoteId: string;
  name: string;
  /** The person's own account at the Provider, as a Diver External ID at `accountSource`; null without one. */
  account: string | null;
}

/** What Dive Hub sends to find a dive again when an answer is lost: `divehub-<Dive id>`. */
export const REFERENCE_PREFIX = 'divehub-';
export const referenceOf = (diveId: string) => `${REFERENCE_PREFIX}${diveId}`;

/**
 * What a Provider's records need besides themselves (ADR 0030), kept on the Import: the account at the Provider of each
 * entry in the User's list of people, and each site's name and position. Never the people's names or anything else.
 */
export type ImportContext = ProviderImportPlan['context'];

/** The account's dives at the Provider, each as the record it keeps, and their context. */
export interface DiveListing {
  records: { remoteId: string; record: Record<string, unknown> }[];
  context: ImportContext;
}

/**
 * A dive as a Provider keeps it, in typed values (ADR 0030). `evidence` says how it got there: `ours` carries Dive Hub's
 * reference, `computer` was synced from a dive computer (a profile and a serial number), `logbook` was typed by hand.
 */
export interface ImportedDive {
  remoteId: string;
  remoteNumber: number | null;
  evidence: 'ours' | 'computer' | 'logbook';
  /** Dive Hub's reference (`divehub-<Dive id>`) when it carries one. */
  reference: string | null;
  /** The local wall-clock start, "YYYY-MM-DD HH:MM[:SS]", without a time zone. */
  localStart: string;
  durationSeconds: number;
  maxDepthM: number | null;
  avgDepthM: number | null;
  /** Lowest and highest water temperature. */
  waterTemperatureC: number | null;
  maxTemperatureC: number | null;
  entry: { latitude: number; longitude: number } | null;
  exit: { latitude: number; longitude: number } | null;
  /** The dive's site at the Provider: its IDs by site Source, and its position from the context. */
  siteIds: Partial<Record<SiteSource, string>>;
  sitePosition: { latitude: number; longitude: number } | null;
  device: { manufacturer: string; product: string | null; serialNumber: string; firmware: string | null } | null;
  samples: { depth?: Series | undefined; temperature?: Series | undefined; ndl?: Series | undefined };
  gases: { o2: number; he: number }[];
  gfLow: number | null;
  gfHigh: number | null;
  cnsStart: number | null;
  cnsEnd: number | null;
  /** The people on the dive, as their accounts at the Provider (Diver External IDs at `accountSource`). */
  people: string[];
  notes: string | null;
}

/** How a Provider's dive record came about, to find why its times differ from a computer's. Never used in matching. */
export interface DiveOrigin {
  /** When the record was made at the Provider, as it keeps it (SSI: the creation time); null when it says nothing. */
  createdAt: string | null;
  confirmedByCentre: boolean;
  confirmedByLeader: boolean;
}

export interface ProviderAdapter {
  id: ProviderId;
  capabilities: Capabilities;
  /** The Diver External ID Source a connected account becomes (SSI: its account ID on the Diver), if any. */
  accountSource?: DiverSource;
  /** Signs in with what the User typed. Throws ProviderError. */
  signIn(input: SignInInput): Promise<SignedIn>;
  dives?: {
    /** How dives get there, as recorded on each Push. */
    mode: 'api' | 'qr';
    /** What decides "outdated": a hash of what this Provider receives of the Dive. */
    fingerprint(dive: OutgoingDive): string;
    open(context: ActionContext): DiveExportAction;
    /**
     * With `dives.import` `list` (ADR 0030): the account's dives as the Provider keeps them, read in one action. `recent`:
     * a read the adapter kept from moments ago may answer (the start right after a preview); otherwise it reads afresh.
     */
    list?(context: ActionContext, options?: { recent?: boolean }): Promise<DiveListing>;
    /**
     * One of those records in typed values; null when it is no dive Dive Hub can read. Pure: no calls. `remoteId` names
     * the dive when the record doesn't (what Dive Hub sent before it had the Provider's ID).
     */
    parse?(record: Record<string, unknown>, context: ImportContext, remoteId?: string): ImportedDive | null;
    /** How one of those records came about (who made and who confirmed it). Pure: no calls, no names of people or places. */
    origin?(record: Record<string, unknown>): DiveOrigin;
    /** The parser name and version a Recording made from a Provider's dive carries, e.g. `ssi-app-api`. */
    parser?: { name: string; version: string };
  };
  diveSites?: {
    /** The Provider's sites the User can pick from (SSI: the sites in their logbook). */
    find(context: ActionContext): Promise<RemoteSite[]>;
  };
  buddies?: {
    /** The account's own list of people (SSI: the buddy list), read live. */
    find(context: ActionContext): Promise<RemoteBuddy[]>;
  };
}
