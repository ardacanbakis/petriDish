import { describe, expect, it } from 'vitest';
import type { LoggedEvent } from '../events';
import {
  parseSessionFile,
  serializeSession,
  SESSION_SCHEMA_VERSION,
  sessionFileName,
  type SessionFile,
} from '../schema';
import { SessionStore, type KeyValueStorage } from '../storage';

const EVENTS: LoggedEvent[] = [
  { step: 0, type: 'addDish', dishId: 'dish-1', slot: 0, medium: 'blood-agar' },
  { step: 0, type: 'setLid', dishId: 'dish-1', open: true },
  { step: 0, type: 'sterilize', tool: 'loop' },
  { step: 0, type: 'load', tool: 'loop', source: 'sample:skin-swab' },
  { step: 0, type: 'stroke', dishId: 'dish-1', tool: 'loop', strokeId: 1, points: [-10, 0, 10, 0] },
  { step: 0, type: 'placeDisc', dishId: 'dish-1', antibiotic: 'gentamicin', xMm: 0, yMm: 20 },
  { step: 0, type: 'expose', dishId: 'dish-1', labHours: 0.01, protection: 0.9 },
  { step: 0, type: 'moveDish', dishId: 'dish-1', location: 'incubator' },
  { step: 40, type: 'setIncubator', tempC: 35, co2: true },
  { step: 480, type: 'discardDish', dishId: 'dish-1' },
];

function session(overrides: Partial<SessionFile> = {}): SessionFile {
  return {
    app: 'agar',
    schemaVersion: SESSION_SCHEMA_VERSION,
    name: 'Skin swab on blood agar',
    savedAt: '2026-11-13T10:00:00.000Z',
    seed: 12345,
    gridSize: 256,
    dtHours: 0.05,
    timeHours: 24,
    endHours: 24,
    events: EVENTS,
    ...overrides,
  };
}

describe('session file', () => {
  it('round-trips through JSON unchanged', () => {
    const result = parseSessionFile(serializeSession(session()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session).toEqual(session());
  });

  it('keeps notes, measurements and hand counts', () => {
    const annotated = session({
      annotations: {
        notes: [{ hours: 18, dishId: 'dish-1', text: 'Clear zone around CN.' }, { hours: 20, dishId: null, text: 'General remark' }],
        measurements: [{ dishId: 'dish-1', hours: 18, kind: 'zone', x1: -10, y1: 20, x2: 10, y2: 20, mm: 20, antibiotic: 'gentamicin' }],
        marks: [{ dishId: 'dish-1', xMm: 3, yMm: -4 }],
      },
      events: [...EVENTS.slice(0, 9), { step: 60, type: 'spread', dishId: 'dish-1', source: 'organism:escherichia-coli', dilutionExponent: 6 }, EVENTS[9]],
    }); // prettier-ignore
    const result = parseSessionFile(serializeSession(annotated));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.session).toEqual(annotated);
    // Files written before annotations existed still open.
    expect(parseSessionFile(serializeSession(session())).ok).toBe(true);
  });

  it('stays small: no simulation state is stored', () => {
    expect(serializeSession(session()).length).toBeLessThan(1500);
  });

  it.each([
    ['not JSON', 'hello', 'not-json'],
    ['another app', JSON.stringify({ app: 'other', schemaVersion: 1 }), 'not-agar'],
    ['an array', '[]', 'not-agar'],
    ['a newer version', JSON.stringify({ ...session(), schemaVersion: 99 }), 'too-new'],
    ['no version', JSON.stringify({ ...session(), schemaVersion: undefined }), 'invalid'],
  ])('rejects %s', (_label, text, reason) => {
    const result = parseSessionFile(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });

  it.each<[string, (s: SessionFile) => unknown]>([
    ['an unknown medium', (s) => ({ ...s, events: [{ ...EVENTS[0], medium: 'chocolate-agar' }] })],
    ['an unknown culture', (s) => ({ ...s, events: [{ step: 0, type: 'load', tool: 'loop', source: 'organism:yersinia-pestis' }] })], // prettier-ignore
    [
      'an unknown antibiotic',
      (s) => ({ ...s, events: [{ ...EVENTS[5], antibiotic: 'colistin' }] }),
    ],
    ['an unknown event type', (s) => ({ ...s, events: [{ step: 0, type: 'explode' }] })],
    [
      'an odd number of stroke coordinates',
      (s) => ({ ...s, events: [{ ...EVENTS[4], points: [1, 2, 3] }] }),
    ],
    ['a non-finite coordinate', (s) => ({ ...s, events: [{ ...EVENTS[4], points: [1, null] }] })],
    ['events out of time order', (s) => ({ ...s, events: [EVENTS[8], EVENTS[0]] })],
    ['a negative step', (s) => ({ ...s, events: [{ ...EVENTS[0], step: -1 }] })],
    ['an absurd grid size', (s) => ({ ...s, gridSize: 100000 })],
    ['a zero timestep', (s) => ({ ...s, dtHours: 0 })],
    ['a missing seed', (s) => ({ ...s, seed: undefined })],
    ['a slot outside the bench', (s) => ({ ...s, events: [{ ...EVENTS[0], slot: 7 }] })],
  ])('rejects %s with a message saying where', (_label, corrupt) => {
    const result = parseSessionFile(JSON.stringify(corrupt(session())));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid');
      expect(result.detail.length).toBeGreaterThan(3);
    }
  });

  it('upgrades a version 0 file (events stamped in hours)', () => {
    const legacy = {
      app: 'agar',
      schemaVersion: 0,
      name: 'old',
      savedAt: '2026-01-01T00:00:00.000Z',
      seed: 7,
      gridSize: 128,
      dtHours: 0.05,
      timeHours: 6,
      events: [
        { atHours: 0, type: 'addDish', dishId: 'dish-1', slot: 0, medium: 'lb-agar' },
        { atHours: 2, type: 'moveDish', dishId: 'dish-1', location: 'incubator' },
      ],
    };
    const result = parseSessionFile(JSON.stringify(legacy));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.schemaVersion).toBe(SESSION_SCHEMA_VERSION);
      expect(result.session.events.map((e) => e.step)).toEqual([0, 40]);
      expect(result.session.endHours).toBe(6);
    }
  });

  it('makes safe file names', () => {
    expect(sessionFileName('Kirby-Bauer run 2')).toBe('kirby-bauer-run-2.agar.json');
    expect(sessionFileName('  ../../etc/passwd ')).toBe('etc-passwd.agar.json');
    expect(sessionFileName('')).toBe('session.agar.json');
    expect(sessionFileName('Çalışma 1')).toBe('calisma-1.agar.json');
  });
});

