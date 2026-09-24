import type { Post } from "../src/lib/types";

let n = 0;
export function post(over: Partial<Post> = {}): Post {
  n++;
  return {
    id: String(1000 + n),
    sortIndex: String(9_000_000 - n),
    author: { name: "A", handle: "a", verified: false },
    text: `post ${n}`,
    createdAt: 1_700_000_000_000 + n,
    replies: 0,
    reposts: 0,
    likes: 0,
    bookmarks: 0,
    views: 0,
    media: [],
    ...over,
  };
}

export function rawTweet(id: string, opts: { media?: unknown[]; text?: string; likes?: number; quoted?: unknown; wrap?: boolean } = {}) {
  const tweet = {
    __typename: "Tweet",
    rest_id: id,
    core: { user_results: { result: { core: { name: "Ada", screen_name: "ada" }, avatar: { image_url: "https://pbs.twimg.com/profile_images/1/a.jpg" }, is_blue_verified: true } } },
    views: { count: "1234" },
    legacy: {
      created_at: "Wed Oct 10 20:19:24 +0000 2018",
      full_text: opts.text ?? "hello &amp; world https://t.co/abc",
      favorite_count: opts.likes ?? 10,
      retweet_count: 2,
      reply_count: 3,
      bookmark_count: 4,
      entities: { urls: [], media: opts.media ?? [] },
      extended_entities: opts.media ? { media: opts.media } : undefined,
    },
    quoted_status_result: opts.quoted ? { result: opts.quoted } : undefined,
  };
  return opts.wrap ? { __typename: "TweetWithVisibilityResults", tweet } : tweet;
}

export function entry(tweet: unknown, sortIndex: string) {
  return { entryId: `tweet-${sortIndex}`, sortIndex, content: { itemContent: { tweet_results: { result: tweet } } } };
}

export function timeline(entries: unknown[], cursor: string | null, key = "bookmark_timeline_v2") {
  const all = [...entries];
  if (cursor) all.push({ entryId: "cursor-bottom", content: { cursorType: "Bottom", value: cursor } });
  return { data: { [key]: { timeline: { instructions: [{ type: "TimelineAddEntries", entries: all }] } } } };
}
