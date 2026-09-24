import type { Author, Media, PageResult, Post, QuotedPost } from "./types";

// X GraphQL payloads are untyped JSON; this module is the only place that walks them.

export class UnrecognizedResponse extends Error {}

/** Reads a nested property path from untyped JSON, returning undefined on any miss. */
function at(value: unknown, ...path: (string | number)[]): unknown {
  let cur = value;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function safeUrl(v: unknown, hosts: string[]): string | undefined {
  if (typeof v !== "string") return undefined;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && hosts.includes(u.hostname) ? u.href : undefined;
  } catch {
    return undefined;
  }
}

export function parseBookmarksPage(payload: unknown): PageResult {
  const instructions =
    at(payload, "data", "bookmark_timeline_v2", "timeline", "instructions") ??
    at(payload, "data", "bookmark_timeline", "timeline", "instructions");
  if (!Array.isArray(instructions)) throw new UnrecognizedResponse("Unrecognized bookmarks response");

  const posts: Post[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;

  for (const instruction of instructions) {
    const single = at(instruction, "entry");
    const entries = single ? [single] : list(at(instruction, "entries"));
    for (const entry of entries) {
      const content = at(entry, "content");
      const cursorValue = at(content, "value");
      if (at(content, "cursorType") === "Bottom" && typeof cursorValue === "string") {
        cursor = cursorValue;
        continue;
      }
      const moduleItems = at(content, "items");
      const items = Array.isArray(moduleItems)
        ? moduleItems.map((i) => ({ sortIndex: at(i, "sortIndex") ?? at(entry, "sortIndex"), content: at(i, "item", "itemContent") }))
        : [{ sortIndex: at(entry, "sortIndex"), content: at(content, "itemContent") }];
      for (const item of items) {
        const post = parseTweet(at(item.content, "tweet_results", "result"), item.sortIndex);
        if (post && !seen.has(post.id)) {
          seen.add(post.id);
          posts.push(post);
        }
      }
    }
  }
  return { posts, cursor };
}

function unwrap(tweet: unknown): unknown {
  return at(tweet, "__typename") === "TweetWithVisibilityResults" ? at(tweet, "tweet") : tweet;
}

function parseAuthor(tweet: unknown): Author {
  const user = at(tweet, "core", "user_results", "result");
  return {
    name: str(at(user, "core", "name")) ?? str(at(user, "legacy", "name")) ?? "Unknown",
    handle: str(at(user, "core", "screen_name")) ?? str(at(user, "legacy", "screen_name")) ?? "unknown",
    avatar: safeUrl(at(user, "avatar", "image_url") ?? at(user, "legacy", "profile_image_url_https"), ["pbs.twimg.com", "abs.twimg.com"]),
    verified: at(user, "is_blue_verified") === true || at(user, "legacy", "verified") === true,
  };
}

function mediaEntities(legacy: unknown): unknown[] {
  return list(at(legacy, "extended_entities", "media") ?? at(legacy, "entities", "media"));
}

function parseMedia(legacy: unknown): Media[] {
  const out: Media[] = [];
  for (const m of mediaEntities(legacy)) {
    const url = safeUrl(at(m, "media_url_https"), ["pbs.twimg.com"]);
    if (!url) continue;
    const type = at(m, "type");
    const kind = type === "video" ? "video" : type === "animated_gif" ? "gif" : "image";
    const width = num(at(m, "original_info", "width")) ?? num(at(m, "sizes", "large", "w")) ?? 1;
    const height = num(at(m, "original_info", "height")) ?? num(at(m, "sizes", "large", "h")) ?? 1;
    const media: Media = { kind, url, width, height };
    const alt = str(at(m, "ext_alt_text"));
    if (alt) media.alt = alt;
    if (kind !== "image") {
      const variants = list(at(m, "video_info", "variants"))
        .filter((v) => at(v, "content_type") === "video/mp4")
        .sort((a, b) => (num(at(b, "bitrate")) ?? 0) - (num(at(a, "bitrate")) ?? 0));
      const video = safeUrl(at(variants[0], "url"), ["video.twimg.com"]);
      if (video) media.video = video;
      const duration = num(at(m, "video_info", "duration_millis"));
      if (duration) media.durationMs = duration;
    }
    out.push(media);
  }
  return out;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

function parseText(tweet: unknown, legacy: unknown): string {
  const note = at(tweet, "note_tweet", "note_tweet_results", "result");
  let text = str(at(note, "text")) ?? str(at(legacy, "full_text")) ?? "";
  for (const u of list(at(note, "entity_set", "urls") ?? at(legacy, "entities", "urls"))) {
    const short = str(at(u, "url"));
    const expanded = str(at(u, "expanded_url"));
    if (short && expanded) text = text.split(short).join(expanded);
  }
  for (const m of mediaEntities(legacy)) {
    const short = str(at(m, "url"));
    if (short) text = text.split(short).join("");
  }
  const quotedUrl = str(at(legacy, "quoted_status_permalink", "expanded"));
  if (quotedUrl) text = text.split(quotedUrl).join("");
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e] ?? e).trim();
}

function restId(tweet: unknown): string | undefined {
  const id = at(tweet, "rest_id");
  return typeof id === "string" && /^\d+$/.test(id) ? id : undefined;
}

function parseQuoted(tweet: unknown): QuotedPost | undefined {
  const q = unwrap(at(tweet, "quoted_status_result", "result"));
  const legacy = at(q, "legacy");
  const id = restId(q);
  if (!legacy || !id) return undefined;
  return { id, author: parseAuthor(q), text: parseText(q, legacy), media: parseMedia(legacy) };
}

export function parseTweet(raw: unknown, sortIndex: unknown): Post | null {
  const tweet = unwrap(raw);
  const legacy = at(tweet, "legacy");
  const id = restId(tweet);
  if (!legacy || !id) return null;
  const createdAt = Date.parse(String(at(legacy, "created_at")));
  const views = at(tweet, "views", "count");
  return {
    id,
    sortIndex: typeof sortIndex === "string" && /^\d+$/.test(sortIndex) ? sortIndex : "0",
    author: parseAuthor(tweet),
    text: parseText(tweet, legacy),
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
    replies: num(at(legacy, "reply_count")),
    reposts: num(at(legacy, "retweet_count")),
    likes: num(at(legacy, "favorite_count")),
    bookmarks: num(at(legacy, "bookmark_count")),
    views: typeof views === "string" && /^\d+$/.test(views) ? Number(views) : num(views),
    media: parseMedia(legacy),
    quoted: parseQuoted(tweet),
  };
}
