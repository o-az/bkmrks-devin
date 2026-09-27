import { describe, expect, it } from "vitest";
import { UNSORTED, type Assignment } from "../src/lib/lists";
import { countTypes, selectPosts, type Selection } from "../src/lib/select";
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
const sel = (over: Partial<Selection> = {}): Selection => ({ types: [], query: "", sort: "saved", dir: "desc", list: null, ...over });

describe("selectPosts", () => {
  it("sorts by bookmark order numerically, both ways", () => {
    expect(ids(selectPosts(all, sel()))).toEqual(ids([photo, text, clip, anim]));
    expect(ids(selectPosts(all, sel({ dir: "asc" })))).toEqual(ids([anim, clip, text, photo]));
  });

  it("sorts by metrics with unknown values last in either direction", () => {
    expect(ids(selectPosts(all, sel({ sort: "likes" })))).toEqual(ids([photo, text, anim, clip]));
    expect(ids(selectPosts(all, sel({ sort: "likes", dir: "asc" })))).toEqual(ids([anim, text, photo, clip]));
    expect(ids(selectPosts(all, sel({ sort: "replies" })))).toEqual(ids([text, clip, photo, anim]));
  });

  it("ORs content types; gifs count as video", () => {
    expect(ids(selectPosts(all, sel({ types: ["video"] })))).toEqual(ids([clip, anim]));
    expect(ids(selectPosts(all, sel({ types: ["text", "image"] })))).toEqual(ids([photo, text, anim]));
    expect(countTypes(all)).toEqual({ text: 1, image: 2, video: 2 });
  });

  it("searches text and handles", () => {
    expect(ids(selectPosts(all, sel({ query: "WORLD hello" })))).toEqual([text.id]);
    expect(selectPosts(all, sel({ query: "@a" }))).toHaveLength(4);
  });

  it("filters by list and UNSORTED", () => {
    const assignments = new Map<string, Assignment>([
      [text.id, { postId: text.id, listIds: ["l1"], source: "auto" }],
      [photo.id, { postId: photo.id, listIds: ["l1", "l2"], source: "manual" }],
      [clip.id, { postId: clip.id, listIds: [], source: "auto" }],
    ]);
    expect(ids(selectPosts(all, sel({ list: "l1" }), assignments))).toEqual(ids([photo, text]));
    expect(ids(selectPosts(all, sel({ list: "l2" }), assignments))).toEqual([photo.id]);
    expect(ids(selectPosts(all, sel({ list: UNSORTED }), assignments))).toEqual(ids([clip, anim]));
    expect(ids(selectPosts(all, sel(), assignments))).toEqual(ids([photo, text, clip, anim]));
  });

  it("does not mutate the input", () => {
    const copy = [...all];
    selectPosts(all, sel({ sort: "likes", dir: "asc" }));
    expect(all).toEqual(copy);
  });
});
