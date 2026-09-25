import { parseBookmarksPage, UnrecognizedResponse } from "../src/lib/parse.js";

// Public bearer used by x.com's own web client; not a user credential.
const BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const METADATA_URL =
  "https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json";
const FALLBACK_QUERY_ID = "XD0ViOeSOW4YoeNTGjVaYw";
const PAGE_SIZE = 100;
const TOKEN_RE = /^[A-Za-z0-9]{20,256}$/;

interface Operation {
  queryId: string;
  features: Record<string, boolean>;
}

let operation: Operation | null = null;
let operationExpires = 0;

async function getOperation(refresh: boolean): Promise<Operation> {
  if (!refresh && operation && Date.now() < operationExpires) return operation;
  try {
    const res = await fetch(METADATA_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(String(res.status));
    const value = (await res.json())?.Bookmarks;
    if (typeof value?.queryId !== "string" || !/^[A-Za-z0-9_-]{10,100}$/.test(value.queryId)) throw new Error("metadata");
    const features = Object.fromEntries(
      Object.entries(value.features ?? {}).filter(([, v]) => typeof v === "boolean"),
    ) as Record<string, boolean>;
    operation = { queryId: value.queryId, features };
    operationExpires = Date.now() + 60 * 60 * 1000;
  } catch {
    operation ??= { queryId: FALLBACK_QUERY_ID, features: {} };
    operationExpires = Date.now() + 5 * 60 * 1000;
  }
  return operation;
}

async function requestPage(authToken: string, ct0: string, cursor: string | null, refresh: boolean) {
  const { queryId, features } = await getOperation(refresh);
  const url = new URL(`https://x.com/i/api/graphql/${queryId}/Bookmarks`);
  url.searchParams.set(
    "variables",
    JSON.stringify({ count: PAGE_SIZE, includePromotedContent: false, ...(cursor ? { cursor } : {}) }),
  );
  url.searchParams.set("features", JSON.stringify(features));
  return fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: {
      authorization: `Bearer ${BEARER}`,
      cookie: `auth_token=${authToken}; ct0=${ct0}`,
      "x-csrf-token": ct0,
      "x-twitter-active-user": "yes",
      "x-twitter-auth-type": "OAuth2Session",
      "x-twitter-client-language": "en",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      origin: "https://x.com",
      referer: "https://x.com/i/bookmarks",
      accept: "application/json",
    },
  });
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

/** POST { authToken, ct0, cursor? } → { posts, cursor } for one page of bookmarks. */
export async function handleBookmarks(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method" }, { allow: "POST" });
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return json(403, { error: "origin" });
  if (!req.headers.get("content-type")?.includes("application/json")) return json(415, { error: "content-type" });

  let body: { authToken?: unknown; ct0?: unknown; cursor?: unknown };
  try {
    const text = await req.text();
    if (text.length > 8192) return json(413, { error: "too-large" });
    body = JSON.parse(text);
  } catch {
    return json(400, { error: "bad-json" });
  }
  const { authToken, ct0, cursor } = body;
  if (typeof authToken !== "string" || typeof ct0 !== "string" || !TOKEN_RE.test(authToken) || !TOKEN_RE.test(ct0))
    return json(400, { error: "bad-credentials", message: "auth_token and ct0 look malformed." });
  if (cursor != null && (typeof cursor !== "string" || cursor.length > 1024)) return json(400, { error: "bad-cursor" });

  try {
    let res = await requestPage(authToken, ct0, (cursor as string | null) ?? null, false);
    if (res.status === 404 || res.status === 422 || res.status === 400) {
      res = await requestPage(authToken, ct0, (cursor as string | null) ?? null, true);
    }
    const reset = Number(res.headers.get("x-rate-limit-reset")) || null;
    const remaining = Number(res.headers.get("x-rate-limit-remaining"));
    if (res.status === 429) return json(429, { error: "rate-limited", reset });
    if (res.status === 401 || res.status === 403)
      return json(401, { error: "unauthorized", message: "X rejected these cookies. Log in to x.com again and copy fresh values." });
    if (!res.ok) return json(502, { error: "upstream", message: `X responded with ${res.status}.` });
    const payload = await res.json();
    if (payload?.errors?.length && !payload?.data) {
      const code = payload.errors[0]?.code;
      if (code === 32 || code === 89 || code === 353)
        return json(401, { error: "unauthorized", message: "X rejected these cookies. Log in to x.com again and copy fresh values." });
      return json(502, { error: "upstream", message: "X returned an error for this request." });
    }
    const page = parseBookmarksPage(payload);
    return json(200, { ...page, rate: { remaining: Number.isFinite(remaining) ? remaining : null, reset } });
  } catch (err) {
    if (err instanceof UnrecognizedResponse)
      return json(502, { error: "upstream", message: "X changed its response format. The app needs an update." });
    return json(502, { error: "upstream", message: "Couldn't reach X. Try again in a moment." });
  }
}
