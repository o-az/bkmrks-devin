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

/** Header values must be ISO-8859-1; pasted keys often carry invisible or non-ASCII characters. */
export function cleanKey(key: string): string {
  return key.replace(/^\s*bearer\s+/i, "").replace(/[^\x21-\x7e]/g, "");
}

export function cleanBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(new DOMException("Timed out", "TimeoutError")), ms);
  return ctrl.signal;
}

/** Provider-side content filters (e.g. Qwen upstreams) reject the whole request when one post trips them. */
const REFUSAL = /upstream_rejected_request|upstream provider rejected|data_inspection_failed|content[_ ](?:filter|policy|management)|inappropriate content|content_policy_violation/i;

async function failure(res: Response): Promise<Error> {
  const body = await res.text().catch(() => "");
  const detail = body.slice(0, 200);
  const suffix = detail ? `: ${detail}` : "";
  if (res.status === 400 && REFUSAL.test(body)) {
    const err = new Error(`Provider refused the content${suffix}`);
    err.name = "Refused";
    return err;
  }
  if (res.status === 401 || res.status === 403) {
    const err = new Error(`Provider rejected the API key (${res.status})${suffix}`);
    err.name = "Fatal";
    return err;
  }
  if (res.status === 404) return new Error(`Not found (404) — check the base URL and model name${suffix}`);
  if (res.status === 429 || res.status >= 500) return new Error(`Provider error ${res.status}${suffix}`);
  return new Error(`Request failed (${res.status})${suffix}`);
}

/** Turns a rejected fetch into a message that says what actually went wrong. */
export function describeFetchError(err: unknown, url: string): Error {
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  const raw = err instanceof Error ? err.message : String(err);
  if (err instanceof DOMException && err.name === "TimeoutError") {
    const timeout = new Error(`${host} didn't respond within 90 s.`);
    timeout.name = "Timeout";
    return timeout;
  }
  if (/invalid url|failed to parse url|not a valid url/i.test(raw)) return new Error(`Base URL isn't a valid URL: ${url}`);
  if (/ISO-8859-1|header/i.test(raw)) return new Error(`The API key contains characters that can't be sent in a header — re-enter it. (${raw})`);
  return new Error(
    `Couldn't reach ${host}: ${raw}. Check the base URL and your connection; if they're right, the provider may block requests from browsers (CORS).`,
  );
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/** Tolerant JSON extraction: strips ``` fences, then falls back to the outermost {…} span. */
export function parseJson(content: string): unknown {
  const stripped = content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new Error("Provider returned non-JSON");
  }
}

export interface ModelOption {
  id: string;
  name?: string;
}

const NON_CHAT_ID = /embed|tts|whisper|dall-e|imagen|moderation|rerank|transcri|realtime|sora/i;

interface RawModel {
  id?: unknown;
  name?: unknown;
  supported_endpoint_types?: unknown;
  architecture?: { output_modalities?: unknown };
}

