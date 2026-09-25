import { loadVectors, putVectors } from "../db";
import type { List, OrganizeModel } from "../lists";
import type { Post } from "../types";
import { chooseK, kmeans, nameClusters } from "./cluster";
import { postText } from "./text";
import type { Classifier, Progress, Proposal } from "./types";

export type Embedder = (texts: string[], onProgress: (done: number, total: number, note?: string) => void, signal: AbortSignal) => Promise<Float32Array[]>;

const mb = (bytes: number) => (bytes / 1048576).toFixed(1);

const MIN_SIMILARITY = 0.2;
const SECOND_LIST_DELTA = 0.03;

/** Embeds via Transformers.js in a Web Worker; the model is cached by the browser Cache API. */
export function workerEmbedder(): Embedder {
  return (texts, onProgress, signal) =>
    new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./local.worker.ts", import.meta.url), { type: "module" });
      const onAbort = () => {
        worker.terminate();
        reject(new DOMException("Aborted", "AbortError"));
      };
      const settle = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort);
      worker.onmessage = (e: MessageEvent) => {
        const m = e.data;
        if (m.type === "progress") onProgress(m.done, m.total);
        else if (m.type === "download") onProgress(0, m.total, `Downloading model… ${m.total ? `${mb(m.loaded)} / ${mb(m.total)} MB` : `${mb(m.loaded)} MB`}`);
        else if (m.type === "note") onProgress(0, 0, m.message);
        else if (m.type === "done") {
          settle();
          worker.terminate();
          resolve(m.vectors.map((v: number[]) => Float32Array.from(v)));
        } else if (m.type === "error") {
          settle();
          worker.terminate();
          reject(new Error(m.message));
        }
      };
      worker.onerror = (e) => {
        settle();
        worker.terminate();
        reject(new Error(e.message || "Embedding worker failed."));
      };
      worker.postMessage({ texts });
    });
}

function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Nearest-centroid assignment; below MIN_SIMILARITY → unsorted, near-tie → a second list. */
function nearest(vector: Float32Array, centroids: (Float32Array | number[])[]): { best: number; extra: number | null; sim: number } {
  let best = -1;
  let bestSim = -1;
  let second = -1;
  let secondSim = -1;
  for (let i = 0; i < centroids.length; i++) {
    const sim = cosine(vector, centroids[i]!);
    if (sim > bestSim) {
      second = best;
      secondSim = bestSim;
      best = i;
      bestSim = sim;
    } else if (sim > secondSim) {
      second = i;
      secondSim = sim;
    }
  }
  return { best, extra: second >= 0 && secondSim >= bestSim - SECOND_LIST_DELTA ? second : null, sim: bestSim };
}

export interface LocalResult {
  proposal: Proposal;
  /** Centroids aligned with proposal.lists; Lists.applyProposal re-keys them by list id. */
  model: { centroids: number[][] };
}

export class LocalClassifier implements Classifier {
  constructor(
    private readonly embed: Embedder = workerEmbedder(),
    private readonly model: OrganizeModel | null = null,
  ) {}

  async organize(posts: Post[], seeds: string[], onProgress: (p: Progress) => void, signal: AbortSignal): Promise<Proposal> {
    return (await this.organizeWithModel(posts, seeds, onProgress, signal)).proposal;
  }

  async organizeWithModel(posts: Post[], seeds: string[], onProgress: (p: Progress) => void, signal: AbortSignal): Promise<LocalResult> {
    const texts = posts.map(postText);
    onProgress({ phase: "preparing", done: 0, total: posts.length });
    const stored = new Map((await loadVectors()).map((v) => [v.postId, v.vector]));
    const vectors: Float32Array[] = new Array(posts.length);
    const missing: number[] = [];
    posts.forEach((p, i) => {
      const v = stored.get(p.id);
      if (v) vectors[i] = Float32Array.from(v);
      else missing.push(i);
    });
    if (missing.length) {
      const fresh = await this.embed(
        missing.map((i) => texts[i]!),
        (done, _total, note) => onProgress({ phase: "embedding", done, total: missing.length, note }),
        signal,
      );
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      await putVectors(missing.map((i, j) => ({ postId: posts[i]!.id, vector: [...fresh[j]!] })));
      missing.forEach((i, j) => (vectors[i] = fresh[j]!));
    }

    onProgress({ phase: "discovering", done: 0, total: 1 });
    const initial = seeds.length ? await this.embed(seeds, () => {}, signal) : undefined;
    const k = Math.max(seeds.length, chooseK(posts.length));
    const { centroids, labels } = kmeans(vectors, k, { initial });
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    const clusterTexts: string[][] = centroids.map(() => []);
    labels.forEach((c, i) => clusterTexts[c]!.push(texts[i]!));
    const tfidf = nameClusters(clusterTexts, texts);
    const names = centroids.map((_, i) => (i < seeds.length ? seeds[i]! : tfidf[i]!));

    onProgress({ phase: "assigning", done: 0, total: posts.length });
    const lists = names.map((name) => ({ name, postIds: [] as string[] }));
    const unsorted: string[] = [];
    vectors.forEach((v, i) => {
      const { best, extra, sim } = nearest(v, centroids);
      if (best < 0 || sim < MIN_SIMILARITY) unsorted.push(posts[i]!.id);
      else {
        lists[best]!.postIds.push(posts[i]!.id);
        if (extra !== null) lists[extra]!.postIds.push(posts[i]!.id);
      }
      if (i % 500 === 0) onProgress({ phase: "assigning", done: i, total: posts.length });
    });
    onProgress({ phase: "assigning", done: posts.length, total: posts.length });
    const kept = lists.filter((l) => l.postIds.length || seeds.includes(l.name));
    return { proposal: { lists: kept, unsorted }, model: { centroids: centroids.map((c) => [...c]).filter((_, i) => kept.includes(lists[i]!)) } };
  }

  async assign(posts: Post[], lists: List[], signal: AbortSignal): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    const model = this.model;
    if (!model || !posts.length) return out;
    // Match stored centroids to current lists by id (renames keep working since ids are stable).
    const pairs = model.listIds.map((id, i) => ({ list: lists.find((l) => l.id === id), centroid: model.centroids[i]! })).filter((p) => p.list);
    if (!pairs.length) return out;
    const stored = new Map((await loadVectors()).map((v) => [v.postId, v.vector]));
    const missing = posts.filter((p) => !stored.has(p.id));
    const fresh = missing.length ? await this.embed(missing.map(postText), () => {}, signal) : [];
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (fresh.length) await putVectors(missing.map((p, i) => ({ postId: p.id, vector: [...fresh[i]!] })));
    const vectors = new Map(missing.map((p, i) => [p.id, fresh[i]!]));
    for (const p of posts) {
      const v = vectors.get(p.id) ?? Float32Array.from(stored.get(p.id)!);
      const { best, extra, sim } = nearest(v, pairs.map((x) => x.centroid));
      out.set(p.id, best < 0 || sim < MIN_SIMILARITY ? [] : extra === null ? [pairs[best]!.list!.name] : [pairs[best]!.list!.name, pairs[extra]!.list!.name]);
    }
    return out;
  }
}
