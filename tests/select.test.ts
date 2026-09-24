import { describe, expect, it } from "vitest";
import { countTypes, selectPosts } from "../src/lib/select";
import type { Media } from "../src/lib/types";
import { post } from "./fixtures";

const img: Media = { kind: "image", url: "https://pbs.twimg.com/a.jpg", width: 1, height: 1 };
const vid: Media = { kind: "video", url: "https://pbs.twimg.com/b.jpg", width: 1, height: 1 };
const gif: Media = { ...vid, kind: "gif" };

const text = post({ sortIndex: "30", likes: 5, replies: 9, text: "hello world" });
const photo = post({ sortIndex: "100", likes: 50, replies: 1, media: [img] });
const clip = post({ sortIndex: "20", likes: null, replies: 4, media: [vid] });
const anim = post({ sortIndex: "9", likes: 1, replies: 0, media: [gif, img] });
const all = [text, photo, clip, anim];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("selectPosts", () => {
  it("sorts by bookmark order numerically, both ways", () => {
    expect(ids(selectPosts(all, { types: [], query: "", sort: "saved", dir: "desc" }))).toEqual(ids([photo, text, clip, anim]));
    expect(ids(selectPosts(all, { types: [], query: "", sort: "saved", dir: "asc" }))).toEqual(ids([anim, clip, text, photo]));
  });

  it("sorts by metrics with unknown values last in either direction", () => {
    expect(ids(selectPosts(all, { types: [], query: "", sort: "likes", dir: "desc" }))).toEqual(ids([photo, text, anim, clip]));
    expect(ids(selectPosts(all, { types: [], query: "", sort: "likes", dir: "asc" }))).toEqual(ids([anim, text, photo, clip]));
    expect(ids(selectPosts(all, { types: [], query: "", sort: "replies", dir: "desc" }))).toEqual(ids([text, clip, photo, anim]));
  });

  it("ORs content types; gifs count as video", () => {
    expect(ids(selectPosts(all, { types: ["video"], query: "", sort: "saved", dir: "desc" }))).toEqual(ids([clip, anim]));
    expect(ids(selectPosts(all, { types: ["text", "image"], query: "", sort: "saved", dir: "desc" }))).toEqual(ids([photo, text, anim]));
    expect(countTypes(all)).toEqual({ text: 1, image: 2, video: 2 });
  });

  it("searches text and handles", () => {
    expect(ids(selectPosts(all, { types: [], query: "WORLD hello", sort: "saved", dir: "desc" }))).toEqual([text.id]);
    expect(selectPosts(all, { types: [], query: "@a", sort: "saved", dir: "desc" })).toHaveLength(4);
  });

  it("does not mutate the input", () => {
    const copy = [...all];
    selectPosts(all, { types: [], query: "", sort: "likes", dir: "asc" });
    expect(all).toEqual(copy);
  });
});
