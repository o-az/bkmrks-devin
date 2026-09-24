import { Fragment } from "react";

const TOKEN = /(https?:\/\/[^\s]+)|(@\w{1,15})|(#[\p{L}\p{N}_]+)/gu;

function displayUrl(url: string): string {
  const s = url.replace(/^https?:\/\/(www\.)?/, "");
  return s.length > 32 ? `${s.slice(0, 31)}…` : s;
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    const [token, url, mention, tag] = m;
    const href = url ?? (mention ? `https://x.com/${mention.slice(1)}` : `https://x.com/hashtag/${encodeURIComponent(tag!.slice(1))}`);
    parts.push(
      <a key={i} href={href} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
        {url ? displayUrl(url) : token}
      </a>,
    );
    last = i + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <p className={className}>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</p>;
}
