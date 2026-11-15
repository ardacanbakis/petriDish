import { parseSessionFile, serializeSession, type SessionFile } from './schema';

/** The parts of the Web Storage API this module needs (so tests can supply a fake). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SessionMeta {
  id: string;
  name: string;
  savedAt: string;
  /** Lab time the session had reached, h. */
  endHours: number;
  /** Size of the stored session, characters. */
  size: number;
}

const INDEX_KEY = 'agar:sessions';
const LAST_KEY = 'agar:last-session';
const sessionKey = (id: string) => `agar:session:${id}`;

export type SaveResult =
  | { ok: true; evicted: SessionMeta[] }
  | { ok: false; reason: 'quota' | 'unavailable'; evicted: SessionMeta[] };

/**
 * Saved sessions in localStorage: one entry per session plus a small index.
 *
 * Storage can be missing, full or disabled. Nothing here throws: reads fall
 * back to "nothing saved", and a save that does not fit evicts the oldest
 * other sessions and, if it still does not fit, reports failure.
 */
export class SessionStore {
  constructor(private readonly storage: KeyValueStorage | null) {}

  /** The browser's localStorage, or a store that saves nothing if it is unavailable. */
  static browser(): SessionStore {
    try {
      const probe = '__agar_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return new SessionStore(localStorage);
    } catch {
      return new SessionStore(null);
    }
  }

  get available(): boolean {
    return this.storage !== null;
  }

  /** Saved sessions, most recently saved first. */
  list(): SessionMeta[] {
    const raw = this.read(INDEX_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (m): m is SessionMeta =>
            typeof m === 'object' &&
            m !== null &&
            typeof (m as SessionMeta).id === 'string' &&
            typeof (m as SessionMeta).name === 'string' &&
            typeof (m as SessionMeta).savedAt === 'string',
        )
        .sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
    } catch {
      return [];
    }
  }

  /** A saved session, or null if it is missing or no longer valid. */
  load(id: string): SessionFile | null {
    const raw = this.read(sessionKey(id));
    if (!raw) return null;
    const result = parseSessionFile(raw);
    return result.ok ? result.session : null;
  }

  /**
   * Save (or overwrite) a session. If storage is full, the oldest *other*
   * sessions are evicted one at a time until it fits.
   */
  save(id: string, session: SessionFile): SaveResult {
    if (!this.storage) return { ok: false, reason: 'unavailable', evicted: [] };
    const text = serializeSession(session);
    const evicted: SessionMeta[] = [];
    for (;;) {
      if (this.write(sessionKey(id), text)) break;
      // Oldest first; never the session being saved.
      const victim = this.list()
        .filter((m) => m.id !== id)
        .pop();
      if (!victim) return { ok: false, reason: 'quota', evicted };
      this.delete(victim.id);
      evicted.push(victim);
    }
    const meta: SessionMeta = {
      id,
      name: session.name,
      savedAt: session.savedAt,
      endHours: session.endHours,
      size: text.length,
    };
    const index = [meta, ...this.list().filter((m) => m.id !== id)];
    if (!this.write(INDEX_KEY, JSON.stringify(index))) {
      // The session is stored but cannot be listed: undo rather than leave an orphan.
      this.remove(sessionKey(id));
      return { ok: false, reason: 'quota', evicted };
    }
    return { ok: true, evicted };
  }

  rename(id: string, name: string): boolean {
    const session = this.load(id);
    if (!session) return false;
    return this.save(id, { ...session, name }).ok;
  }

  /** Copy a session under a new id and name. Returns the new id, or null on failure. */
  duplicate(id: string, newId: string, name: string, savedAt: string): string | null {
    const session = this.load(id);
    if (!session) return null;
    return this.save(newId, { ...session, name, savedAt }).ok ? newId : null;
  }

  delete(id: string): void {
    this.remove(sessionKey(id));
    this.write(INDEX_KEY, JSON.stringify(this.list().filter((m) => m.id !== id)));
    if (this.lastId === id) this.remove(LAST_KEY);
  }

  /** The session that was open most recently, to reopen on the next visit. */
  get lastId(): string | null {
    return this.read(LAST_KEY);
  }

  set lastId(id: string | null) {
    if (id === null) this.remove(LAST_KEY);
    else this.write(LAST_KEY, id);
  }

  private read(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  private remove(key: string): void {
    try {
      this.storage?.removeItem(key);
    } catch {
      // Nothing useful to do: the entry simply stays.
    }
  }
}
