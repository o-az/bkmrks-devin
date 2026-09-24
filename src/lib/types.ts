export type MediaKind = "image" | "video" | "gif";

export interface Media {
  kind: MediaKind;
  /** Image URL, or poster frame for video/gif. */
  url: string;
  width: number;
  height: number;
  /** Best mp4 variant for video/gif. */
  video?: string;
  durationMs?: number;
  alt?: string;
}

export interface Author {
  name: string;
  handle: string;
  avatar?: string;
  verified: boolean;
}

export interface QuotedPost {
  id: string;
  author: Author;
  text: string;
  media: Media[];
}

export interface Post {
  id: string;
  /** X bookmark timeline sort key (decimal string); larger = bookmarked more recently. */
  sortIndex: string;
  author: Author;
  text: string;
  createdAt: number;
  replies: number | null;
  reposts: number | null;
  likes: number | null;
  bookmarks: number | null;
  views: number | null;
  media: Media[];
  quoted?: QuotedPost;
}

export interface PageResult {
  posts: Post[];
  cursor: string | null;
}

export interface Credentials {
  authToken: string;
  ct0: string;
}

export type ContentType = "text" | "image" | "video";
export type SortKey = "saved" | "posted" | "likes" | "reposts" | "replies" | "bookmarks" | "views";
export type SortDir = "desc" | "asc";
export type ViewMode = "list" | "gallery";
