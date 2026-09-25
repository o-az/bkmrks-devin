import type { ContentType, SortKey } from "../lib/types";
import type { Prefs } from "../lib/prefs";
import { Icon, type IconName } from "./Icon";

const TYPES: { key: ContentType; label: string; icon: IconName }[] = [
  { key: "text", label: "Text", icon: "text" },
  { key: "image", label: "Images", icon: "image" },
  { key: "video", label: "Videos", icon: "video" },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "saved", label: "Date bookmarked" },
  { key: "posted", label: "Date posted" },
  { key: "likes", label: "Likes" },
  { key: "reposts", label: "Reposts" },
  { key: "replies", label: "Replies" },
  { key: "bookmarks", label: "Bookmarks" },
  { key: "views", label: "Views" },
];

export function dirLabel(sort: SortKey, dir: Prefs["dir"]): string {
  if (sort === "saved" || sort === "posted") return dir === "desc" ? "Newest first" : "Oldest first";
  return dir === "desc" ? "Most first" : "Fewest first";
}

interface ToolbarProps {
  prefs: Prefs;
  counts: Record<ContentType, number>;
  total: number;
  lists: { id: string; name: string }[];
  listCounts: Record<string, number>;
  onChange: (patch: Partial<Prefs>) => void;
}

export function Toolbar({ prefs, counts, total, lists, listCounts, onChange }: ToolbarProps) {
  const toggle = (t: ContentType) =>
    onChange({ types: prefs.types.includes(t) ? prefs.types.filter((x) => x !== t) : [...prefs.types, t] });
  return (
    <div className="toolbar">
      <label className="search">
        <Icon name="search" size={16} />
        <input
          type="search"
          placeholder="Search text or @author"
          value={prefs.query}
          onChange={(e) => onChange({ query: e.target.value })}
          aria-label="Search bookmarks"
        />
      </label>
      <div className="controls">
        <div className="chips" role="group" aria-label="Content type">
          <button className="chip" aria-pressed={prefs.types.length === 0} onClick={() => onChange({ types: [] })}>
            All <span className="count">{total}</span>
          </button>
          {TYPES.map((t) => (
            <button key={t.key} className="chip" aria-pressed={prefs.types.includes(t.key)} onClick={() => toggle(t.key)}>
              <Icon name={t.icon} size={15} />
              {t.label} <span className="count">{counts[t.key]}</span>
            </button>
          ))}
        </div>
        {lists.length > 0 && (
          <div className="chips lists" role="group" aria-label="Lists">
            <button className="chip" aria-pressed={prefs.list === null} onClick={() => onChange({ list: null })}>
              All <span className="count">{total}</span>
            </button>
            {[...lists]
              .sort((a, b) => (listCounts[b.id] ?? 0) - (listCounts[a.id] ?? 0))
              .map((l) => (
                <button key={l.id} className="chip" aria-pressed={prefs.list === l.id} onClick={() => onChange({ list: l.id })}>
                  <Icon name="folder" size={14} />
                  {l.name} <span className="count">{listCounts[l.id] ?? 0}</span>
                </button>
              ))}
            {(listCounts.unsorted ?? 0) > 0 && (
              <button className="chip" aria-pressed={prefs.list === "unsorted"} onClick={() => onChange({ list: "unsorted" })}>
                Unsorted <span className="count">{listCounts.unsorted}</span>
              </button>
            )}
          </div>
        )}
        <div className="sorting">
          <label className="select">
            <span className="sr-only">Sort by</span>
            <select value={prefs.sort} onChange={(e) => onChange({ sort: e.target.value as SortKey })}>
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="chip dir"
            onClick={() => onChange({ dir: prefs.dir === "desc" ? "asc" : "desc" })}
            title="Reverse order"
          >
            <Icon name={prefs.dir === "desc" ? "arrowDown" : "arrowUp"} size={15} />
            {dirLabel(prefs.sort, prefs.dir)}
          </button>
          <div className="segmented" role="group" aria-label="Layout">
            <button aria-pressed={prefs.view === "list"} onClick={() => onChange({ view: "list" })} title="Cards" aria-label="Cards">
              <Icon name="list" size={16} />
            </button>
            <button aria-pressed={prefs.view === "gallery"} onClick={() => onChange({ view: "gallery" })} title="Gallery" aria-label="Gallery">
              <Icon name="grid" size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
