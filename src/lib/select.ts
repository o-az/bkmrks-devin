import { UNSORTED, type Assignment } from "./lists";
import type { ContentType, Post, SortDir, SortKey } from "./types";

export function contentTypes(post: Post): Set<ContentType> {
  const types = new Set<ContentType>();
  const media = [...post.media, ...(post.quoted?.media ?? [])];
  if (media.length === 0) types.add("text");
  for (const m of media) types.add(m.kind === "image" ? "image" : "video");
  return types;
}

export function countTypes(posts: Post[]): Record<ContentType, number> {
  const counts = { text: 0, image: 0, video: 0 };
  for (const p of posts) for (const t of contentTypes(p)) counts[t]++;
  return counts;
}

export function compareSortIndex(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

function metric(post: Post, key: Exclude<SortKey, "saved">): number | null {
  return key === "posted" ? post.createdAt || null : post[key];
}

export interface Selection {
  types: ContentType[];
  query: string;
  sort: SortKey;
  dir: SortDir;
  /** List id, UNSORTED, or null for the whole feed. */
  list: string | null;
}

/** Filter (types OR'd, search terms AND'd) then sort; posts missing the sort metric always go last. */
export function selectPosts(posts: Post[], { types, query, sort, dir, list }: Selection, assignments: Map<string, Assignment> = new Map()): Post[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const wanted = new Set(types);
  const filtered = posts.filter((p) => {
    if (list === UNSORTED ? (assignments.get(p.id)?.listIds.length ?? 0) > 0 : list !== null && !assignments.get(p.id)?.listIds.includes(list)) return false;
    if (wanted.size && ![...contentTypes(p)].some((t) => wanted.has(t))) return false;
    if (!terms.length) return true;
    const hay = `${p.text} ${p.author.name} @${p.author.handle} ${p.quoted?.text ?? ""} ${p.quoted?.author.handle ?? ""}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const sign = dir === "asc" ? 1 : -1;
  if (sort === "saved") return filtered.sort((a, b) => sign * compareSortIndex(a.sortIndex, b.sortIndex));
  return filtered.sort((a, b) => {
    const x = metric(a, sort);
    const y = metric(b, sort);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return sign * (x - y) || -compareSortIndex(a.sortIndex, b.sortIndex);
  });
}
