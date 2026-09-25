import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAll, loadPosts, putPosts } from "../src/lib/db";
import { Lists, UNSORTED } from "../src/lib/lists";
import type { Proposal } from "../src/lib/organize/types";
import { post } from "./fixtures";

beforeEach(async () => {
  await clearAll();
});

const fresh = async () => {
  const lists = new Lists();
  await lists.load();
  return lists;
};

describe("Lists", () => {
  it("creates, renames and deletes lists", async () => {
    const lists = await fresh();
    const l = await lists.createList("Tech");
    expect(lists.state.lists).toHaveLength(1);
    await lists.renameList(l.id, "Technology");
    expect(lists.state.lists[0]!.name).toBe("Technology");
    await lists.setPostLists("p1", [l.id]);
    await lists.deleteList(l.id);
    expect(lists.state.lists).toHaveLength(0);
    expect(lists.state.assignments.get("p1")).toBeUndefined();
  });

  it("setPostLists marks assignments manual", async () => {
    const lists = await fresh();
    const l = await lists.createList("A");
    await lists.setPostLists("p1", [l.id]);
    expect(lists.state.assignments.get("p1")).toMatchObject({ listIds: [l.id], source: "manual" });
    await lists.setPostLists("p1", []);
    expect(lists.state.assignments.has("p1")).toBe(false);
  });

  it("applyProposal keeps manual assignments whose list name survives", async () => {
    const lists = await fresh();
    const keep = await lists.createList("Keep");
    const drop = await lists.createList("Drop");
    await lists.setPostLists("p1", [keep.id]);
    await lists.setPostLists("p2", [drop.id]);
    await lists.setPostLists("p3", [keep.id, drop.id]);

    const proposal: Proposal = { lists: [{ name: "Keep", postIds: ["a1", "a2"] }, { name: "New", postIds: ["a2"] }], unsorted: ["u1"] };
    await lists.applyProposal(proposal);
    expect(lists.state.lists.map((l) => l.name).sort()).toEqual(["Keep", "New"]);
    const newKeep = lists.state.lists.find((l) => l.name === "Keep")!;
    expect(lists.state.assignments.get("p1")).toMatchObject({ listIds: [newKeep.id], source: "manual" });
    expect(lists.state.assignments.has("p2")).toBe(false); // its list didn't survive
    expect(lists.state.assignments.get("p3")).toMatchObject({ listIds: [newKeep.id], source: "manual" });
    expect(lists.state.assignments.get("a2")!.listIds).toHaveLength(2);
  });

  it("export → import round-trips lists and assignments", async () => {
    const lists = await fresh();
    const a = await lists.createList("A");
    await lists.setPostLists("p1", [a.id]);
    const json = lists.exportJSON();

    const other = new Lists();
    await other.load();
    await other.createList("Stale");
    await other.importJSON(json);
    expect(other.state.lists.map((l) => l.name)).toEqual(["A"]);
    expect(other.state.assignments.get("p1")!.listIds).toEqual([a.id]);
    expect(other.state.lists[0]!.id).toBe(a.id);
  });

  it("rejects malformed imports and clears everything", async () => {
    const lists = await fresh();
    await lists.createList("A");
    await expect(lists.importJSON("{}")).rejects.toThrow();
    await lists.clear();
    expect(lists.state.lists).toHaveLength(0);
    expect(lists.state.assignments.size).toBe(0);
  });

  it("countByList reports per-list and unsorted counts", async () => {
    const lists = await fresh();
    const a = await lists.createList("A");
    await lists.setPostLists("p1", [a.id]);
    const posts = [post({ id: "p1" }), post({ id: "p2" })];
    const counts = lists.countByList(posts);
    expect(counts[a.id]).toBe(1);
    expect(counts[UNSORTED]).toBe(1);
  });

  it("upgrades a version-1 database without losing posts", async () => {
    // Simulate a v1 DB: fresh fake-indexeddb connection at version 1 with posts.
    const req = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("v1db", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("posts", { keyPath: "id" });
        r.result.createObjectStore("meta");
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const p = post({ id: "legacy" });
    await new Promise<void>((resolve, reject) => {
      const tx = req.transaction("posts", "readwrite");
      tx.objectStore("posts").put(p);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    req.close();
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("v1db", 2);
      r.onupgradeneeded = () => {
        for (const s of ["lists", "assignments", "vectors"]) r.result.createObjectStore(s, { keyPath: s === "lists" ? "id" : "postId" });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const kept = await new Promise((resolve) => {
      const r = upgraded.transaction("posts").objectStore("posts").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    expect(upgraded.objectStoreNames.contains("lists")).toBe(true);
    expect(kept).toEqual([p]);
    upgraded.close();
  });

  it("keeps real posts when the app's DB upgrades to v2", async () => {
    // clearAll + putPosts via the app's own db module, then reload through Lists.
    await putPosts([post({ id: "kept" })]);
    expect((await loadPosts()).map((p) => p.id)).toEqual(["kept"]);
    const lists = await fresh();
    expect(lists.state.ready).toBe(true);
    expect((await loadPosts()).map((p) => p.id)).toEqual(["kept"]);
  });
});
