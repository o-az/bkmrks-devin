import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { Assignment, List } from "../lib/lists";
import type { Post, SortKey, ViewMode } from "../lib/types";
import { loadScroll, saveScroll } from "../lib/prefs";
import { PostCard } from "./PostCard";
import { GalleryTile } from "./GalleryTile";

const GAP = 4;

function columnsFor(width: number): number {
  if (width >= 1100) return 5;
  if (width >= 760) return 4;
  if (width >= 420) return 3;
  return 2;
}

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

const NO_LISTS: List[] = [];
const NO_IDS: string[] = [];

interface FeedProps {
  posts: Post[];
  sort: SortKey;
  view: ViewMode;
  /** Changes whenever the filter/sort selection changes; resets scroll to top. */
  selectionKey: string;
  onOpen: (index: number) => void;
  lists?: List[];
  assignments?: Map<string, Assignment>;
  onEditLists?: (postId: string, listIds: string[]) => void;
  onCreateList?: (name: string) => Promise<List>;
}

export function Feed({ posts, sort, view, selectionKey, onOpen, lists = NO_LISTS, assignments, onEditLists, onCreateList }: FeedProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const cols = view === "gallery" ? columnsFor(width) : 1;
  const tile = cols > 1 ? (width - GAP * (cols - 1)) / cols : 0;
  const rows = Math.ceil(posts.length / cols);
  const [margin, setMargin] = useState(0);

  useLayoutEffect(() => {
    const update = () => setMargin(ref.current ? ref.current.getBoundingClientRect().top + window.scrollY : 0);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [view, width]);

  const virtualizer = useWindowVirtualizer({
    count: rows,
    estimateSize: () => (view === "gallery" ? tile + GAP : 420),
    overscan: view === "gallery" ? 4 : 3,
    scrollMargin: margin,
    getItemKey: (i) => (view === "gallery" ? `r${i}` : posts[i]!.id),
  });

  useEffect(() => {
    if (view === "gallery") virtualizer.measure();
  }, [tile, view, virtualizer]);

  // Restore the saved position once, then keep saving it as the user scrolls.
  const restored = useRef(false);
  const lastKey = useRef(selectionKey);
  useEffect(() => {
    if (restored.current || !posts.length || !width) return;
    restored.current = true;
    const anchor = loadScroll();
    if (!anchor) return;
    const index = posts.findIndex((p) => p.id === anchor.id);
    if (index < 0) return;
    const row = Math.floor(index / cols);
    virtualizer.scrollToIndex(row, { align: "start" });
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(row, { align: "start" });
      if (anchor.view === view) requestAnimationFrame(() => window.scrollBy(0, anchor.offset));
    });
  }, [posts, width, cols, view, virtualizer]);

  useEffect(() => {
    if (lastKey.current === selectionKey) return;
    lastKey.current = selectionKey;
    window.scrollTo(0, 0);
  }, [selectionKey]);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!restored.current) return;
        const y = window.scrollY;
        if (y <= virtualizer.options.scrollMargin) return saveScroll(null);
        const item = virtualizer.getVirtualItems().find((v) => v.end > y);
        const post = item ? posts[item.index * cols] : undefined;
        if (item && post) saveScroll({ id: post.id, offset: Math.round(y - item.start), view });
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [posts, cols, view, virtualizer]);

  const items = virtualizer.getVirtualItems();
  return (
    <div ref={ref} className={`feed ${view}`}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={view === "list" ? virtualizer.measureElement : undefined}
            className={view === "gallery" ? "row" : "cell"}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
              ...(view === "gallery" ? { height: tile, gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: GAP } : {}),
            }}
          >
            {view === "list" ? (
              <PostCard
                post={posts[item.index]!}
                sort={sort}
                lists={lists.length ? lists : undefined}
                postListIds={assignments?.get(posts[item.index]!.id)?.listIds ?? NO_IDS}
                onEditLists={onEditLists}
                onCreateList={onCreateList}
              />
            ) : (
              posts
                .slice(item.index * cols, item.index * cols + cols)
                .map((p, j) => <GalleryTile key={p.id} post={p} sort={sort} onOpen={() => onOpen(item.index * cols + j)} />)
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
