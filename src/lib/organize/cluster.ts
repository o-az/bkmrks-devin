/** Seeded RNG (mulberry32) so clustering and sampling are testable. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cosine(a: Float32Array, b: Float32Array): number {
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

export function chooseK(n: number): number {
  return Math.min(15, Math.max(4, Math.round(Math.sqrt(n / 2))));
}

/** Cosine k-means over normalized vectors with k-means++ init. Returns centroids + cluster index per vector. */
export function kmeans(
  vectors: Float32Array[],
  k: number,
  { iterations = 25, seed = 1, initial }: { iterations?: number; seed?: number; initial?: Float32Array[] } = {},
): { centroids: Float32Array[]; labels: number[] } {
  const n = vectors.length;
  k = Math.min(k, n);
  const rand = rng(seed);
  const centroids: Float32Array[] = [];

  // Fixed initial centroids first (seeds), then k-means++ for the rest.
  for (const v of initial ?? []) if (centroids.length < k) centroids.push(Float32Array.from(v));
  if (!centroids.length) centroids.push(Float32Array.from(vectors[Math.floor(rand() * n)]!));
  while (centroids.length < k) {
    const d2 = vectors.map((v) => 1 - Math.max(...centroids.map((c) => cosine(v, c))));
    let total = d2.reduce((a, b) => a + Math.max(b, 0), 0);
    let pick = rand() * total;
    let idx = n - 1;
    for (let i = 0; i < n; i++) {
      pick -= Math.max(d2[i]!, 0);
      if (pick <= 0) {
        idx = i;
        break;
      }
    }
    centroids.push(Float32Array.from(vectors[idx]!));
  }

  const labels = new Array<number>(n).fill(0);
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestSim = -1;
      for (let c = 0; c < k; c++) {
        const sim = cosine(vectors[i]!, centroids[c]!);
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      }
      if (labels[i] !== best) {
        labels[i] = best;
        moved = true;
      }
    }
    const sums = centroids.map(() => new Float32Array(vectors[0]!.length));
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) {
      counts[labels[i]!]!++;
      for (let d = 0; d < sums[labels[i]!]!.length; d++) sums[labels[i]!]![d]! += vectors[i]![d]!;
    }
    for (let c = 0; c < k; c++) {
      if (!counts[c]) continue;
      for (let d = 0; d < sums[c]!.length; d++) centroids[c]![d] = sums[c]![d]! / counts[c]!;
    }
    if (!moved) break;
  }
  return { centroids, labels };
}

const STOPWORDS = new Set(
  (
    "a about above after again against all am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves rt http https amp just like get got new one will now via see make"
  ).split(/\s+/),
);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/@\w+/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .match(/[a-z0-9]{3,}/g)
    ?.filter((t) => !STOPWORDS.has(t)) ?? [];
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Names each cluster by its top tf-idf terms, e.g. "Llm · Agents". */
export function nameClusters(clusterTexts: string[][], allTexts: string[]): string[] {
  const docs = allTexts.map(tokens);
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = Math.max(docs.length, 1);
  return clusterTexts.map((texts, ci) => {
    const tfidf = new Map<string, number>();
    for (const t of texts.flatMap(tokens)) {
      const idf = Math.log(n / (1 + (df.get(t) ?? 0))) + 1;
      tfidf.set(t, (tfidf.get(t) ?? 0) + idf);
    }
    const top = [...tfidf.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t);
    let name = top.length ? titleCase(top.join(" · ")) : `List ${ci + 1}`;
    while (name.length > 25 && top.length > 1) {
      top.pop();
      name = titleCase(top.join(" · "));
    }
    return name.length > 25 ? name.slice(0, 25).trimEnd() : name;
  });
}
