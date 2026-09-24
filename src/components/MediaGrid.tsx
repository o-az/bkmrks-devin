import type { Media } from "../lib/types";
import { formatDuration } from "../lib/format";

export function thumb(url: string, size: "small" | "medium" | "large" = "medium"): string {
  const u = new URL(url);
  u.searchParams.set("name", size);
  return u.href;
}

function MediaItem({ media, single }: { media: Media; single: boolean }) {
  const style = single ? { aspectRatio: `${media.width} / ${media.height}` } : undefined;
  if (media.kind === "image")
    return <img src={thumb(media.url, single ? "large" : "medium")} alt={media.alt ?? ""} loading="lazy" style={style} />;
  return (
    <div className="media-video" style={style}>
      <video
        src={media.video}
        poster={thumb(media.url, "medium")}
        controls={media.kind === "video"}
        autoPlay={media.kind === "gif"}
        loop={media.kind === "gif"}
        muted={media.kind === "gif"}
        playsInline
        preload="none"
        onClick={(e) => e.stopPropagation()}
      />
      {media.kind === "gif" ? <span className="badge">GIF</span> : null}
      {media.kind === "video" && media.durationMs ? <span className="badge">{formatDuration(media.durationMs)}</span> : null}
    </div>
  );
}

export function MediaGrid({ media }: { media: Media[] }) {
  if (!media.length) return null;
  return (
    <div className={`media-grid n${Math.min(media.length, 4)}`}>
      {media.slice(0, 4).map((m, i) => (
        <MediaItem key={i} media={m} single={media.length === 1} />
      ))}
    </div>
  );
}
