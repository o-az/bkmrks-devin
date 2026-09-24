import { memo } from "react";
import type { Post, SortKey } from "../lib/types";
import { formatCount, formatDate, formatDuration } from "../lib/format";
import { Icon, type IconName } from "./Icon";
import { thumb } from "./MediaGrid";

const SORT_ICON: Record<SortKey, IconName> = {
  saved: "bookmark",
  posted: "calendar",
  likes: "heart",
  reposts: "repost",
  replies: "reply",
  bookmarks: "bookmark",
  views: "eye",
};

export function sortBadge(post: Post, sort: SortKey): string | null {
  if (sort === "saved") return null;
  if (sort === "posted") return formatDate(post.createdAt);
  return formatCount(post[sort]);
}

export const GalleryTile = memo(function GalleryTile({ post, sort, onOpen }: { post: Post; sort: SortKey; onOpen: () => void }) {
  const first = post.media[0];
  const badge = sortBadge(post, sort);
  return (
    <button className="tile" onClick={onOpen} aria-label={`Open post by @${post.author.handle}`}>
      {first ? (
        <img src={thumb(first.url, "small")} alt={first.alt ?? ""} loading="lazy" decoding="async" />
      ) : (
        <div className="tile-text">
          <span className="tile-author">@{post.author.handle}</span>
          <span className="tile-body">{post.text || post.quoted?.text}</span>
        </div>
      )}
      <span className="tile-corner">
        {first?.kind === "video" ? (
          <span className="pill">
            <Icon name="play" size={12} fill />
            {first.durationMs ? formatDuration(first.durationMs) : null}
          </span>
        ) : null}
        {first?.kind === "gif" ? <span className="pill">GIF</span> : null}
        {post.media.length > 1 ? (
          <span className="pill">
            <Icon name="layers" size={12} />
            {post.media.length}
          </span>
        ) : null}
      </span>
      {badge ? (
        <span className="tile-stat">
          <Icon name={SORT_ICON[sort]} size={12} />
          {badge}
        </span>
      ) : null}
    </button>
  );
});
