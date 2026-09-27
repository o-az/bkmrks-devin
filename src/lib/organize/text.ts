import type { Post } from "../types";

/** Flatten a post into a short classifier input: author, text, quoted text, media markers. */
export function postText(post: Post): string {
  const parts: string[] = [`${post.author.name} @${post.author.handle}:`];
  if (post.text) parts.push(post.text);
  for (const m of post.media) {
    if (m.kind === "video" || m.kind === "gif") parts.push("[video]");
    else parts.push("[image]");
    if (m.alt) parts.push(m.alt);
  }
  if (post.quoted) {
    if (post.quoted.text) parts.push(post.quoted.text);
    for (const m of post.quoted.media) parts.push(m.kind === "image" ? "[image]" : "[video]");
  }
  return parts
    .join(" ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

/** Whitespace-collapsed one-line excerpt ending on a word boundary with an ellipsis. */
export function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  const end = space > max * 0.6 ? space : cut.length;
  return `${cut.slice(0, end).trimEnd()}…`;
}
