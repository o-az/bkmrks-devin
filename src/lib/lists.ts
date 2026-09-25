import { getMeta, loadAssignments, loadLists, putAssignments, putLists, setMeta } from "./db";
import type { OrganizeSettings, Proposal } from "./organize/types";
import type { Post } from "./types";

export interface List {
  id: string;
  name: string;
  createdAt: number;
}

export interface Assignment {
  postId: string;
  listIds: string[];
  source: "auto" | "manual";
}

export interface StoredVector {
  postId: string;
  vector: number[];
}

/** Virtual filter id for posts with no list; never a stored list. */
export const UNSORTED = "unsorted";

/** Local model: centroids aligned with listIds so renames keep working. */
export interface OrganizeModel {
  centroids: number[][];
  listIds: string[];
}

export interface ListsState {
  ready: boolean;
  lists: List[];
  assignments: Map<string, Assignment>;
  settings: OrganizeSettings | null;
  model: OrganizeModel | null;
}

interface Exported {
  lists: List[];
  assignments: Assignment[];
}

const newId = () => `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class Lists {
  private listeners = new Set<() => void>();
  state: ListsState = { ready: false, lists: [], assignments: new Map(), settings: null, model: null };

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = () => this.state;

  private set(patch: Partial<ListsState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  async load(): Promise<void> {
    const [lists, assignments, settings, model] = await Promise.all([
      loadLists(),
      loadAssignments(),
      getMeta<OrganizeSettings>("organize.settings"),
      getMeta<OrganizeModel>("organize.model"),
    ]);
    this.set({ ready: true, lists, assignments: new Map(assignments.map((a) => [a.postId, a])), settings: settings ?? null, model: model ?? null });
  }

  /** Replaces all lists and auto assignments with the proposal; manual assignments survive by list name. */
  async applyProposal(proposal: Proposal, model?: { centroids: number[][] }, keepManual = true): Promise<void> {
    const now = Date.now();
    const lists = proposal.lists.map((l) => ({ id: newId(), name: l.name, createdAt: now }));
    const idByName = new Map(lists.map((l) => [l.name, l.id]));

    const assignments = new Map<string, Assignment>();
    proposal.lists.forEach((l, i) => {
      for (const postId of l.postIds) {
        const a = assignments.get(postId) ?? { postId, listIds: [], source: "auto" as const };
        a.listIds.push(lists[i]!.id);
        assignments.set(postId, a);
      }
    });
    if (keepManual) {
      for (const a of this.state.assignments.values()) {
        if (a.source !== "manual") continue;
        const kept = a.listIds.map((id) => this.state.lists.find((l) => l.id === id)?.name).filter((n): n is string => !!n);
        const listIds = [...new Set(kept.map((n) => idByName.get(n)).filter((id): id is string => !!id))];
        if (!listIds.length) continue;
        const existing = assignments.get(a.postId);
        if (existing) existing.listIds = [...new Set([...existing.listIds, ...listIds])];
        else assignments.set(a.postId, { postId: a.postId, listIds, source: "manual" });
      }
    }

    const removeLists = this.state.lists.map((l) => l.id);
    const removeAssignments = [...this.state.assignments.keys()];
    await Promise.all([putLists(lists, removeLists), putAssignments([...assignments.values()], removeAssignments)]);
    const next: OrganizeModel | null = model ? { centroids: model.centroids, listIds: lists.map((l) => l.id) } : null;
    await setMeta("organize.model", next);
    this.set({ lists, assignments, model: next });
  }

  async setPostLists(postId: string, listIds: string[]): Promise<void> {
    const assignments = new Map(this.state.assignments);
    if (listIds.length) {
      const a: Assignment = { postId, listIds: [...new Set(listIds)], source: "manual" };
      assignments.set(postId, a);
      await putAssignments([a]);
    } else {
      assignments.delete(postId);
      await putAssignments([], [postId]);
    }
    this.set({ assignments });
  }

  /** Assigns posts to existing lists by name (incremental auto-sort after a sync). */
  async setAutoAssignments(byName: Map<string, string[]>): Promise<void> {
    const idByName = new Map(this.state.lists.map((l) => [l.name, l.id]));
    const assignments = new Map(this.state.assignments);
    const changed: Assignment[] = [];
    for (const [postId, names] of byName) {
      const listIds = [...new Set(names.map((n) => idByName.get(n)).filter((id): id is string => !!id))];
      if (!listIds.length) continue;
      const a: Assignment = { postId, listIds, source: "auto" };
      assignments.set(postId, a);
      changed.push(a);
    }
    if (!changed.length) return;
    await putAssignments(changed);
    this.set({ assignments });
  }

  async renameList(id: string, name: string): Promise<void> {
    const lists = this.state.lists.map((l) => (l.id === id ? { ...l, name } : l));
    await putLists(lists.filter((l) => l.id === id));
    this.set({ lists });
  }

  async deleteList(id: string): Promise<void> {
    const lists = this.state.lists.filter((l) => l.id !== id);
    const assignments = new Map(this.state.assignments);
    const changed: Assignment[] = [];
    const removed: string[] = [];
    for (const a of assignments.values()) {
      if (!a.listIds.includes(id)) continue;
      const listIds = a.listIds.filter((x) => x !== id);
      if (listIds.length) {
        const next = { ...a, listIds };
        assignments.set(a.postId, next);
        changed.push(next);
      } else {
        assignments.delete(a.postId);
        removed.push(a.postId);
      }
    }
    const model = this.state.model;
    const next = model ? { centroids: model.centroids.filter((_, i) => model.listIds[i] !== id), listIds: model.listIds.filter((x) => x !== id) } : null;
    await Promise.all([putLists([], [id]), putAssignments(changed, removed)]);
    if (model) await setMeta("organize.model", next);
    this.set({ lists, assignments, model: next });
  }

  async createList(name: string): Promise<List> {
    const list: List = { id: newId(), name, createdAt: Date.now() };
    await putLists([list]);
    this.set({ lists: [...this.state.lists, list] });
    return list;
  }

  exportJSON(): string {
    const out: Exported = { lists: this.state.lists, assignments: [...this.state.assignments.values()] };
    return JSON.stringify(out, null, 2);
  }

  async importJSON(text: string): Promise<void> {
    const data = JSON.parse(text) as Exported;
    if (!Array.isArray(data.lists) || !Array.isArray(data.assignments)) throw new Error("Not a lists export.");
    for (const l of data.lists) if (typeof l?.id !== "string" || typeof l?.name !== "string") throw new Error("Not a lists export.");
    const known = new Set(data.lists.map((l) => l.id));
    const assignments = new Map<string, Assignment>();
    for (const a of data.assignments) {
      if (typeof a?.postId !== "string" || !Array.isArray(a?.listIds)) continue;
      const listIds = a.listIds.filter((id): id is string => typeof id === "string" && known.has(id));
      if (listIds.length) assignments.set(a.postId, { postId: a.postId, listIds, source: a.source === "manual" ? "manual" : "auto" });
    }
    await Promise.all([
      putLists(data.lists.map((l) => ({ id: l.id, name: l.name, createdAt: typeof l.createdAt === "number" ? l.createdAt : Date.now() })), this.state.lists.map((l) => l.id)),
      putAssignments([...assignments.values()], [...this.state.assignments.keys()]),
      setMeta("organize.model", null),
    ]);
    this.set({ lists: data.lists, assignments, model: null });
  }

  async clear(): Promise<void> {
    await Promise.all([
      putLists([], this.state.lists.map((l) => l.id)),
      putAssignments([], [...this.state.assignments.keys()]),
      setMeta("organize.model", null),
      setMeta("organize.settings", null),
    ]);
    this.set({ lists: [], assignments: new Map(), settings: null, model: null });
  }

  async saveSettings(settings: OrganizeSettings): Promise<void> {
    await setMeta("organize.settings", settings);
    this.set({ settings });
  }

  /** Counts per list id plus UNSORTED for posts with no (or empty) assignment. */
  countByList(posts: Post[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const l of this.state.lists) counts[l.id] = 0;
    counts[UNSORTED] = 0;
    for (const p of posts) {
      const a = this.state.assignments.get(p.id);
      const valid = a?.listIds.filter((id) => counts[id] !== undefined) ?? [];
      if (!valid.length) counts[UNSORTED]!++;
      else for (const id of valid) counts[id]!++;
    }
    return counts;
  }
}
