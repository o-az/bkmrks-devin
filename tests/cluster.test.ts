import { describe, expect, it } from "vitest";
import { chooseK, kmeans, nameClusters } from "../src/lib/organize/cluster";
import { excerpt } from "../src/lib/organize/text";

function vec(seed: number, dim = 8): Float32Array {
  const v = new Float32Array(dim).fill(0);
  v[seed % dim] = 1;
  return v;
}

function cluster(seedVec: Float32Array, n: number, noise = 0.05): Float32Array[] {
  return Array.from({ length: n }, (_, i) => {
    const v = Float32Array.from(seedVec);
    v[(i % v.length + 3) % v.length] = noise;
    return v;
  });
}

describe("kmeans", () => {
  it("recovers well-separated groups", () => {
    const a = vec(0);
    const b = vec(1);
    const c = vec(2);
    const vectors = [...cluster(a, 5), ...cluster(b, 5), ...cluster(c, 5)];
    const { labels } = kmeans(vectors, 3, { seed: 7 });
    const groups = new Map<number, Set<number>>();
    labels.forEach((l, i) => {
      const g = Math.floor(i / 5);
      if (!groups.has(l)) groups.set(l, new Set());
      groups.get(l)!.add(g);
    });
    expect(groups.size).toBe(3);
    for (const s of groups.values()) expect(s.size).toBe(1);
  });
});

describe("chooseK", () => {
  it("stays within bounds", () => {
    expect(chooseK(5)).toBe(4);
    expect(chooseK(200)).toBe(10);
    expect(chooseK(100000)).toBe(15);
  });
});

describe("excerpt", () => {
  it("returns short text collapsed but whole", () => {
    expect(excerpt("  hello\n\n  world  ", 140)).toBe("hello world");
  });

  it("cuts long text at a word boundary with an ellipsis", () => {
    const out = excerpt("the quick brown fox jumps over the lazy dog again and again", 40);
    expect(out).toBe("the quick brown fox jumps over the lazy…");
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
  });

  it("cuts mid-word when no usable space is near the limit", () => {
    expect(excerpt("averylongunbrokenwordthathasmorecharacters", 20)).toBe("averylongunbrokenwor…");
  });
});

describe("nameClusters", () => {
  it("returns title-cased stopword-free names ≤25 chars", () => {
    const ai = ["the new llm agents are great and the agents", "agents and llm benchmarks for the win"];
    const food = ["pasta recipe with garlic", "recipe for the best pasta"];
    const names = nameClusters([ai, food], [...ai, ...food]);
    for (const n of names) {
      expect(n.length).toBeLessThanOrEqual(25);
      expect(n).not.toMatch(/\bthe\b|\band\b|\bfor\b/);
      expect(n[0]).toMatch(/[A-Z]/);
    }
    expect(names[0]).toMatch(/Agents|Llm/);
    expect(names[1]).toMatch(/Pasta|Recipe/);
  });
});
