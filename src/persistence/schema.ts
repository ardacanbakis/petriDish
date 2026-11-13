import { z } from 'zod';
import { ANTIBIOTIC_IDS } from '../data/antibiotics';
import { MEDIUM_IDS } from '../data/media';
import { ORGANISM_IDS } from '../data/organisms';
import { MIXED_SAMPLE_IDS, type SourceId } from '../data/samples';
import type { LoggedEvent } from './events';

/**
 * The `.agar.json` session file. It holds what the user did (seed + event
 * log), never simulation state: opening a file replays the events.
 *
 * Bump SESSION_SCHEMA_VERSION and add a migration below whenever the shape
 * changes, so older files keep opening.
 */
export const SESSION_SCHEMA_VERSION = 1;
export const SESSION_FILE_EXTENSION = '.agar.json';

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const step = z.number().int().min(0).max(10_000_000);
const dishId = z.string().min(1).max(40);
const tool = z.enum(['loop', 'swab']);
const medium = z.enum(MEDIUM_IDS as [string, ...string[]]);
const antibiotic = z.enum(ANTIBIOTIC_IDS as [string, ...string[]]);
const location = z.enum(['bench', 'incubator', 'fridge']);
const mm = finite.min(-100).max(100);

const SOURCE_IDS = new Set<string>([
  ...ORGANISM_IDS.map((id) => `organism:${id}`),
  ...MIXED_SAMPLE_IDS.map((id) => `sample:${id}`),
]);
const source = z.string().refine((value) => SOURCE_IDS.has(value), 'unknown culture or sample');

const eventSchema = z.discriminatedUnion('type', [
  z.object({
    step,
    type: z.literal('addDish'),
    dishId,
    slot: z.number().int().min(0).max(3),
    medium,
  }),
  z.object({ step, type: z.literal('discardDish'), dishId }),
  z.object({ step, type: z.literal('moveDish'), dishId, location }),
  z.object({ step, type: z.literal('setLid'), dishId, open: z.boolean() }),
  z.object({ step, type: z.literal('setLabel'), dishId, label: z.string().max(60) }),
  z.object({ step, type: z.literal('sterilize'), tool }),
  z.object({ step, type: z.literal('putDown'), tool }),
  z.object({ step, type: z.literal('load'), tool, source }),
  z.object({
    step,
    type: z.literal('stroke'),
    dishId,
    tool,
    strokeId: z.number().int().min(0),
    points: z
      .array(mm)
      .max(200_000)
      .refine((points) => points.length % 2 === 0, 'points must be x, y pairs'),
  }),
  z.object({ step, type: z.literal('placeDisc'), dishId, antibiotic, xMm: mm, yMm: mm }),
  z.object({
    step,
    type: z.literal('expose'),
    dishId,
    labHours: finite.min(0).max(100_000),
    protection: finite.min(0).max(1),
  }),
  z.object({
    step,
    type: z.literal('setIncubator'),
    tempC: finite.min(0).max(80),
    co2: z.boolean(),
  }),
  z.object({ step, type: z.literal('setRoomTemperature'), tempC: finite.min(0).max(50) }),
  z.object({ step, type: z.literal('setBurner'), lit: z.boolean() }),
]);

const sessionSchema = z.object({
  app: z.literal('agar'),
  schemaVersion: z.literal(SESSION_SCHEMA_VERSION),
  name: z.string().max(80),
  /** ISO timestamp of when the file was written. */
  savedAt: z.string().max(40),
  seed: z.number().int().min(0).max(0xffffffff),
  gridSize: z.number().int().min(32).max(1024),
  dtHours: finite.gt(0).max(1),
  /** Where the user was on the timeline, and how far the timeline extends, in lab hours. */
  timeHours: finite.min(0),
  endHours: finite.min(0),
  events: z
    .array(eventSchema)
    .max(100_000)
    .refine(
      (events) => events.every((event, i) => i === 0 || events[i - 1].step <= event.step),
      'events must be in time order',
    ),
});

export interface SessionFile {
  app: 'agar';
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  name: string;
  savedAt: string;
  seed: number;
  gridSize: number;
  dtHours: number;
  timeHours: number;
  endHours: number;
  events: LoggedEvent[];
}

type Json = Record<string, unknown>;

/**
 * Migrations, keyed by the version they upgrade *from*. Each returns the file
 * in the next version's shape; they are applied in sequence.
 */
const MIGRATIONS: Record<number, (file: Json) => Json> = {
  // v0 (pre-release) stamped events with lab hours (`atHours`) instead of a step.
  0: (file) => {
    const dtHours = typeof file.dtHours === 'number' && file.dtHours > 0 ? file.dtHours : 0.05;
    const events = Array.isArray(file.events) ? file.events : [];
    return {
      ...file,
      schemaVersion: 1,
      dtHours,
      endHours: file.endHours ?? file.timeHours ?? 0,
      events: events.map((event: Json) => {
        const { atHours, ...rest } = event;
        return { ...rest, step: Math.round((typeof atHours === 'number' ? atHours : 0) / dtHours) };
      }),
    };
  },
};

export type ParseResult =
  | { ok: true; session: SessionFile }
  | { ok: false; reason: 'not-json' | 'not-agar' | 'too-new' | 'invalid'; detail: string };

/** Validate (and if necessary upgrade) the contents of a session file. Never throws. */
export function parseSessionFile(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: 'not-json', detail: error instanceof Error ? error.message : '' };
  }
  return parseSessionObject(raw);
}

export function parseSessionObject(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null || (raw as Json).app !== 'agar') {
    return { ok: false, reason: 'not-agar', detail: 'missing "app": "agar"' };
  }
  let file = raw as Json;
  const version = file.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return { ok: false, reason: 'invalid', detail: 'schemaVersion is missing' };
  }
  if (version > SESSION_SCHEMA_VERSION) {
    return { ok: false, reason: 'too-new', detail: `file version ${version}, app supports ${SESSION_SCHEMA_VERSION}` }; // prettier-ignore
  }
  for (let v = version; v < SESSION_SCHEMA_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) return { ok: false, reason: 'invalid', detail: `no migration from version ${v}` };
    file = migrate(file);
  }
  const result = sessionSchema.safeParse(file);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.join('.');
    return {
      ok: false,
      reason: 'invalid',
      detail: where ? `${where}: ${issue.message}` : issue.message,
    };
  }
  const session = result.data as unknown as SessionFile;
  // Sources are validated as strings above; narrow them for the type system.
  for (const event of session.events) {
    if (event.type === 'load') event.source = event.source as SourceId;
  }
  return { ok: true, session };
}

export function serializeSession(session: SessionFile): string {
  return JSON.stringify(session);
}

/** A safe file name for a session, e.g. "Kirby-Bauer run 2" → "kirby-bauer-run-2.agar.json". */
export function sessionFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    // Drop accents (ç → c, ş → s); dotless ı has no decomposition, so map it by hand.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `${slug || 'session'}${SESSION_FILE_EXTENSION}`;
}
