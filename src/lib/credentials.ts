import type { Credentials } from "./types";

const KEY = "sift.credentials";

/** Accepts either the two raw values or a pasted Cookie header / cookie list containing both. */
export function parseCookieInput(authToken: string, ct0: string): Credentials {
  const blob = `${authToken}\n${ct0}`;
  const find = (name: string) => blob.match(new RegExp(`(?:^|[\\s;])${name}\\s*[=:\\t]\\s*"?([A-Za-z0-9]+)`))?.[1];
  return {
    authToken: find("auth_token") ?? authToken.trim(),
    ct0: find("ct0") ?? ct0.trim(),
  };
}

export function validCredentials({ authToken, ct0 }: Credentials): string | null {
  if (!/^[A-Za-z0-9]{20,256}$/.test(authToken)) return "auth_token should be a long string of letters and numbers.";
  if (!/^[A-Za-z0-9]{20,256}$/.test(ct0)) return "ct0 should be a long string of letters and numbers.";
  if (authToken === ct0) return "auth_token and ct0 are different cookies.";
  return null;
}

export function loadCredentials(): { creds: Credentials; remember: boolean } | null {
  for (const [storage, remember] of [[localStorage, true], [sessionStorage, false]] as const) {
    try {
      const value = JSON.parse(storage.getItem(KEY) ?? "null");
      if (typeof value?.authToken === "string" && typeof value?.ct0 === "string")
        return { creds: { authToken: value.authToken, ct0: value.ct0 }, remember };
    } catch {
      storage.removeItem(KEY);
    }
  }
  return null;
}

/** remember=false keeps them for this tab only (survives reloads, not closing the tab). */
export function saveCredentials(creds: Credentials, remember: boolean): void {
  forgetCredentials();
  (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(creds));
}

export function forgetCredentials(): void {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(KEY);
}