/** In-memory storage with a size limit, behaving like a full localStorage when exceeded. */
class FakeStorage implements KeyValueStorage {
  readonly items = new Map<string, string>();
  constructor(private readonly quota = Infinity) {}
  private used(): number {
    let total = 0;
    for (const [key, value] of this.items) total += key.length + value.length;
    return total;
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    const previous = this.items.get(key);
    this.items.set(key, value);
    if (this.used() > this.quota) {
      if (previous === undefined) this.items.delete(key);
      else this.items.set(key, previous);
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    }
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

describe('session store', () => {
  const at = (minute: number) => `2026-11-13T10:${String(minute).padStart(2, '0')}:00.000Z`;

  it('saves, lists (newest first), loads, renames, duplicates and deletes', () => {
    const store = new SessionStore(new FakeStorage());
    expect(store.list()).toEqual([]);
    expect(store.save('a', session({ name: 'First', savedAt: at(1) })).ok).toBe(true);
    expect(store.save('b', session({ name: 'Second', savedAt: at(2) })).ok).toBe(true);
    expect(store.list().map((m) => m.name)).toEqual(['Second', 'First']);
    expect(store.load('a')?.name).toBe('First');
    expect(store.load('missing')).toBeNull();

    expect(store.rename('a', 'Renamed')).toBe(true);
    expect(store.load('a')?.name).toBe('Renamed');
    expect(store.duplicate('a', 'c', 'Copy of Renamed', at(3))).toBe('c');
    expect(store.list().map((m) => m.id)).toEqual(['c', 'b', 'a']);
    expect(store.load('c')?.events).toEqual(EVENTS);

    store.lastId = 'c';
    expect(store.lastId).toBe('c');
    store.delete('c');
    expect(store.list().map((m) => m.id)).toEqual(['b', 'a']);
    expect(store.lastId).toBeNull();
  });

  it('overwriting a session keeps one entry', () => {
    const store = new SessionStore(new FakeStorage());
    store.save('a', session({ savedAt: at(1) }));
    store.save('a', session({ savedAt: at(5), endHours: 48 }));
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].endHours).toBe(48);
  });

  it('when storage is full it evicts the oldest other sessions to make room', () => {
    const size = serializeSession(session()).length;
    const store = new SessionStore(new FakeStorage(size * 3 + 900));
    for (const [id, minute] of [
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ] as const) {
      expect(store.save(id, session({ savedAt: at(minute) })).ok).toBe(true);
    }
    const result = store.save('d', session({ savedAt: at(4) }));
    expect(result.ok).toBe(true);
    expect(result.evicted.map((m) => m.id)).toEqual(['a']);
    expect(store.list().map((m) => m.id)).toEqual(['d', 'c', 'b']);
    expect(store.load('a')).toBeNull();
  });

  it('never evicts the session being saved, and reports failure instead of throwing', () => {
    const tiny = new SessionStore(new FakeStorage(200));
    const result = tiny.save('a', session());
    expect(result).toEqual({ ok: false, reason: 'quota', evicted: [] });
    expect(tiny.list()).toEqual([]);
  });

  it('behaves when storage is unavailable or throws on everything', () => {
    const none = new SessionStore(null);
    expect(none.available).toBe(false);
    expect(none.list()).toEqual([]);
    expect(none.load('a')).toBeNull();
    expect(none.save('a', session())).toEqual({ ok: false, reason: 'unavailable', evicted: [] });
    expect(() => none.delete('a')).not.toThrow();

    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const store = new SessionStore(broken);
    expect(store.list()).toEqual([]);
    expect(store.save('a', session()).ok).toBe(false);
    expect(() => store.delete('a')).not.toThrow();
    expect(store.lastId).toBeNull();
  });

  it('ignores a corrupted index or session entry', () => {
    const storage = new FakeStorage();
    const store = new SessionStore(storage);
    store.save('a', session());
    storage.items.set('agar:sessions', '{not json');
    expect(store.list()).toEqual([]);
    storage.items.set('agar:session:a', '{"app":"agar","schemaVersion":1}');
    expect(store.load('a')).toBeNull();
  });
});
