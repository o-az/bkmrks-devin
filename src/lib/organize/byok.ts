import type { List } from "../lists";
import type { Post } from "../types";
import { rng } from "./cluster";
import { postText } from "./text";
import type { Classifier, OrganizeSettings, Progress, Proposal } from "./types";

export const BYOK_PRESETS = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.1-8b-instant" },
  custom: { label: "Custom", baseUrl: "", model: "" },
} as const;

const BATCH = 25;
const CONCURRENCY = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export class ByokClassifier implements Classifier {
  constructor(
    private readonly settings: OrganizeSettings,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  private get cfg() {
    const c = this.settings.byok;
    if (!c?.baseUrl || !c.model || !c.apiKey) throw new Error("API provider isn't configured.");
    return c;
  }

  private async chat(messages: ChatMessage[], signal: AbortSignal): Promise<unknown> {
    const { baseUrl, model, apiKey } = this.cfg;
    const res = await this.fetchFn(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0, response_format: { type: "json_object" } }),
      signal,
    });
    if (res.status === 401 || res.status === 403) {
      const err = new Error(`Provider rejected the API key (${res.status}).`);
      err.name = "Fatal";
      throw err;
    }
    if (res.status === 429 || res.status >= 500) throw new Error(`Provider error ${res.status}.`);
    if (!res.ok) throw new Error(`Request failed (${res.status}).`);
    const body = await res.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Empty response from provider.");
    return JSON.parse(content);
  }

  private async chatRetry(messages: ChatMessage[], signal: AbortSignal): Promise<unknown> {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        return await this.chat(messages, signal);
      } catch (err) {
        if ((err as Error).name === "Fatal" || (err as Error).name === "AbortError") throw err;
        last = err;
        await sleep(500 * 2 ** attempt);
      }
    }
    throw last;
  }

  async organize(posts: Post[], seeds: string[], onProgress: (p: Progress) => void, signal: AbortSignal): Promise<Proposal> {
    onProgress({ phase: "discovering", done: 0, total: 1 });
    const rand = rng(42);
    const sample = [...posts].sort(() => rand() - 0.5).slice(0, 300);
    const discovered = (await this.chatRetry(
      [
        {
          role: "system",
          content:
            'You organize saved posts into categories. Reply with JSON: { "categories": [{ "name", "description" }] }. ' +
            "Pick 8-15 categories, names ≤25 chars in title case, description one line.",
        },
        {
          role: "user",
          content:
            `Here are ${sample.length} sampled posts:\n\n` +
            sample.map((p, i) => `${i + 1}. ${postText(p)}`).join("\n") +
            (seeds.length ? `\n\nThese categories must be included verbatim: ${seeds.join(", ")}` : ""),
        },
      ],
      signal,
    )) as { categories?: { name: string; description?: string }[] };
    const names = (discovered.categories ?? []).map((c) => c.name).filter((n): n is string => typeof n === "string" && !!n);
    for (const s of seeds) if (!names.includes(s)) names.push(s);
    if (!names.length) throw new Error("Provider returned no categories.");
    onProgress({ phase: "discovering", done: 1, total: 1 });

    const assignments = await this.assignBatches(posts, names, onProgress, signal);
    const lists = names.map((name) => ({ name, postIds: [] as string[] }));
    const unsorted: string[] = [];
    for (const p of posts) {
      const hits = assignments.get(p.id) ?? [];
      if (!hits.length) unsorted.push(p.id);
      for (const n of hits) lists[names.indexOf(n)]!.postIds.push(p.id);
    }
    return { lists: lists.filter((l) => l.postIds.length || seeds.includes(l.name)), unsorted };
  }

  async assign(posts: Post[], lists: List[], signal: AbortSignal): Promise<Map<string, string[]>> {
    const names = lists.map((l) => l.name);
    if (!names.length || !posts.length) return new Map();
    return this.assignBatches(posts, names, () => {}, signal);
  }

  private async assignBatches(posts: Post[], names: string[], onProgress: (p: Progress) => void, signal: AbortSignal): Promise<Map<string, string[]>> {
    const catalog = names.map((n, i) => `${i}. ${n}`).join("\n");
    const batches: Post[][] = [];
    for (let i = 0; i < posts.length; i += BATCH) batches.push(posts.slice(i, i + BATCH));
    const out = new Map<string, string[]>();
    let done = 0;
    let cursor = 0;

    const worker = async () => {
      while (cursor < batches.length) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        const batch = batches[cursor++]!;
        try {
          const parsed = (await this.chatRetry(
            [
              {
                role: "system",
                content:
                  'Assign each post to 1-2 categories by index, or an empty array if none fits. Reply with JSON: { "assignments": { "<postId>": [indices] } }.',
              },
              { role: "user", content: `Categories:\n${catalog}\n\nPosts:\n` + batch.map((p) => `${p.id}: ${postText(p)}`).join("\n") },
            ],
            signal,
          )) as { assignments?: Record<string, number[]> };
          const map = parsed?.assignments ?? {};
          for (const p of batch) {
            const idxs = Array.isArray(map[p.id]) ? map[p.id]! : [];
            out.set(p.id, [...new Set(idxs.filter((i) => Number.isInteger(i) && names[i]).map((i) => names[i]!))].slice(0, 2));
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") throw err;
          for (const p of batch) out.set(p.id, []); // failed batch → unsorted, don't abort the run
        }
        done += batch.length;
        onProgress({ phase: "assigning", done, total: posts.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
    return out;
  }
}
