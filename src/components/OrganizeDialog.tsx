import { useEffect, useRef, useState } from "react";
import { Lists } from "../lib/lists";
import { BYOK_PRESETS } from "../lib/organize/byok";
import { runOrganize } from "../lib/organize/run";
import type { OrganizeSettings, Progress, Proposal, ProposedList } from "../lib/organize/types";
import type { Post } from "../lib/types";
import { Icon } from "./Icon";

interface OrganizeDialogProps {
  posts: Post[];
  lists: Lists;
  onClose: () => void;
}

type Step = "setup" | "running" | "review" | "done";

const PHASE_LABELS: Record<Progress["phase"], string> = {
  preparing: "Preparing posts",
  embedding: "Embedding posts (first run downloads a 23 MB model)",
  discovering: "Discovering categories",
  assigning: "Assigning posts to lists",
};

export function OrganizeDialog({ posts, lists, onClose }: OrganizeDialogProps) {
  const [step, setStep] = useState<Step>("setup");
  const [progress, setProgress] = useState<Progress>({ phase: "preparing", done: 0, total: 1 });
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ProposedList[]>([]);
  const [unsorted, setUnsorted] = useState<string[]>([]);
  const model = useRef<{ centroids: number[][] } | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);

  const saved = lists.getState().settings;
  const [provider, setProvider] = useState<"local" | "byok">(saved?.provider ?? "local");
  const [preset, setPreset] = useState<keyof typeof BYOK_PRESETS>("openai");
  const [baseUrl, setBaseUrl] = useState(saved?.byok?.baseUrl ?? BYOK_PRESETS.openai.baseUrl);
  const [modelName, setModelName] = useState(saved?.byok?.model ?? BYOK_PRESETS.openai.model);
  const [apiKey, setApiKey] = useState(saved?.byok?.apiKey ?? "");
  const [rememberKey, setRememberKey] = useState(!!saved?.byok?.apiKey);
  const [seeds, setSeeds] = useState((saved?.seeds ?? []).join("\n"));
  const [autoApply, setAutoApply] = useState(saved?.autoApply ?? false);

  const postById = useRef(new Map<string, Post>());
  useEffect(() => {
    postById.current = new Map(posts.map((p) => [p.id, p]));
  }, [posts]);

  useEffect(() => {
    document.body.classList.add("locked");
    return () => document.body.classList.remove("locked");
  }, []);

  useEffect(() => () => abort.current?.abort(), []);

  const start = async () => {
    if (provider === "byok" && !apiKey) return setError("Enter an API key or choose Local.");
    const settings: OrganizeSettings = {
      provider,
      seeds: seeds.split("\n").map((s) => s.trim()).filter(Boolean),
      autoApply,
      byok: provider === "byok" ? { baseUrl, model: modelName, apiKey } : undefined,
    };
    setError(null);
    setStep("running");
    abort.current = new AbortController();
    try {
      const result = await runOrganize(settings, posts, { onProgress: setProgress, signal: abort.current.signal });
      model.current = result.model;
      // Keep the key on device only if asked; otherwise save settings without it.
      const stored = { ...settings, byok: settings.byok ? { ...settings.byok, apiKey: rememberKey ? apiKey : "" } : undefined };
      await lists.saveSettings(stored);
      if (autoApply) {
        await lists.applyProposal(result.proposal, result.model);
        setStep("done");
      } else {
        setProposal(result.proposal.lists.map((l, ci) => ({ ...l, ci })));
        setUnsorted(result.proposal.unsorted);
        setStep("review");
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return onClose();
      setError(err instanceof Error ? err.message : "Organize failed.");
    }
  };

  const apply = async () => {
    const named = proposal.filter((l) => l.name.trim());
    const final: Proposal = { lists: named.map((l) => ({ name: l.name.trim(), postIds: l.postIds })), unsorted };
    // Centroids follow each list by its original index; merges keep the target's centroid.
    const aligned = model.current
      ? { centroids: named.flatMap((l) => (model.current!.centroids[(l as ProposedList & { ci?: number }).ci ?? -1] ? [model.current!.centroids[(l as ProposedList & { ci?: number }).ci ?? -1]!] : [])) }
      : undefined;
    await lists.applyProposal(final, aligned);
    setStep("done");
  };

  const finish = () => {
    onClose();
  };

  return (
    <div className="organize" role="dialog" aria-modal="true" aria-label="Organize bookmarks" onClick={(e) => e.target === e.currentTarget && step === "setup" && onClose()}>
      <div className="organize-card">
        {step === "setup" && (
          <>
            <h2>Organize into lists</h2>
            <p className="muted">
              Classify your {posts.length.toLocaleString()} bookmarks into a handful of lists. Your feed stays untouched — lists are
              labels you can filter on.
            </p>
            {lists.getState().lists.length ? (
              <p className="warning">Re-organizing replaces AI-made lists; lists/posts you assigned by hand are kept.</p>
            ) : null}
            <div className="radios">
              <label className="check">
                <input type="radio" name="provider" checked={provider === "local"} onChange={() => setProvider("local")} />
                Local — free, runs in your browser (downloads a 23 MB model once, slower)
              </label>
              <label className="check">
                <input type="radio" name="provider" checked={provider === "byok"} onChange={() => setProvider("byok")} />
                API key — faster, better names (OpenAI-compatible)
              </label>
            </div>
            {provider === "byok" && (
              <div className="byok">
                <label className="field">
                  <span>Provider</span>
                  <select
                    value={preset}
                    onChange={(e) => {
                      const p = e.target.value as keyof typeof BYOK_PRESETS;
                      setPreset(p);
                      if (p !== "custom") {
                        setBaseUrl(BYOK_PRESETS[p].baseUrl);
                        setModelName(BYOK_PRESETS[p].model);
                      }
                    }}
                  >
                    {Object.entries(BYOK_PRESETS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Base URL</span>
                  <input value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setPreset("custom"); }} spellCheck={false} />
                </label>
                <label className="field">
                  <span>Model</span>
                  <input value={modelName} onChange={(e) => { setModelName(e.target.value); setPreset("custom"); }} spellCheck={false} />
                </label>
                <label className="field">
                  <span>API key</span>
                  <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" spellCheck={false} />
                </label>
                <label className="check">
                  <input type="checkbox" checked={rememberKey} onChange={(e) => setRememberKey(e.target.checked)} />
                  Remember key on this device
                </label>
                <p className="muted small">Roughly $0.05 per 1,000 posts with gpt-4o-mini-class models.</p>
              </div>
            )}
            <label className="field">
              <span>Seeds — optional categories you already want, one per line</span>
              <textarea value={seeds} onChange={(e) => setSeeds(e.target.value)} rows={3} spellCheck={false} />
            </label>
            <label className="check">
              <input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} />
              Apply automatically without review
            </label>
            {error ? <p className="error">{error}</p> : null}
            <div className="actions-row">
              <button className="ghost" onClick={onClose}>
                Cancel
              </button>
              <button className="primary" onClick={() => void start()}>
                Start
              </button>
            </div>
          </>
        )}
        {step === "running" && (
          <>
            <h2>Organizing…</h2>
            {error ? (
              <>
                <p className="error">{error}</p>
                <div className="actions-row">
                  <button className="ghost" onClick={() => { setError(null); setStep("setup"); }}>
                    Back
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="muted">{PHASE_LABELS[progress.phase]}</p>
                <div className="progress">
                  <div className="progress-fill" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
                </div>
                <p className="muted small">
                  {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
                </p>
                <div className="actions-row">
                  <button className="ghost" onClick={() => abort.current?.abort()}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {step === "review" && (
          <>
            <h2>Review lists</h2>
            <div className="review-lists">
              {proposal.map((l, i) => (
                <div className="review-list" key={i}>
                  <div className="review-head">
                    <input value={l.name} onChange={(e) => setProposal(proposal.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <span className="count">{l.postIds.length}</span>
                  </div>
                  <ul>
                    {l.postIds.slice(0, 3).map((id) => {
                      const p = postById.current.get(id);
                      return p ? (
                        <li key={id}>
                          {p.author.name}: {p.text.slice(0, 100)}
                        </li>
                      ) : null;
                    })}
                  </ul>
                  <div className="review-actions">
                    <select
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        const target = Number(e.target.value);
                        setProposal(
                          proposal
                            .map((x, j) => (j === target ? { ...x, postIds: [...x.postIds, ...l.postIds] } : x))
                            .filter((_, j) => j !== i),
                        );
                      }}
                    >
                      <option value="">Merge into…</option>
                      {proposal.map((x, j) => (j !== i ? <option key={j} value={j}>{x.name || `List ${j + 1}`}</option> : null))}
                    </select>
                    <button
                      className="link"
                      onClick={() => {
                        setUnsorted([...unsorted, ...l.postIds]);
                        setProposal(proposal.filter((_, j) => j !== i));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              <p className="muted small">{unsorted.length.toLocaleString()} posts stay unsorted.</p>
            </div>
            <div className="actions-row">
              <button className="ghost" onClick={() => setStep("setup")}>
                Back
              </button>
              <button className="primary" onClick={() => void apply()}>
                Apply {proposal.length} lists
              </button>
            </div>
          </>
        )}
        {step === "done" && (
          <>
            <h2>
              <Icon name="sparkles" /> Organized
            </h2>
            <p className="muted">Your bookmarks are now sorted into lists. Use the list chips above the feed to filter.</p>
            <div className="actions-row">
              <button className="primary" onClick={finish}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
