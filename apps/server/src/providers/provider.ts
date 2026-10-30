// The seam between Dive Hub and an outside service it talks to (ADR 0027): a Provider is one adapter that declares
// its capabilities (how Users sign in, what it imports or exports, with which operations, how fast it may be called)
// and does only what is its own; the registry refuses an adapter without the method for something it declares. Connections,
// credentials, Pushes, leases, pacing, problem codes and the routes are the generic layer's (connection-service.ts,
// push-service.ts, lease-service.ts, routes.ts).
import type { CylinderMaterial, ParticipantRole, ProviderImportPlan } from '../db/schema.js';
import type { DiveMode, Position, SiteWaterType } from '../vocabulary.js';
import type { SiteSource } from '../sites/sources.js';
import { wallClockMs } from '../dives/time-zone.js';

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
  /**
   * The Dive's site has an External ID at this site Source (SSI site ID). `createdBySend`: a send finds the site at the
   * Provider or creates it there when the site has a position (`diveSites.find` and `create`), so only a site without
   * one blocks.
   */
  | { type: 'site_external_id'; source: SiteSource; createdBySend?: boolean }
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
  /**
   * Absent when the Provider numbers dives by itself and a client can't choose (ADR 0048). Present: a Connection can be
   * set to number dives here as in Dive Hub.
   */
  numbers?: {
    /** The operations on which the client sets the dive's number. `update` goes with `setNumber`. */
    set: ('create' | 'update')[];
    /** Whether changing the number of a dive already there can remove a verification it has (ADR 0043). */
    changeRemovesVerification: boolean;
  };
}

/** Every value of a dive a Provider may keep, named as the three-way comparison and the Provider's `fields` name them. */
export const DIVE_FIELDS = [
  'site', 'notes', 'buddies', 'cylinder', 'lead', 'startsAt', 'durationSeconds', 'maxDepthM', 'avgDepthM', 'waterTemperatureC',
  'maxTemperatureC', 'gas', 'device', 'profile', 'diveType', 'surfaceInterval', 'heartRate', 'tankPressure', 'cns',
] as const;
export type DiveField = (typeof DIVE_FIELDS)[number];

export interface Capabilities {
  /** Proper name, the same in every UI language. */
  name: string;
  signIn: SignIn;
  data: {
    dives?: {
      export?: DiveExport;
      import?: Direction;
      /** Which way each value of a dive travels. Absent: every value travels both ways as far as the Provider's operations allow (imported if it imports, sent if it exports). Present: a value missing from the map is not imported. */
      fields?: Partial<Record<DiveField, ('import' | 'export')[]>>;
    };
    diveSites?: { import?: Direction };
    /**
     * `find`: the account's own list of people (SSI's buddy list), through a Connection (ADR 0029). Export: `add` makes an
     * entry, `setAccount` gives an existing entry the person's account.
     */
    buddies?: { import?: Direction; export?: { operations: ('add' | 'setAccount')[] } };
    /** `find`: the account's certification cards, through a Connection (ADR 0050). */
    certifications?: { import?: Direction };
  };
  /** Things a client must say about this Provider, e.g. that it shows dives sent this way as unconfirmed. */
  notices: ('shows_unconfirmed' | 'presents_as_app')[];
  limits: {
    /** Pause between two actions on one Connection, in ms. */
    pauseMs: number;
    /**
     * Push runs (ADR 0047): the pause between two Dives of a run (at least `pauseMs`) and the most Dives one run sends.
     * Null: no runs. A Provider whose delivery is `handed_over` must declare null (the registry checks it).
     */
    run: { pauseMs: number; maxDives: number } | null;
    /** The shortest interval of a scheduled fetch of the Provider's dives, in minutes; null for none. */
    fetchEveryMinutes: number | null;
  };
}

/** Why the Provider didn't do what was asked; the generic layer turns it into a problem code. */
/**
 * `not_stored`: the Provider answered a save as done and stored nothing (SSI, for a client it doesn't take saves from: ADR 0049).
 * `not_found`: what the action names (a list entry) is no longer at the Provider.
 */
