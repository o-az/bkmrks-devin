import type { List, OrganizeModel } from "../lists";
import type { Post } from "../types";
import { ByokClassifier } from "./byok";
import { LocalClassifier } from "./local";
import type { OrganizeSettings, Progress, Proposal } from "./types";

export interface OrganizeResult {
  proposal: Proposal;
  /** Local-backend centroids to persist via Lists.applyProposal; undefined for byok. */
  model?: { centroids: number[][] };
}

export function makeClassifier(settings: OrganizeSettings, model: OrganizeModel | null) {
  return settings.provider === "byok" ? new ByokClassifier(settings) : new LocalClassifier(undefined, model);
}

export async function runOrganize(
  settings: OrganizeSettings,
  posts: Post[],
  { onProgress, signal }: { onProgress: (p: Progress) => void; signal: AbortSignal },
): Promise<OrganizeResult> {
  if (settings.provider === "byok") return { proposal: await new ByokClassifier(settings).organize(posts, settings.seeds, onProgress, signal) };
  const local = new LocalClassifier();
  const { proposal, model } = await local.organizeWithModel(posts, settings.seeds, onProgress, signal);
  return { proposal, model };
}

/** Assign posts to existing lists; returns postId -> list names ([] = unsorted). */
export async function assignNew(settings: OrganizeSettings, posts: Post[], lists: List[], model: OrganizeModel | null, signal?: AbortSignal): Promise<Map<string, string[]>> {
  const classifier = settings.provider === "byok" ? new ByokClassifier(settings) : new LocalClassifier(undefined, model);
  return classifier.assign(posts, lists, signal ?? new AbortController().signal);
}
