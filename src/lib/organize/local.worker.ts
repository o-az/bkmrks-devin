import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

let extractor: FeatureExtractionPipeline | null = null;

self.onmessage = async (e: MessageEvent<{ texts: string[] }>) => {
  const { texts } = e.data;
  try {
    extractor ??= await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" });
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
