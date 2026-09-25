import { beforeEach, describe, expect, it, vi } from "vitest";
import { ByokClassifier } from "../src/lib/organize/byok";
import type { OrganizeSettings } from "../src/lib/organize/types";
import type { List } from "../src/lib/lists";
import { post } from "./fixtures";

const settings = (over: Partial<OrganizeSettings["byok"]> = {}): OrganizeSettings => ({
  provider: "byok",
  seeds: [],
  autoApply: false,
  byok: { baseUrl: "https://api.test/v1", model: "test-model", apiKey: "sk-test", ...over },
});

const ok = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });

function fetchMock(handlers: ((req: unknown, call: number) => Response)[]) {
  let call = 0;
  const fn = vi.fn(async () => handlers[Math.min(call++, handlers.length - 1)]!(undefined, call) as Response);
  return Object.assign(fn, { calls: () => call }) as unknown as typeof fetch & { calls: () => number };
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
    const f = fetchMock([
      () => ok({ categories: [{ name: "Other" }] }),
      () => ok({ assignments: {} }),
    ]);
    const c = new ByokClassifier(settings(), f);
    const proposal = await c.organize([post()], ["Must Keep"], () => {}, new AbortController().signal);
    expect(proposal.lists.map((l) => l.name)).toContain("Must Keep");
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
