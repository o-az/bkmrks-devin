import type { PageResult, Post } from "./types";

const TOPICS = [
  { tag: "ai", texts: ["New LLM release crushes reasoning benchmarks", "Agents are the future of software", "Prompt engineering tips thread", "Fine-tuning embeddings for search", "Multimodal models can now watch video"] },
  { tag: "crypto", texts: ["Bitcoin hits a new all time high", "Ethereum rollup fees drop again", "Stablecoin regulation draft leaks", "On-chain analytics thread on whale wallets", "Airdrop farming guide"] },
  { tag: "cooking", texts: ["The perfect sourdough hydration ratio", "Cast iron seasoning deep dive", "15 minute weeknight pasta recipe", "Fermenting hot sauce at home", "Knife skills every cook needs"] },
  { tag: "fitness", texts: ["Progressive overload explained simply", "Zone 2 cardio and longevity", "The science of creatine", "Mobility routine for desk workers", "How much protein do you really need"] },
  { tag: "football", texts: ["Tactical breakdown of the derby", "Transfer window rumor roundup", "The rise of inverted fullbacks", "Penalty shootout psychology", "Youth academy prospects to watch"] },
];

const AUTHORS = [
  { name: "Ada Byte", handle: "adabyte", verified: true },
  { name: "Satoshi Fan", handle: "satf", verified: false },
  { name: "Chef Rosa", handle: "chefrosa", verified: true },
  { name: "Gym Bro", handle: "gymbro", verified: false },
  { name: "Footy Tactics", handle: "footytac", verified: true },
];

/** Deterministic ~120 posts across 5 obvious topics, served in 3 pages. */
export function mockPosts(): Post[] {
  const posts: Post[] = [];
  for (let i = 0; i < 120; i++) {
    const t = TOPICS[i % TOPICS.length]!;
    const author = AUTHORS[i % AUTHORS.length]!;
    const text = t.texts[Math.floor(i / TOPICS.length) % t.texts.length]!;
    posts.push({
      id: `m${10000 + i}`,
      sortIndex: String(9_000_000 - i),
      author,
      text: `${text} ${"#" + t.tag}`,
      createdAt: 1_700_000_000_000 + i * 3_600_000,
      replies: (i * 7) % 200,
      reposts: (i * 13) % 2000,
      likes: (i * 31) % 20000,
      bookmarks: (i * 3) % 500,
      views: (i * 101) % 500000,
      media: i % 7 === 0 ? [{ kind: "image", url: `https://picsum.photos/seed/${i}/600/400`, width: 600, height: 400 }] : [],
    });
  }
  return posts;
}

const PAGES = (() => {
  const all = mockPosts();
  return [all.slice(0, 40), all.slice(40, 80), all.slice(80)];
})();

export const mockFetchPage = async (_creds: unknown, cursor: string | null): Promise<PageResult> => {
  const page = cursor === null ? 0 : Number(cursor);
  return { posts: PAGES[page] ?? [], cursor: page + 1 < PAGES.length ? String(page + 1) : null };
};
