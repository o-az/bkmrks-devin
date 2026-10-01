import type { ContentType, SortDir, SortKey, ViewMode } from "./types";

export interface Prefs {
  types: ContentType[];
  sort: SortKey;
  dir: SortDir;
  view: ViewMode;
  query: string;
  list: string | null;
  /** Whether the list chips row is expanded; null = decide by how many lists there are. */
  listsOpen: boolean | null;
}

const KEY = "bkmrks.prefs";
const SCROLL_KEY = "bkmrks.scroll";
const SORTS: SortKey[] = ["saved", "posted", "likes", "reposts", "replies", "bookmarks", "views"];
const TYPES: ContentType[] = ["text", "image", "video"];

export const DEFAULT_PREFS: Prefs = { types: [], sort: "saved", dir: "desc", view: "list", query: "", list: null, listsOpen: null };

export function loadPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      types: Array.isArray(v.types) ? v.types.filter((t: ContentType) => TYPES.includes(t)) : [],
      sort: SORTS.includes(v.sort) ? v.sort : "saved",
      dir: v.dir === "asc" ? "asc" : "desc",
      view: v.view === "gallery" ? "gallery" : "list",
      query: typeof v.query === "string" ? v.query : "",
      list: typeof v.list === "string" ? v.list : null,
      listsOpen: typeof v.listsOpen === "boolean" ? v.listsOpen : null,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Prefs): void {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}

export interface ScrollAnchor {
  /** Post at the top of the viewport. */
  id: string;
  /** Pixels scrolled past that post's top edge. */
  offset: number;
  view: ViewMode;
}

export function loadScroll(): ScrollAnchor | null {
  try {
    const v = JSON.parse(localStorage.getItem(SCROLL_KEY) ?? "null");
    return typeof v?.id === "string" && typeof v?.offset === "number" ? v : null;
  } catch {
    return null;
  }
}

export function saveScroll(anchor: ScrollAnchor | null): void {
  if (anchor) localStorage.setItem(SCROLL_KEY, JSON.stringify(anchor));
  else localStorage.removeItem(SCROLL_KEY);
}

export function clearPrefs(): void {
  localStorage.removeItem(KEY);
  localStorage.removeItem(SCROLL_KEY);
}
