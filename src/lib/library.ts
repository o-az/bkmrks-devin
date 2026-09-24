import { clearAll, getMeta, loadPosts, putPosts } from "./db";
import type { Credentials, PageResult, Post } from "./types";

export type SyncStatus =
  | { kind: "idle" }
  | { kind: "syncing"; mode: "full" | "catchup" | "rebuild" }
  | { kind: "paused"; until: number }
  | { kind: "error"; message: string; auth: boolean };

export interface LibraryState {
  ready: boolean;
  posts: Post[];
  status: SyncStatus;
  /** Whether the whole bookmark timeline has been walked at least once. */
  complete: boolean;
  lastSync: number | null;
}

interface SyncMeta {
  complete: boolean;
  /** Resume point for an unfinished full walk. */
  cursor: string | null;
  rebuild: boolean;
  /** Ids confirmed during a rebuild; anything else is dropped when it finishes. */
  seen: string[];
  lastSync: number | null;
}

const EMPTY_META: SyncMeta = { complete: false, cursor: null, rebuild: false, seen: [], lastSync: null };

class AuthError extends Error {}
class RateLimited extends Error {
  constructor(readonly until: number) {
    super("rate limited");
  }
}

export type PageFetcher = (creds: Credentials, cursor: string | null) => Promise<PageResult>;

export const fetchPage: PageFetcher = async (creds, cursor) => {
  let res: Response;
  try {
    res = await fetch("/api/bookmarks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...creds, cursor }),
    });
  } catch {
    throw new Error(navigator.onLine ? "Couldn't reach the server." : "You're offline.");
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 || body.error === "bad-credentials") throw new AuthError(body.message ?? "X rejected these cookies.");
  if (res.status === 429) throw new RateLimited(body.reset ? body.reset * 1000 : Date.now() + 15 * 60 * 1000);
  if (!res.ok) throw new Error(body.message ?? `Request failed (${res.status}).`);
  return { posts: body.posts ?? [], cursor: body.cursor ?? null };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Library {
  private byId = new Map<string, Post>();
  private meta: SyncMeta = EMPTY_META;
  private listeners = new Set<() => void>();
  private running = false;
  private generation = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  state: LibraryState = { ready: false, posts: [], status: { kind: "idle" }, complete: false, lastSync: null };

  constructor(
    private readonly fetcher: PageFetcher = fetchPage,
    private readonly delayMs = 300,
  ) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = () => this.state;

  private set(patch: Partial<LibraryState>, postsChanged = false) {
    this.state = {
      ...this.state,
      ...patch,
      ...(postsChanged ? { posts: [...this.byId.values()] } : {}),
      complete: this.meta.complete,
      lastSync: this.meta.lastSync,
    };
    for (const fn of this.listeners) fn();
  }

  async load(): Promise<void> {
    const [posts, meta] = await Promise.all([loadPosts(), getMeta<SyncMeta>("sync")]);
    this.byId = new Map(posts.map((p) => [p.id, p]));
    this.meta = { ...EMPTY_META, ...meta };
    this.set({ ready: true }, true);
  }

  /** Continues an unfinished walk, or fetches only what's new since last time. */
  async sync(creds: Credentials, rebuild = false): Promise<void> {
    if (this.running && !rebuild) return;
    const generation = ++this.generation;
    clearTimeout(this.retryTimer);
    this.running = true;
    try {
      if (rebuild) this.meta = { ...this.meta, complete: false, cursor: null, rebuild: true, seen: [] };
      if (!this.meta.complete) {
        const resumed = this.meta.cursor !== null;
        await this.walk(creds, generation);
        if (resumed && generation === this.generation) await this.catchUp(creds, generation);
      } else {
        await this.catchUp(creds, generation);
      }
      if (generation === this.generation) this.set({ status: { kind: "idle" } });
    } catch (err) {
      if (generation !== this.generation) return;
      if (err instanceof RateLimited) {
        this.set({ status: { kind: "paused", until: err.until } });
        this.retryTimer = setTimeout(() => void this.sync(creds), Math.max(err.until - Date.now(), 5000) + 2000);
      } else {
        const message = err instanceof Error ? err.message : "Sync failed.";
        this.set({ status: { kind: "error", message, auth: err instanceof AuthError } });
      }
    } finally {
      if (generation === this.generation) this.running = false;
    }
  }

  private merge(posts: Post[]) {
    for (const p of posts) this.byId.set(p.id, p);
  }

  private async walk(creds: Credentials, generation: number) {
    this.set({ status: { kind: "syncing", mode: this.meta.rebuild ? "rebuild" : "full" } });
    const seen = new Set(this.meta.seen);
    let cursor = this.meta.cursor;
    for (;;) {
      const page = await this.fetcher(creds, cursor);
      if (generation !== this.generation) return;
      this.merge(page.posts);
      if (this.meta.rebuild) for (const p of page.posts) seen.add(p.id);
      const finished = page.posts.length === 0 || !page.cursor || page.cursor === cursor;
      let remove: string[] = [];
      if (finished) {
        if (this.meta.rebuild) remove = [...this.byId.keys()].filter((id) => !seen.has(id));
        for (const id of remove) this.byId.delete(id);
        this.meta = { ...EMPTY_META, complete: true, lastSync: Date.now() };
      } else {
        this.meta = { ...this.meta, cursor: page.cursor, seen: this.meta.rebuild ? [...seen] : [] };
      }
      await putPosts(page.posts, { sync: this.meta }, remove);
      this.set({}, true);
      if (finished) return;
      cursor = page.cursor;
      await sleep(this.delayMs);
    }
  }

  private async catchUp(creds: Credentials, generation: number) {
    this.set({ status: { kind: "syncing", mode: "catchup" } });
    let cursor: string | null = null;
    for (;;) {
      const page = await this.fetcher(creds, cursor);
      if (generation !== this.generation) return;
      const reachedKnown = page.posts.some((p) => this.byId.has(p.id));
      this.merge(page.posts);
      const finished = reachedKnown || page.posts.length === 0 || !page.cursor || page.cursor === cursor;
      if (finished) this.meta = { ...this.meta, lastSync: Date.now() };
      await putPosts(page.posts, { sync: this.meta });
      this.set({}, true);
      if (finished) return;
      cursor = page.cursor;
      await sleep(this.delayMs);
    }
  }

  async clear(): Promise<void> {
    this.generation++;
    this.running = false;
    clearTimeout(this.retryTimer);
    this.byId.clear();
    this.meta = EMPTY_META;
    await clearAll();
    this.set({ status: { kind: "idle" } }, true);
  }
}
