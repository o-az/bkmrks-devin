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

async function failure(res: Response): Promise<Error> {
  const detail = (await res.text().catch(() => "")).slice(0, 200);
  const suffix = detail ? `: ${detail}` : "";
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
  if (err instanceof DOMException && err.name === "TimeoutError") return new Error(`${host} didn't respond within 90 s.`);
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
        }),
        signal: anySignal([signal, timeoutSignal(90_000)]),
      });
    } catch (err) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      throw describeFetchError(err, url);
    }
  }

  /** One tiny request to confirm URL, model and key work. */
  async test(signal: AbortSignal): Promise<{ status: number; ms: number }> {
    const started = performance.now();
    const res = await this.send([{ role: "user", content: 'Reply with the JSON {"ok": true}.' }], 16, signal);
    if (!res.ok) throw await failure(res);
    return { status: res.status, ms: Math.round(performance.now() - started) };
  }

  private async send(messages: ChatMessage[], maxTokens: number, signal: AbortSignal): Promise<Response> {
    const res = await this.request(messages, maxTokens, signal);
    // Provider doesn't accept response_format → retry once without it and remember.
    if (!res.ok && res.status !== 401 && res.status !== 403 && res.status !== 429 && res.status < 500 && !this.noResponseFormat) {
      this.noResponseFormat = true;
      return this.request(messages, maxTokens, signal);
    }
    return res;
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
        if ((err as Error).name === "Fatal" || (err as Error).name === "AbortError") throw err;
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
    const rand = rng(42);
    const sample = [...posts].sort(() => rand() - 0.5).slice(0, 120);
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
            sample.map((p, i) => `${i + 1}. ${postText(p).slice(0, 280)}`).join("\n") +
            (seeds.length ? `\n\nThese categories must be included verbatim: ${seeds.join(", ")}` : ""),
        },
      ],
      1500,
      signal,
      (note) => onProgress({ phase: "discovering", done: 0, total: 1, note }),
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
    void this.cfg;
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
