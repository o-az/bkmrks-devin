import { useState } from "react";
import type { Credentials } from "../lib/types";
import { parseCookieInput, validCredentials } from "../lib/credentials";
import { Icon } from "./Icon";

interface ConnectProps {
  initial?: Credentials;
  error?: string;
  hasLibrary: boolean;
  onConnect: (creds: Credentials, remember: boolean) => void;
  onCancel?: () => void;
}

export function Connect({ initial, error, hasLibrary, onConnect, onCancel }: ConnectProps) {
  const [authToken, setAuthToken] = useState(initial?.authToken ?? "");
  const [ct0, setCt0] = useState(initial?.ct0 ?? "");
  const [remember, setRemember] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const creds = parseCookieInput(authToken, ct0);
    const invalid = validCredentials(creds);
    if (invalid) return setProblem(invalid);
    onConnect(creds, remember);
  };

  const onPaste = (value: string) => {
    const parsed = parseCookieInput(value, "");
    if (/auth_token/.test(value)) setAuthToken(parsed.authToken);
    else setAuthToken(value);
    if (/ct0/.test(value)) setCt0(parsed.ct0);
  };

  return (
    <main className="connect">
      <div className="connect-card">
        <div className="brand large">
          <Logo /> Sift
        </div>
        <h1>Sort and filter your X bookmarks.</h1>
        <p className="lede">
          Order by likes, reposts, replies, bookmarks or date. Show only text, images or videos. Browse as cards or a gallery.
        </p>
        <form onSubmit={submit}>
          <label className="field">
            <span>auth_token</span>
            <input
              type={reveal ? "text" : "password"}
              value={authToken}
              onChange={(e) => onPaste(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="40 characters"
              required
            />
          </label>
          <label className="field">
            <span>ct0</span>
            <input
              type={reveal ? "text" : "password"}
              value={ct0}
              onChange={(e) => setCt0(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="long hex string"
              required
            />
          </label>
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember on this device
            </label>
            <button type="button" className="link" onClick={() => setReveal(!reveal)}>
              {reveal ? "Hide" : "Show"} values
            </button>
          </div>
          {problem || error ? <p className="error">{problem ?? error}</p> : null}
          <button className="primary" type="submit">
            {hasLibrary ? "Reconnect" : "Load my bookmarks"}
          </button>
          {onCancel ? (
            <button type="button" className="ghost" onClick={onCancel}>
              Back to library
            </button>
          ) : null}
        </form>
        <details className="howto">
          <summary>Where do I find these?</summary>
          <ol>
            <li>Open x.com in a desktop browser while logged in.</li>
            <li>Open DevTools (F12 or ⌥⌘I) → Application (Storage in Firefox) → Cookies → https://x.com.</li>
            <li>
              Copy the values of <code>auth_token</code> and <code>ct0</code>. You can also paste a whole cookie string into the first field.
            </li>
          </ol>
        </details>
        <p className="privacy">
          <Icon name="lock" size={14} />
          <span>
            These cookies act like your password. They're sent only to this app's server to call X for you and are never stored there. Your
            library is kept in this browser; unticking Remember keeps them for this tab only.
          </span>
        </p>
      </div>
    </main>
  );
}

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 2h12a2 2 0 0 1 2 2v18l-8-5-8 5V4a2 2 0 0 1 2-2Z" fill="var(--accent)" />
      <path d="M8.5 7.5h7M8.5 10.5h5M8.5 13.5h3" stroke="var(--accent-ink)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
