import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

let extractor: FeatureExtractionPipeline | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function load(): Promise<FeatureExtractionPipeline> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
        dtype: "q8",
        progress_callback: (p: { status?: string; loaded?: number; total?: number; file?: string }) => {
          if (p.status === "progress") self.postMessage({ type: "download", loaded: p.loaded ?? 0, total: p.total ?? 0, file: p.file });
        },
      });
    } catch (err) {
      if (attempt >= 3)
        throw new Error(`Model download failed: ${err instanceof Error ? err.message : String(err)}. Check your connection and try again.`);
      self.postMessage({ type: "note", message: `Model download failed (attempt ${attempt}/3) — retrying…` });
      await sleep(1500 * attempt);
    }
  }
}

self.onmessage = async (e: MessageEvent<{ texts: string[] }>) => {
  const { texts } = e.data;
  try {
    extractor ??= await load();
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += 32) {
      const batch = texts.slice(i, i + 32);
      const out = await extractor(batch, { pooling: "mean", normalize: true });
      vectors.push(...(out.tolist() as number[][]));
      self.postMessage({ type: "progress", done: i + batch.length, total: texts.length });
    }
    self.postMessage({ type: "done", vectors });
  } catch (err) {
    self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
