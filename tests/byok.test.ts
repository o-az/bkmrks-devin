import { beforeEach, describe, expect, it, vi } from "vitest";
import { ByokClassifier, parseJson } from "../src/lib/organize/byok";
import type { OrganizeSettings, Progress } from "../src/lib/organize/types";
import type { List } from "../src/lib/lists";
import { post } from "./fixtures";

const settings = (over: Partial<OrganizeSettings["byok"]> = {}): OrganizeSettings => ({
  provider: "byok",
  seeds: [],
  autoApply: false,
  byok: { baseUrl: "https://api.test/v1", model: "test-model", apiKey: "sk-test", ...over },
});

const ok = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), {
    status: 200,
  });

function fetchMock(handlers: ((init: RequestInit | undefined, call: number) => Response | Promise<Response>)[]) {
  let call = 0;
  const bodies: unknown[] = [];
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
    return handlers[Math.min(call++, handlers.length - 1)]!(init, call) as Response;
  });
  return Object.assign(fn, { calls: () => call, bodies }) as unknown as typeof fetch & { calls: () => number; bodies: unknown[] };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("ByokClassifier", () => {
  it("discovers categories then assigns batches", async () => {
    const posts = Array.from({ length: 30 }, () => post());
    const f = fetchMock([
      () => ok({ categories: [{ name: "Tech" }, { name: "Food" }] }),
      () => ok({ assignments: Object.fromEntries(posts.map((p) => [p.id, [0]])) }),
    ]);
    const c = new ByokClassifier(settings(), f);
    const proposal = await c.organize(posts, [], () => {}, new AbortController().signal);
    expect(proposal.lists.map((l) => l.name)).toEqual(["Tech"]);
    expect(proposal.lists[0]!.postIds).toHaveLength(30);
    // discovery + 2 batches (30 posts / 25)
    expect(f.calls()).toBe(3);
  });

  it("honors seeds verbatim", async () => {
    const f = fetchMock([() => ok({ categories: [{ name: "Other" }] }), () => ok({ assignments: {} })]);
    const c = new ByokClassifier(settings(), f);
    const proposal = await c.organize([post()], ["Must Keep"], () => {}, new AbortController().signal);
    expect(proposal.lists.map((l) => l.name)).toContain("Must Keep");
  });

  it("retries once without response_format on a 400, then remembers", async () => {
    const posts = [post()];
    const f = fetchMock([
      () => new Response(JSON.stringify({ error: { message: "model does not support response_format" } }), { status: 400 }),
      () => ok({ categories: [{ name: "Tech" }] }),
      () => ok({ assignments: { [posts[0]!.id]: [0] } }),
    ]);
    const c = new ByokClassifier(settings(), f);
    const proposal = await c.organize(posts, [], () => {}, new AbortController().signal);
    expect(proposal.lists[0]!.postIds).toEqual([posts[0]!.id]);
    expect((f.bodies[0] as { response_format?: unknown }).response_format).toEqual({ type: "json_object" });
    expect((f.bodies[1] as { response_format?: unknown }).response_format).toBeUndefined();
    expect((f.bodies[2] as { response_format?: unknown }).response_format).toBeUndefined(); // remembered
  });

  it("parses fenced ```json content", async () => {
    expect(parseJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(parseJson('```\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("parses JSON embedded in prose", async () => {
    expect(parseJson('Sure! Here you go: {"categories": [{"name": "Tech"}]} — done.')).toEqual({ categories: [{ name: "Tech" }] });
    expect(() => parseJson("no json here")).toThrow("non-JSON");
  });

  it("includes the provider's error body in thrown errors", async () => {
    const f = fetchMock([() => new Response(JSON.stringify({ error: { message: "model does not support response_format" } }), { status: 400 })]);
    const c = new ByokClassifier(settings({ baseUrl: "https://api.test/v1" }), f);
    await expect(c.organize([post()], [], () => {}, new AbortController().signal)).rejects.toThrow(/400[\s\S]*response_format/);
  });

  it("reports a retry note through onProgress", async () => {
    vi.useFakeTimers();
    const notes: string[] = [];
    const posts = [post()];
    let n = 0;
    const f = vi.fn(async () => (n++ === 0 ? new Response("bad gateway", { status: 502 }) : ok({ categories: [{ name: "T" }] }))) as unknown as typeof fetch;
    const c = new ByokClassifier(settings(), f);
    const run = c.assign(posts, [{ id: "l", name: "T", createdAt: 0 }], new AbortController().signal);
    await vi.advanceTimersByTimeAsync(10_000);
    await run;
    // organize() path for the note plumbing:
    n = 0;
    const run2 = c
      .organize(posts, [], (p: Progress) => p.note && notes.push(p.note), new AbortController().signal)
      .catch(() => null);
    await vi.advanceTimersByTimeAsync(10_000);
    await run2;
    expect(notes.some((t) => /502|retrying \(2\/3\)/.test(t))).toBe(true);
    vi.useRealTimers();
  });

  it("retries malformed JSON then marks the batch unsorted", async () => {
    const posts = [post(), post()];
    let n = 0;
    const f = vi.fn(async () => {
      n++;
      if (n === 1) return ok({ categories: [{ name: "Tech" }] });
      return ok({ broken: true }) as Response;
    }) as unknown as typeof fetch;
    const c = new ByokClassifier(settings(), f);
    const proposal = await c.organize(posts, [], () => {}, new AbortController().signal);
    expect(proposal.unsorted).toEqual(posts.map((p) => p.id));
  });

  it("retries on 429 with backoff", async () => {
    vi.useFakeTimers();
    const posts = [post()];
    let n = 0;
    const f = vi.fn(async () => {
      n++;
      if (n === 1) return ok({ categories: [{ name: "Tech" }] });
      if (n === 2) return new Response("slow down", { status: 429 });
      return ok({ assignments: { [posts[0]!.id]: [0] } });
    }) as unknown as typeof fetch;
    const c = new ByokClassifier(settings(), f);
    const run = c.organize(posts, [], () => {}, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(10_000);
    const proposal = await run;
    expect(proposal.lists[0]!.postIds).toEqual([posts[0]!.id]);
    vi.useRealTimers();
  });

  it("aborts early when the signal fires", async () => {
    const ctrl = new AbortController();
    const f = vi.fn(async () => (ctrl.abort(), ok({ categories: [{ name: "T" }] }))) as unknown as typeof fetch;
    const c = new ByokClassifier(settings(), f);
    await expect(c.organize([post()], [], () => {}, ctrl.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("assign() maps posts to existing list names", async () => {
    const lists: List[] = [{ id: "l1", name: "Tech", createdAt: 0 }];
    const p = post();
    const f = fetchMock([() => ok({ assignments: { [p.id]: [0] } })]);
    const c = new ByokClassifier(settings(), f);
    const out = await c.assign([p], lists, new AbortController().signal);
    expect(out.get(p.id)).toEqual(["Tech"]);
  });
});

describe("ByokClassifier error handling", () => {
  it("strips invisible characters and a Bearer prefix from the key", async () => {
    const f = fetchMock([() => ok({ ok: true })]);
    const headers: Record<string, string>[] = [];
    const wrapped = (async (url: string, init?: RequestInit) => {
      headers.push(init?.headers as Record<string, string>);
      return f(url, init);
    }) as unknown as typeof fetch;
    await new ByokClassifier(settings({ apiKey: " Bearer sk-te\u200bst\n", baseUrl: "https://api.test/v1/ " }), wrapped).test(new AbortController().signal);
    expect(headers[0]!.authorization).toBe("Bearer sk-test");
  });

  it("test() reports status and surfaces 401 detail", async () => {
    const good = await new ByokClassifier(settings(), fetchMock([() => ok({ ok: true })])).test(new AbortController().signal);
    expect(good.status).toBe(200);
    const bad = new ByokClassifier(settings(), fetchMock([() => new Response("invalid key", { status: 401 })]));
    await expect(bad.test(new AbortController().signal)).rejects.toThrow(/rejected the API key \(401\): invalid key/);
  });

  it("explains a rejected fetch instead of a generic message", async () => {
    const f = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(new ByokClassifier(settings(), f).test(new AbortController().signal)).rejects.toThrow(/Couldn't reach api\.test: Failed to fetch/);
  });
});

describe("ByokClassifier default fetch", () => {
  it("calls the global fetch unbound from the classifier", async () => {
    const original = globalThis.fetch;
    let receiver: unknown = "unset";
    globalThis.fetch = function (this: unknown) {
      receiver = this;
      return Promise.resolve(ok({ ok: true }));
    } as typeof fetch;
    try {
      await new ByokClassifier(settings()).test(new AbortController().signal);
    } finally {
      globalThis.fetch = original;
    }
    expect(receiver).not.toBeInstanceOf(ByokClassifier);
  });
});