export type ProviderErrorReason = 'wrong_credentials' | 'signed_out' | 'refused' | 'not_stored' | 'unavailable' | 'bad_response' | 'not_found';

export class ProviderError extends Error {
  constructor(readonly reason: ProviderErrorReason, detail: string, options?: ErrorOptions) {
    super(`${reason}: ${detail}`, options);
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
  /**
   * The entry of the dive's Diver's own list at a source (SSI: the buddy list) remembered for this Participant's Diver.
   * Set only where one is remembered; the adapter reads its own source's.
   */
  entries?: Partial<Record<DiverSource, string>>;
}

export interface Series {
  offsetsMs: number[];
  values: number[];
}

/** The series a Provider may take or give, in m, °C, s, bar, bpm and %. */
export interface ProviderSamples {
  depth?: Series | undefined;
  temperature?: Series | undefined;
  ndl?: Series | undefined;
  tankPressure?: Series | undefined;
  heartRate?: Series | undefined;
  cns?: Series | undefined;
}

/** What a dive has on both sides: the values Dive Hub sends to a Provider and reads back from it. */
export interface ProviderDive {
  durationSeconds: number;
  maxDepthM: number | null;
  avgDepthM: number | null;
  /** Lowest water temperature, as on the Dive. */
  waterTemperatureC: number | null;
  maxTemperatureC: number | null;
  notes: string | null;
  /** The Dive site's External IDs by Source (e.g. its SSI site ID). */
  siteIds: Partial<Record<SiteSource, string>>;
  entry: { latitude: number; longitude: number } | null;
  exit: { latitude: number; longitude: number } | null;
  /** The first gas is the one single-gas logbooks describe. */
  gases: { o2: number; he: number }[];
  gfLow: number | null;
  gfHigh: number | null;
  cnsStart: number | null;
  cnsEnd: number | null;
  device: { manufacturer: string; product: string | null; serialNumber: string; firmware: string | null } | null;
  samples: ProviderSamples;
  /** The one tank; null when the Dive has none or several. */
  cylinder: ProviderCylinder | null;
  /** The weight in kg; null when there is none. */
  leadKg: number | null;
  diveMode: DiveMode | null;
  /** Seconds since the previous dive ended. */
  surfaceIntervalSeconds: number | null;
  avgHeartRate: number | null;
}

/** A Dive as it leaves Dive Hub, the same for every Provider. Times are ours: UTC plus the offset at the dive. */
export interface OutgoingDive extends ProviderDive {
  startsAt: Date;
  utcOffsetSeconds: number | null;
  /** The Dive site's water type (ADR 0025). */
  waterType: SiteWaterType | null;
  /** Who else was on the Dive (ADR 0028); the adapter takes the reference it needs from `ids`. */
  participants: OutgoingParticipant[];
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

/**
 * What an update leaves alone and what it empties (ADR 0056). `keep`: the Provider's value stays, whatever Dive Hub has.
 * `clear`: the Provider's value is removed. A field in neither is sent from the Dive as usual.
 */
export interface Leave { keep: DiveField[]; clear: DiveField[] }

/** The dive operations of one action. An adapter may share reads between them (one logbook read per action). */
export interface DiveExportAction {
  /** A dive we sent before (by our reference), and one at about the same time, if the Provider has them. */
  find?(dive: OutgoingDive, reference: string): Promise<{ ours: RemoteDive | null; sameTime: RemoteDive | null }>;
  /**
   * With a `number` (ADR 0048), the adapter gives the dive that number unless another dive there has it, as far as it
   * can tell; then it numbers its own way. `Delivered.remoteNumber` is what the dive has afterwards.
   */
  create(dive: OutgoingDive, reference: string, number?: number | null): Promise<Delivered>;
  /**
   * Null when the remote dive is gone (deleted at the Provider). `previous` is the payload the current Push recorded,
   * so the adapter can tell what it set before from what the User set in the Provider's own app. With a `number`: it
   * is set unless another dive there has it, in which case the number there stays.
   */
  update?(
    remoteId: string, dive: OutgoingDive, previous: Record<string, unknown> | null, number?: number | null, leave?: Leave,
  ): Promise<Delivered | null>;
  /**
   * The remote dive as the Provider has it now, in typed values, with the record it was read from and the context to
   * read it in; null when it is gone. It is the read the same action's `update` works from (no second read), so the
   * comparison and the update see one state. Offered by a Provider that has `update` and can read its dives.
   */
  current?(remoteId: string): Promise<{ dive: ImportedDive; context: ImportContext; record: Record<string, unknown> } | null>;
  /**
   * With `numbers.set` holding `update` (ADR 0048): changes only the number of the remote dive. `taken` saves nothing
   * and names the dive that holds the number; null when the remote dive is gone. With `sharedWith` (ADR 0052, the
   * first step of a swap or cycle in a run) the number is saved although that one dive holds it, and `taken` is
   * answered when any other dive does.
   */
  setNumber?(remoteId: string, number: number, sharedWith?: string): Promise<{ result: 'set'; remoteNumber: number } | { result: 'taken'; by: RemoteDive } | null>;
  /**
   * The dives of the Provider's logbook as they are now, read afresh (ADR 0052): the numbers held there, including by
   * dives Dive Hub doesn't know. Offered by a Provider that has `numbers` and can read its logbook.
   */
  heldNumbers?(): Promise<RemoteDive[]>;
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
  /** `private`: private to the account (and the account's own); `unknown`: the Provider doesn't say. Another account's private site is never listed. */
  visibility: 'public' | 'private' | 'unknown';
  waterType: SiteWaterType | null;
}

/** An entry in the account's own list of people at the Provider (SSI's buddy list). */
export interface RemoteBuddy {
  remoteId: string;
  name: string;
  /** The person's own account at the Provider, as a Diver External ID at `accountSource`; null without one. */
  account: string | null;
  /**
   * What the person's code at the Provider says about them (ADR 0043), where the list has it: an import stores these
   * on the Diver. Nothing else the Provider keeps about a person is passed on.
   */
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  leaderNumber?: string | null;
}

/** One certification card in the account (ADR 0050): the agency's own record, as typed values. */
export interface RemoteCertification {
  /** The Provider's ID of the card (SSI: `ccard_uid`); the key of a re-import. */
  remoteId: string;
  agency: string;
  /** The course or level as the Provider names it. */
  level: string;
  courseId: string | null;
  category: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  divesAtIssue: number | null;
  instructorName: string | null;
  instructorNumber: string | null;
  centreName: string | null;
  centreNumber: string | null;
  centreCity: string | null;
  centreCountry: string | null;
  /** Where the card's picture is (public, no sign-in); null when the Provider has none. Only an adapter makes it. */
  imageUrl: string | null;
}

/** What Dive Hub sends to find a dive again when an answer is lost: `divehub-<Dive id>`. */
export const REFERENCE_PREFIX = 'divehub-';
export const referenceOf = (diveId: string) => `${REFERENCE_PREFIX}${diveId}`;

/**
 * What a Provider's records need besides themselves (ADR 0030), kept on the Import: the account at the Provider of each
 * entry in the User's list of people, and each site's name and position. Never the people's names or anything else.
 */
export type ImportContext = {
  people: ProviderImportPlan['context']['people'];
  /**
   * Entry in the User's list of people without an account → the Diver it is remembered for (Diver IDs, no names). Filled
   * by the generic import before parsing; missing (as on an Import kept earlier) means none.
   */
  remembered?: Record<string, string>;
  /**
   * `private`: `true`, the Provider marks the site private and the account's own (another account's private site is left
   * out); `unknown`, the Provider doesn't say, so the site is kept as the account's, never public, and not settled.
   */
  sites: Record<string, ProviderImportPlan['context']['sites'][string] & { private?: true | 'unknown' }>;
};

/** The account's dives at the Provider, each as the record it keeps, and their context. */
export interface DiveListing {
  records: { remoteId: string; record: Record<string, unknown> }[];
  context: ImportContext;
}

/**
 * A dive as a Provider keeps it, in typed values (ADR 0030). `evidence` says how it got there: `ours` carries Dive Hub's
 * reference, `computer` was synced from a dive computer (a profile and a serial number), `logbook` was typed by hand.
 */
export interface ImportedDive extends ProviderDive {
  remoteId: string;
  remoteNumber: number | null;
  evidence: 'ours' | 'computer' | 'logbook';
  /** Dive Hub's reference (`divehub-<Dive id>`) when it carries one. */
  reference: string | null;
  /** The local wall-clock start, "YYYY-MM-DD HH:MM[:SS]", without a time zone. */
  localStart: string;
  /** The dive's site at the Provider: its position from the context (its IDs are `siteIds`). */
  sitePosition: { latitude: number; longitude: number } | null;
  /** The people on the dive, as their accounts at the Provider (Diver External IDs at `accountSource`). */
  people: string[];
  /** Divers found through a remembered entry without an account; they become Participants like `people`. Never the dive's own Diver. */
  diverIds?: string[];
}

/**
 * The dive's local start as milliseconds since 1970, read as if UTC. An adapter returns only dives with a readable
 * start (parseSsiDive drops the rest), so an unreadable one is a broken invariant.
 */
export function localStartOf(d: ImportedDive): number {
  const ms = wallClockMs(d.localStart);
  if (ms === null) throw new Error(`Provider dive ${d.remoteId} has an unreadable local start: ${d.localStart}`);
  return ms;
}

/** A Provider's single tank: what it keeps of a Cylinder. A value it doesn't have is null. */
export interface ProviderCylinder {
  volumeL: number | null;
  material: CylinderMaterial | null;
  startPressureBar: number | null;
  endPressureBar: number | null;
  /** Not compared; used only for `tank_vol_cuft`. */
  workingPressureBar?: number | null;
  /** In percent. */
  gas: { o2: number; he: number } | null;
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
    /**
     * Whether updating the remote dive with this Dive would remove a verification it has at the Provider (ADR 0043; SSI:
     * a changed start time). `previous` is the payload the current Push recorded, null for a dive linked and never sent.
     * From Dive Hub's data alone: the Provider isn't asked. Absent: the Provider has no such thing.
     */
    updateRemovesVerification?(dive: OutgoingDive, previous: Record<string, unknown> | null): boolean;
    /**
     * The operations of one action. Makes no call by itself: the registry opens one to check that each operation the
     * Capabilities declare has its method (createProviderRegistry), so the generic layer calls them without asking again.
     */
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
    /** One site by its ID; null: the Provider doesn't know the ID (or it is another account's private site). */
    get?(context: ActionContext, id: string): Promise<RemoteSite | null>;
    /** Makes a site at the Provider, private to the account; answers its ID. A site can't be deleted there. */
    create?(
      context: ActionContext, site: { name: string; position: Position; country: string | null; waterType: SiteWaterType | null },
    ): Promise<string>;
  };
  buddies?: {
    /**
     * The account's own list of people (SSI: the buddy list), read live; it may be a read from moments ago. `fresh`:
     * read it now (before forgetting an entry it misses).
     */
    find(context: ActionContext, options?: { fresh?: boolean }): Promise<RemoteBuddy[]>;
    /**
     * Makes an entry in the account's list and answers it as the Provider keeps it. With an `account` the Provider fills
     * the entry from the person's profile (or answers an entry of that account already in the list); without, the entry
     * is made from the name and e-mail.
     */
    add?(
      context: ActionContext, person: { firstName: string | null; lastName: string | null; email: string | null; account: string | null },
    ): Promise<RemoteBuddy>;
    /** Gives an existing entry an account and answers it as the Provider keeps it afterwards; `not_found` when the entry is gone. */
    setAccount?(context: ActionContext, entryId: string, account: string): Promise<RemoteBuddy>;
  };
  certifications?: {
    /** The account's certification cards, read live. */
    find(context: ActionContext): Promise<RemoteCertification[]>;
    /** A card's picture from the URL `find` gave: PNG bytes (no sign-in). Throws a ProviderError. */
    image(url: string): Promise<{ bytes: Uint8Array; mediaType: string }>;
  };
}
