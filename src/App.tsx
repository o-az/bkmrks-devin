import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Library, type LibraryState } from "./lib/library";
import { Lists } from "./lib/lists";
import { assignNew } from "./lib/organize/run";
import { forgetCredentials, loadCredentials, saveCredentials } from "./lib/credentials";
import { clearPrefs, loadPrefs, savePrefs, saveScroll, type Prefs } from "./lib/prefs";
import { countTypes, selectPosts } from "./lib/select";
import { formatAgo } from "./lib/format";
import type { Credentials } from "./lib/types";
import { Connect, Logo } from "./components/Connect";
import { OrganizeDialog } from "./components/OrganizeDialog";
import { Toolbar, dirLabel } from "./components/Toolbar";
import { Feed } from "./components/Feed";
import { Viewer } from "./components/Viewer";
import { Icon } from "./components/Icon";

const library = new Library();
const lists = new Lists();
const STALE_MS = 10 * 60 * 1000;
const SORT_NAMES: Record<Prefs["sort"], string> = {
  saved: "date bookmarked",
  posted: "date posted",
  likes: "likes",
  reposts: "reposts",
  replies: "replies",
  bookmarks: "bookmarks",
  views: "views",
};

function statusText(state: LibraryState): string {
  const n = state.posts.length.toLocaleString();
  const s = state.status;
  if (s.kind === "syncing") {
    if (s.mode === "catchup") return "Checking for new bookmarks…";
    return `${s.mode === "rebuild" ? "Re-syncing" : "Loading bookmarks"}… ${n} so far`;
  }
  if (s.kind === "paused")
    return `X rate limit hit · resumes ${new Date(s.until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  if (s.kind === "error") return s.message;
  if (!state.complete) return `${n} bookmarks · not fully loaded`;
  return `${n} bookmarks${state.lastSync ? ` · updated ${formatAgo(state.lastSync)}` : ""}`;
}

export function App() {
  const state = useSyncExternalStore(library.subscribe, library.getState);
  const [session, setSession] = useState(loadCredentials);
  const [editing, setEditing] = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [pendingOrganize, setPendingOrganize] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [justSorted, setJustSorted] = useState(0);
  const query = useDeferredValue(prefs.query);
  const listsState = useSyncExternalStore(lists.subscribe, lists.getState);
  const fileInput = useRef<HTMLInputElement>(null);
  const organizingRef = useRef(false);
  organizingRef.current = organizing;

  useEffect(() => {
    void library.load();
    void lists.load();
  }, []);

  useEffect(() => {
    if (state.ready && session) void library.sync(session.creds);
  }, [state.ready, session]);

  useEffect(() => {
    if (!session) return;
    const refresh = () => {
      const s = library.getState();
      if (document.visibilityState !== "visible" || !s.ready || s.status.kind === "syncing") return;
      if (s.status.kind === "error" && !s.status.auth) return void library.sync(session.creds);
      if (!s.lastSync || Date.now() - s.lastSync > STALE_MS) void library.sync(session.creds);
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [session]);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

  const visible = useMemo(
    () => selectPosts(state.posts, { types: prefs.types, query, sort: prefs.sort, dir: prefs.dir, list: prefs.list }, listsState.assignments),
    [state.posts, prefs.types, prefs.sort, prefs.dir, prefs.list, query, listsState.assignments],
  );
  const counts = useMemo(() => countTypes(state.posts), [state.posts]);
  const listCounts = useMemo(() => lists.countByList(state.posts), [listsState, state.posts]);
  const selectionKey = `${prefs.types.join()}|${prefs.sort}|${prefs.dir}|${prefs.list}|${query}`;

  // A deleted list clears its filter.
  useEffect(() => {
    if (prefs.list && prefs.list !== "unsorted" && !listsState.lists.some((l) => l.id === prefs.list)) update({ list: null });
  }, [prefs.list, listsState.lists]);

  // The "Load & organize" button opens the dialog once the first sync settles.
  useEffect(() => {
    if (pendingOrganize && state.complete && state.status.kind === "idle") {
      setPendingOrganize(false);
      setOrganizing(true);
    }
  }, [pendingOrganize, state.complete, state.status]);

  // After a sync, assign posts that have no assignment yet to existing lists.
  useEffect(() => {
    if (state.status.kind !== "idle" || !listsState.ready || !listsState.lists.length || !listsState.settings || organizingRef.current) return;
    if (listsState.settings.provider === "byok" && !listsState.settings.byok?.apiKey) return;
    const fresh = state.posts.filter((p) => !listsState.assignments.has(p.id));
    if (!fresh.length) return;
    let cancelled = false;
    void assignNew(listsState.settings, fresh, listsState.lists, listsState.model).then(async (byName) => {
      if (cancelled) return;
      await lists.setAutoAssignments(byName);
      const added = [...byName.values()].filter((n) => n.length).length;
      if (added) {
        setJustSorted(added);
        setTimeout(() => setJustSorted(0), 5000);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [state.status, state.posts, listsState]);

  const lastSelection = useRef(selectionKey);
  useEffect(() => {
    if (lastSelection.current === selectionKey) return;
    lastSelection.current = selectionKey;
    saveScroll(null);
  }, [selectionKey]);

  useEffect(() => {
    if (openIndex !== null && openIndex >= visible.length) setOpenIndex(null);
  }, [openIndex, visible.length]);

  const connect = async (creds: Credentials, remember: boolean, organize = false) => {
    // A different auth_token is a different account: its library must not mix with the old one.
    if (session && session.creds.authToken !== creds.authToken) {
      await library.clear();
      await lists.clear();
      saveScroll(null);
    }
    saveCredentials(creds, remember);
    setSession({ creds, remember });
    setPendingOrganize(organize);
    setEditing(false);
  };

  const signOut = async () => {
    if (!confirm("Sign out and delete the saved cookies and bookmark library from this device?")) return;
    forgetCredentials();
    clearPrefs();
    await library.clear();
    await lists.clear();
    setPrefs(loadPrefs());
    setSession(null);
  };

  const editLists = useCallback((postId: string, listIds: string[]) => void lists.setPostLists(postId, listIds), []);
  const createList = useCallback((name: string) => lists.createList(name), []);

  const exportLists = () => {
    const url = URL.createObjectURL(new Blob([lists.exportJSON()], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "bkmrks-lists.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importLists = async (file: File) => {
    try {
      await lists.importJSON(await file.text());
    } catch {
      alert("That file isn't a valid lists export.");
    }
  };

  const authError = state.status.kind === "error" && state.status.auth ? state.status.message : undefined;
  if (!state.ready) return <div className="boot" />;
  if (!session || editing || (authError && !state.posts.length)) {
    return (
      <Connect
        initial={session?.creds}
        error={authError}
        hasLibrary={state.posts.length > 0}
        onConnect={connect}
        onCancel={session && state.posts.length ? () => setEditing(false) : undefined}
      />
    );
  }

  const busy = state.status.kind === "syncing";
  const filtered = prefs.types.length > 0 || query.trim() !== "";
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <Logo /> bkmrks
        </div>
        <div className={`status ${state.status.kind}`} role="status">
          {busy ? <span className="spinner" /> : null}
          <span>
            {statusText(state)}
            {justSorted ? ` · ${justSorted} new sorted` : ""}
          </span>
          {authError ? (
            <button className="link" onClick={() => setEditing(true)}>
              Update cookies
            </button>
          ) : state.status.kind === "error" ? (
            <button className="link" onClick={() => void library.sync(session.creds)}>
              Retry
            </button>
          ) : null}
        </div>
        <div className="actions">
          <button className="icon-btn organize-btn" onClick={() => setOrganizing(true)} title="Organize with AI" aria-label="Organize with AI">
            <Icon name="sparkles" />
            <span className="organize-label">Organize</span>
          </button>
          <button className="icon-btn" disabled={busy} onClick={() => void library.sync(session.creds)} title="Check for new bookmarks" aria-label="Check for new bookmarks">
            <Icon name="refresh" />
          </button>
          <details className="menu">
            <summary className="icon-btn" aria-label="More">
              <Icon name="more" />
            </summary>
            <div className="menu-list" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute("open")}>
              <button onClick={() => void library.sync(session.creds, true)}>Re-sync everything</button>
              <button onClick={exportLists}>Export lists</button>
              <button onClick={() => fileInput.current?.click()}>Import lists…</button>
              <button
                className="danger"
                onClick={() => {
                  if (confirm("Delete all lists and assignments? Your bookmarks stay.")) void lists.clear();
                }}
              >
                Clear lists
              </button>
              <button onClick={() => setEditing(true)}>Update cookies</button>
              <button className="danger" onClick={() => void signOut()}>
                Sign out & clear data
              </button>
            </div>
          </details>
        </div>
      </header>
      <div className="sticky">
        <Toolbar prefs={prefs} counts={counts} total={state.posts.length} lists={listsState.lists} listCounts={listCounts} onChange={update} />
      </div>
      <main className={`content ${prefs.view}`}>
        <p className="summary">
          {filtered || prefs.list
            ? `${visible.length.toLocaleString()} of ${state.posts.length.toLocaleString()}${prefs.list ? ` in ${prefs.list === "unsorted" ? "Unsorted" : (listsState.lists.find((l) => l.id === prefs.list)?.name ?? "")}` : ""} · `
            : ""}
          Sorted by {SORT_NAMES[prefs.sort]}, {dirLabel(prefs.sort, prefs.dir).toLowerCase()}
          {prefs.sort === "saved" ? <span className="hint" title="X doesn't share when you bookmarked a post, only the order."> ⓘ</span> : null}
          {!state.complete && state.posts.length ? " · still loading older bookmarks" : ""}
        </p>
        {visible.length ? (
          <Feed
            key={prefs.view}
            posts={visible}
            sort={prefs.sort}
            view={prefs.view}
            selectionKey={selectionKey}
            onOpen={setOpenIndex}
            lists={listsState.lists}
            assignments={listsState.assignments}
            onEditLists={editLists}
            onCreateList={createList}
          />
        ) : busy && !state.posts.length ? (
          <div className="empty">
            <span className="spinner large" />
            <p>Fetching your bookmarks…</p>
          </div>
        ) : state.posts.length ? (
          <div className="empty">
            <p>Nothing matches these filters.</p>
            <button className="ghost" onClick={() => update({ types: [], query: "" })}>
              Clear filters
            </button>
          </div>
        ) : state.status.kind === "idle" ? (
          <div className="empty">
            <p>No bookmarks yet. Bookmark something on X and hit refresh.</p>
          </div>
        ) : null}
      </main>
      {openIndex !== null && visible[openIndex] ? <Viewer posts={visible} index={openIndex} sort={prefs.sort} onIndex={setOpenIndex} /> : null}
      {organizing ? <OrganizeDialog posts={state.posts} lists={lists} onClose={() => setOrganizing(false)} /> : null}
      <input
        ref={fileInput}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importLists(f);
          e.target.value = "";
        }}
      />
      <UpdatePrompt />
    </>
  );
}

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="toast" role="status">
      A new version is available.
      <button className="link" onClick={() => void updateServiceWorker(true)}>
        Reload
      </button>
      <button className="icon-btn" onClick={() => setNeedRefresh(false)} aria-label="Dismiss">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
