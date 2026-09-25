import { memo } from "react";
import type { Author, Post, SortKey } from "../lib/types";
import { formatCount, formatDate, postUrl } from "../lib/format";
import { Icon, type IconName } from "./Icon";
import { MediaGrid } from "./MediaGrid";
import { RichText } from "./RichText";

const METRICS: { key: "replies" | "reposts" | "likes" | "bookmarks" | "views"; icon: IconName; label: string }[] = [
  { key: "replies", icon: "reply", label: "Replies" },
  { key: "reposts", icon: "repost", label: "Reposts" },
  { key: "likes", icon: "heart", label: "Likes" },
  { key: "bookmarks", icon: "bookmark", label: "Bookmarks" },
  { key: "views", icon: "eye", label: "Views" },
];

function Byline({ author, createdAt, id, small }: { author: Author; createdAt?: number; id: string; small?: boolean }) {
  return (
    <div className={`byline${small ? " small" : ""}`}>
      {author.avatar ? <img className="avatar" src={author.avatar} alt="" loading="lazy" /> : <span className="avatar" />}
      <a className="who" href={`https://x.com/${author.handle}`} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
        <span className="name">{author.name}</span>
        <span className="handle">@{author.handle}</span>
      </a>
      <a className="date" href={postUrl(author.handle, id)} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
        {createdAt ? formatDate(createdAt) : <Icon name="external" size={14} />}
      </a>
    </div>
  );
}

export const PostCard = memo(function PostCard({ post, sort }: { post: Post; sort: SortKey }) {
  return (
    <article className="card">
      <Byline author={post.author} createdAt={post.createdAt} id={post.id} />
      {post.text ? <RichText text={post.text} className="text" /> : null}
      <MediaGrid media={post.media} />
      {post.quoted ? (
        <div className="quote">
          <Byline author={post.quoted.author} id={post.quoted.id} small />
          {post.quoted.text ? <RichText text={post.quoted.text} className="text" /> : null}
          <MediaGrid media={post.quoted.media} />
        </div>
      ) : null}
      <footer className="metrics">
        {METRICS.map((m) => (
          <span key={m.key} className={`metric${sort === m.key ? " active" : ""}`} title={`${m.label}: ${post[m.key]?.toLocaleString() ?? "unknown"}`}>
            <Icon name={m.icon} size={16} />
            {formatCount(post[m.key])}
          </span>
        ))}
        <a className="metric open" href={postUrl(post.author.handle, post.id)} target="_blank" rel="noreferrer noopener" title="Open on X">
          <Icon name="external" size={16} />
        </a>
      </footer>
    </article>
  );
});
