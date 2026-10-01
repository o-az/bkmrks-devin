import type { List } from "../lists";
import type { Post } from "../types";

export interface OrganizeSettings {
  provider: "local" | "byok";
  /** Optional user-provided category names. */
  seeds: string[];
  /** Skip the review screen. */
  autoApply: boolean;
  byok?: { baseUrl: string; model: string; apiKey: string };
}

export interface ProposedList {
  name: string;
  postIds: string[];
}

export interface Proposal {
  lists: ProposedList[];
  unsorted: string[];
  /** Posts left unsorted because the provider refused or failed them (API provider only). */
  skipped?: { refused: string[]; failed: string[] };
}

export interface Progress {
  phase: "preparing" | "embedding" | "discovering" | "assigning";
  done: number;
  total: number;
  /** Transient detail, e.g. "Provider error 502 — retrying (2/3)…". */
  note?: string;
}

export interface Classifier {
  organize(posts: Post[], seeds: string[], onProgress: (p: Progress) => void, signal: AbortSignal): Promise<Proposal>;
  /** Assign new posts to existing lists (by name); returns postId -> list names ([] = unsorted). */
  assign(posts: Post[], lists: List[], signal: AbortSignal): Promise<Map<string, string[]>>;
}