/** Keeps models that can plausibly answer an OpenAI-style chat request with text. */
export function chatModels(data: unknown): ModelOption[] {
  const list = Array.isArray(data) ? data : Array.isArray((data as { data?: unknown })?.data) ? (data as { data: unknown[] }).data : [];
  const out: ModelOption[] = [];
  for (const m of list as RawModel[]) {
    if (typeof m?.id !== "string" || !m.id || NON_CHAT_ID.test(m.id)) continue;
    const endpoints = m.supported_endpoint_types;
    if (Array.isArray(endpoints) && endpoints.length && !endpoints.includes("openai")) continue;
    const outputs = m.architecture?.output_modalities;
    if (Array.isArray(outputs) && outputs.length && !outputs.includes("text")) continue;
    out.push({ id: m.id, name: typeof m.name === "string" && m.name !== m.id ? m.name : undefined });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export interface Skipped {
  /** Posts the provider's content filter refused. */
  refused: string[];
  /** Posts whose request kept failing or timing out. */
  failed: string[];
}

export class ByokClassifier implements Classifier {
  constructor(
    private readonly settings: OrganizeSettings,
    private readonly fetchFn: typeof fetch = (input, init) => globalThis.fetch(input, init),
  ) {}

  private get cfg() {
    const c = this.settings.byok;
    const cfg = c && { baseUrl: cleanBaseUrl(c.baseUrl), model: c.model.trim(), apiKey: cleanKey(c.apiKey) };
    if (!cfg?.baseUrl || !cfg.model || !cfg.apiKey) throw new Error("API provider isn't configured.");
    return cfg;
  }

  /** Some providers reject response_format; once we see that, stop sending it. */
  private noResponseFormat = false;
  /** Qwen-style `enable_thinking: false` cuts batch latency ~3×; dropped if the provider rejects the field. */
  private noThinkingFlag = false;

  private async request(messages: ChatMessage[], maxTokens: number, signal: AbortSignal): Promise<Response> {
    const { baseUrl, model, apiKey } = this.cfg;
    const url = `${baseUrl}/chat/completions`;
    try {
      return await this.fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0,
          max_tokens: maxTokens,
          ...(this.noResponseFormat ? {} : { response_format: { type: "json_object" } }),
          ...(this.noThinkingFlag ? {} : { enable_thinking: false }),
        }),
        signal: anySignal([signal, timeoutSignal(90_000)]),
      });
    } catch (err) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      throw describeFetchError(err, url);
    }
  }

  async listModels(signal: AbortSignal): Promise<ModelOption[]> {
    const { baseUrl, apiKey } = this.cfg;
    const url = `${baseUrl}/models`;
    let res: Response;
    try {
      res = await this.fetchFn(url, { headers: { authorization: `Bearer ${apiKey}` }, signal: anySignal([signal, timeoutSignal(20_000)]) });
    } catch (err) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      throw describeFetchError(err, url);
    }
    if (!res.ok) throw await failure(res);
    return chatModels(await res.json().catch(() => null));
  }

  /** One tiny request to confirm URL, model and key work and the reply parses like a real run. */
  async test(signal: AbortSignal): Promise<{ status: number; ms: number }> {
    const started = performance.now();
    await this.chat([{ role: "user", content: 'Reply with the JSON {"ok": true}.' }], 1500, signal);
    return { status: 200, ms: Math.round(performance.now() - started) };
  }

  private async send(messages: ChatMessage[], maxTokens: number, signal: AbortSignal): Promise<Response> {
    const res = await this.request(messages, maxTokens, signal);
    if (res.ok || res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) return res;
    if (this.noResponseFormat && this.noThinkingFlag) return res;
    const detail = await res.clone().text().catch(() => "");
    if (REFUSAL.test(detail)) return res;
    // Provider rejected an optional field → retry without it and remember.
    if (/thinking/i.test(detail) && !this.noThinkingFlag) this.noThinkingFlag = true;
    else {
      this.noResponseFormat = true;
      this.noThinkingFlag = true;
    }
    return this.request(messages, maxTokens, signal);
  }

  private async chat(messages: ChatMessage[], maxTokens: number, signal: AbortSignal): Promise<unknown> {
    const res = await this.send(messages, maxTokens, signal);
    if (!res.ok) throw await failure(res);
    const body = await res.json().catch(() => {
      throw new Error(`Provider returned a non-JSON response (${res.status}).`);
    });
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Empty response from provider.");
    return parseJson(content);
  }

  private async chatRetry(messages: ChatMessage[], maxTokens: number, signal: AbortSignal, onNote?: (note: string) => void): Promise<unknown> {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        return await this.chat(messages, maxTokens, signal);
      } catch (err) {
        const name = (err as Error).name;
        if (name === "Fatal" || name === "AbortError" || name === "Refused" || name === "Timeout") throw err;
        last = err;
        if (attempt < 2) onNote?.(`${(err as Error).message} — retrying (${attempt + 2}/3)…`);
        await sleep(500 * 2 ** attempt);
      }
    }
    throw last;
  }

  async organize(posts: Post[], seeds: string[], onProgress: (p: Progress) => void, signal: AbortSignal): Promise<Proposal> {
    void this.cfg;
    onProgress({ phase: "discovering", done: 0, total: 1 });
    const discovered = await this.discover(posts, seeds, onProgress, signal);
    const names = (discovered.categories ?? []).map((c) => c.name).filter((n): n is string => typeof n === "string" && !!n);
    for (const s of seeds) if (!names.includes(s)) names.push(s);
    if (!names.length) throw new Error("Provider returned no categories.");
    onProgress({ phase: "discovering", done: 1, total: 1 });

    const skipped: Skipped = { refused: [], failed: [] };
    const assignments = await this.assignBatches(posts, names, onProgress, signal, skipped);
    const lists = names.map((name) => ({ name, postIds: [] as string[] }));
    const unsorted: string[] = [];
    for (const p of posts) {
      const hits = assignments.get(p.id) ?? [];
      if (!hits.length) unsorted.push(p.id);
      for (const n of hits) lists[names.indexOf(n)]!.postIds.push(p.id);
    }
    return { lists: lists.filter((l) => l.postIds.length || seeds.includes(l.name)), unsorted, skipped };
  }

  /** A sample containing a refused post fails as a whole, so retry with smaller, different samples. */
  private async discover(posts: Post[], seeds: string[], onProgress: (p: Progress) => void, signal: AbortSignal) {
    let size = 120;
    for (let attempt = 0; ; attempt++) {
      const rand = rng(42 + attempt);
      const sample = [...posts].sort(() => rand() - 0.5).slice(0, size);
      try {
        return await this.discoverFrom(sample, seeds, onProgress, signal);
      } catch (err) {
        if ((err as Error).name !== "Refused" || attempt >= 3) throw err;
        size = Math.max(15, Math.floor(size / 2));
        onProgress({ phase: "discovering", done: 0, total: 1, note: "Provider refused some posts — retrying with a different sample…" });
      }
    }
  }

  private async discoverFrom(sample: Post[], seeds: string[], onProgress: (p: Progress) => void, signal: AbortSignal) {
    return (await this.chatRetry(
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
            sample.map((p, i) => `${i + 1}. ${postText(p).slice(0, 280)}`).join("\n") +
            (seeds.length ? `\n\nThese categories must be included verbatim: ${seeds.join(", ")}` : ""),
        },
      ],
      1500,
      signal,
      (note) => onProgress({ phase: "discovering", done: 0, total: 1, note }),
    )) as { categories?: { name: string; description?: string }[] };
  }

  async assign(posts: Post[], lists: List[], signal: AbortSignal): Promise<Map<string, string[]>> {
    void this.cfg;
    const names = lists.map((l) => l.name);
    if (!names.length || !posts.length) return new Map();
    return this.assignBatches(posts, names, () => {}, signal, { refused: [], failed: [] });
  }

  private async assignBatches(
    posts: Post[],
    names: string[],
    onProgress: (p: Progress) => void,
    signal: AbortSignal,
    skipped: Skipped,
  ): Promise<Map<string, string[]>> {
    const catalog = names.map((n, i) => `${i}. ${n}`).join("\n");
    const batches: Post[][] = [];
    for (let i = 0; i < posts.length; i += BATCH) batches.push(posts.slice(i, i + BATCH));
    const out = new Map<string, string[]>();
    let done = 0;
    let cursor = 0;

    // Refusals and timeouts are split in half until the offending posts are isolated.
    const run = async (batch: Post[]): Promise<void> => {
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
          2000,
          signal,
          (note) => onProgress({ phase: "assigning", done, total: posts.length, note }),
        )) as { assignments?: Record<string, number[]> };
        const map = parsed?.assignments ?? {};
        for (const p of batch) {
          const idxs = Array.isArray(map[p.id]) ? map[p.id]! : [];
          out.set(p.id, [...new Set(idxs.filter((i) => Number.isInteger(i) && names[i]).map((i) => names[i]!))].slice(0, 2));
        }
      } catch (err) {
        const name = (err as Error).name;
        if (name === "AbortError" || name === "Fatal") throw err;
        if ((name === "Refused" || name === "Timeout") && batch.length > 1) {
          const half = Math.ceil(batch.length / 2);
          await run(batch.slice(0, half));
          await run(batch.slice(half));
          return;
        }
        // Don't abort the run: these posts stay unsorted.
        for (const p of batch) out.set(p.id, []);
        (name === "Refused" ? skipped.refused : skipped.failed).push(...batch.map((p) => p.id));
      }
    };

    const worker = async () => {
      while (cursor < batches.length) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        const batch = batches[cursor++]!;
        await run(batch);
        done += batch.length;
        onProgress({ phase: "assigning", done, total: posts.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
    return out;
  }
}
