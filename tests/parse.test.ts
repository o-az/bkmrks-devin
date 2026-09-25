import { describe, expect, it } from "vitest";
import { parseBookmarksPage, UnrecognizedResponse } from "../src/lib/parse";
import { entry, rawTweet, timeline } from "./fixtures";

const photo = { type: "photo", url: "https://t.co/abc", media_url_https: "https://pbs.twimg.com/media/p.jpg", original_info: { width: 800, height: 600 } };
const video = {
  type: "video",
  media_url_https: "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/v.jpg",
  original_info: { width: 1280, height: 720 },
  video_info: {
    duration_millis: 61000,
    variants: [
      { content_type: "application/x-mpegURL", url: "https://video.twimg.com/v.m3u8" },
      { content_type: "video/mp4", bitrate: 256000, url: "https://video.twimg.com/low.mp4" },
      { content_type: "video/mp4", bitrate: 2176000, url: "https://video.twimg.com/high.mp4" },
    ],
  },
};

describe("parseBookmarksPage", () => {
  it("parses posts, metrics, media and the bottom cursor", () => {
    const page = parseBookmarksPage(
      timeline([entry(rawTweet("1", { media: [photo] }), "300"), entry(rawTweet("2", { media: [video], wrap: true }), "200")], "CURSOR"),
    );
    expect(page.cursor).toBe("CURSOR");
    expect(page.posts.map((p) => p.id)).toEqual(["1", "2"]);
    const [a, b] = page.posts;
    expect(a).toMatchObject({ sortIndex: "300", text: "hello & world", likes: 10, reposts: 2, replies: 3, bookmarks: 4, views: 1234 });
    expect(a!.author).toMatchObject({ name: "Ada", handle: "ada", verified: true });
    expect(a!.media).toEqual([{ kind: "image", url: "https://pbs.twimg.com/media/p.jpg", width: 800, height: 600 }]);
    expect(b!.media[0]).toMatchObject({ kind: "video", video: "https://video.twimg.com/high.mp4", durationMs: 61000 });
  });

  it("accepts the legacy timeline key, dedupes and parses quotes", () => {
    const quoted = rawTweet("9", { text: "inner" });
    const page = parseBookmarksPage(timeline([entry(rawTweet("1", { quoted }), "2"), entry(rawTweet("1"), "1")], null, "bookmark_timeline"));
    expect(page.posts).toHaveLength(1);
    expect(page.posts[0]!.quoted).toMatchObject({ id: "9", text: "inner" });
    expect(page.cursor).toBeNull();
  });

  it("drops media from untrusted hosts", () => {
    const evil = { ...photo, media_url_https: "https://evil.example/p.jpg" };
    expect(parseBookmarksPage(timeline([entry(rawTweet("1", { media: [evil] }), "1")], null)).posts[0]!.media).toEqual([]);
  });

  it("rejects unknown shapes", () => {
    expect(() => parseBookmarksPage({ data: {} })).toThrow(UnrecognizedResponse);
  });
});
