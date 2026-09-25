import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAll } from "../src/lib/db";
import { LocalClassifier, type Embedder } from "../src/lib/organize/local";
import type { List } from "../src/lib/lists";
import type { Post } from "../src/lib/types";
import { post } from "./fixtures";

// Fake embedder: each topic word maps to a different axis.
const AXES: Record<string, number> = { alpha: 0, beta: 1, gamma: 2, delta: 3 };
const fakeEmbed: Embedder = async (texts) =>
  texts.map((t) => {
    const v = new Float32Array(4).fill(0);
    for (const [word, axis] of Object.entries(AXES)) if (t.toLowerCase().includes(word)) v[axis] = 1;
    return v;
  });

const mkposts = (words: string[], perTopic: number): Post[] =>
  words.flatMap((w) => Array.from({ length: perTopic }, () => post({ text: `${w} ${w} interesting ${w}` })));

beforeEach(async () => {
  await clearAll();
});

describe("LocalClassifier", () => {
  it("groups posts by embedding similarity into a proposal", async () => {
    const posts = mkposts(["alpha", "beta", "gamma", "delta"], 6);
    const c = new LocalClassifier(fakeEmbed);
    const proposal = await c.organize(posts, [], () => {}, new AbortController().signal);
    expect(proposal.lists.length).toBeGreaterThanOrEqual(4);
    expect(proposal.unsorted).toHaveLength(0);
    for (const l of proposal.lists) {
      const word = posts.find((p) => p.id === l.postIds[0])!.text.split(" ")[0]!;
      expect(l.postIds.every((id) => posts.find((p) => p.id === id)!.text.startsWith(word))).toBe(true);
    }
  });

  it("uses seed names verbatim for seeded clusters", async () => {
    const posts = mkposts(["alpha", "beta", "gamma", "delta"], 5);
    const c = new LocalClassifier(fakeEmbed);
    const proposal = await c.organize(posts, ["Seed Topic"], () => {}, new AbortController().signal);
    expect(proposal.lists.some((l) => l.name === "Seed Topic")).toBe(true);
  });

  it("assign() puts new posts in the nearest list and outliers in unsorted", async () => {
    const list = (id: string, name: string): List => ({ id, name, createdAt: 0 });
    const centroids = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ];
    const model = { centroids, listIds: ["l1", "l2"] };
    const lists = [list("l1", "Alpha"), list("l2", "Beta")];
    const c = new LocalClassifier(fakeEmbed, model);
    const near = post({ id: "near", text: "alpha alpha alpha" });
    const far = post({ id: "far", text: "zzz qqq nothing" });
    const out = await c.assign([near, far], lists, new AbortController().signal);
    expect(out.get("near")).toEqual(["Alpha"]);
    expect(out.get("far")).toEqual([]);
  });
});
