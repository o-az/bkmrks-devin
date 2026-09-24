import { useEffect } from "react";
import type { Post, SortKey } from "../lib/types";
import { Icon } from "./Icon";
import { PostCard } from "./PostCard";

interface ViewerProps {
  posts: Post[];
  index: number;
  sort: SortKey;
  onIndex: (index: number | null) => void;
}

export function Viewer({ posts, index, sort, onIndex }: ViewerProps) {
  const post = posts[index];
  const prev = index > 0 ? () => onIndex(index - 1) : undefined;
  const next = index < posts.length - 1 ? () => onIndex(index + 1) : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onIndex(null);
      else if (e.key === "ArrowLeft") prev?.();
      else if (e.key === "ArrowRight") next?.();
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("locked");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("locked");
    };
  });

  if (!post) return null;
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Post" onClick={() => onIndex(null)}>
      <button className="viewer-close icon-btn" onClick={() => onIndex(null)} aria-label="Close">
        <Icon name="close" />
      </button>
      <button className="viewer-nav left icon-btn" disabled={!prev} onClick={(e) => (e.stopPropagation(), prev?.())} aria-label="Previous">
        <Icon name="left" size={22} />
      </button>
      <div className="viewer-body" onClick={(e) => e.stopPropagation()}>
        <PostCard key={post.id} post={post} sort={sort} />
        <div className="viewer-count">
          {index + 1} / {posts.length}
        </div>
      </div>
      <button className="viewer-nav right icon-btn" disabled={!next} onClick={(e) => (e.stopPropagation(), next?.())} aria-label="Next">
        <Icon name="right" size={22} />
      </button>
    </div>
  );
}
