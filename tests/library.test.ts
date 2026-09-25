import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Library, type PageFetcher } from "../src/lib/library";
import { clearAll } from "../src/lib/db";
import type { PageResult } from "../src/lib/types";
import { post } from "./fixtures";

const creds = { authToken: "a".repeat(40), ct0: "b".repeat(40) };

function server(pages: Record<string, PageResult>): PageFetcher & { calls: (string | null)[] } {
  const calls: (string | null)[] = [];
  const fn = vi.fn(async (_c, cursor: string | null) => {
    calls.push(cursor);
    const page = pages[cursor ?? "start"];
    if (!page) throw new Error(`unexpected cursor ${cursor}`);
    return page;
  }) as unknown as PageFetcher & { calls: (string | null)[] };
  fn.calls = calls;
  return fn;
}

beforeEach(async () => {
  await clearAll();
});

describe("Library", () => {
  it("walks every page, persists, and resumes without refetching", async () => {
    const [a, b, c] = [post(), post(), post()];
    const fetcher = server({ start: { posts: [a!, b!], cursor: "p2" }, p2: { posts: [c!], cursor: "p3" }, p3: { posts: [], cursor: "p4" } });
    const lib = new Library(fetcher, 0);
    await lib.load();
    await lib.sync(creds);
    expect(lib.state.posts).toHaveLength(3);
    expect(lib.state.complete).toBe(true);
    expect(fetcher.calls).toEqual([null, "p2", "p3"]);

    // A fresh instance (page reload) reads from IndexedDB and only checks the first page.
    const next = server({ start: { posts: [post(), a!], cursor: "p2" } });
    const reloaded = new Library(next, 0);
    await reloaded.load();
    expect(reloaded.state.posts).toHaveLength(3);
    await reloaded.sync(creds);
    expect(next.calls).toEqual([null]);
    expect(reloaded.state.posts).toHaveLength(4);
  });

  it("continues an interrupted walk from the saved cursor", async () => {
    const [a, b] = [post(), post()];
    let fail = true;
    const fetcher: PageFetcher = async (_c, cursor) => {
      if (cursor === null) return { posts: [a!], cursor: "p2" };
      if (fail) throw new Error("network");
      return { posts: [b!], cursor: null };
    };
    const lib = new Library(fetcher, 0);
    await lib.load();
    await lib.sync(creds);
    expect(lib.state.status).toMatchObject({ kind: "error", message: "network" });
    expect(lib.state.posts).toHaveLength(1);

    fail = false;
    const calls: (string | null)[] = [];
    const reloaded = new Library(async (c, cursor) => (calls.push(cursor), fetcher(c, cursor)), 0);
    await reloaded.load();
    await reloaded.sync(creds);
    expect(calls[0]).toBe("p2");
    expect(reloaded.state.posts).toHaveLength(2);
    expect(reloaded.state.complete).toBe(true);
  });

  it("rebuild drops posts that are no longer bookmarked", async () => {
    const [a, b] = [post(), post()];
    const lib = new Library(server({ start: { posts: [a!, b!], cursor: null } }), 0);
    await lib.load();
    await lib.sync(creds);
    const again = new Library(server({ start: { posts: [a!], cursor: null } }), 0);
    await again.load();
    await again.sync(creds, true);
    expect(again.state.posts.map((p) => p.id)).toEqual([a!.id]);
  });
});
