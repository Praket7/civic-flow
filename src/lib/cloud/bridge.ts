/**
 * The handshake that signs the shared workspace in when it is shown inside the
 * desktop window.
 *
 * The hosted client is its own document, so it gets its own Supabase client.
 * Left alone it would ask for a password a second time and, if allowed to
 * persist, write a refresh token to web storage — exactly what the desktop
 * session store avoids. Instead the desktop passes the session it already holds
 * in the operating system credential store.
 *
 * The iframe must still display our bundled pwa.html when the desktop sends
 * credentials. A WindowProxy remains the same after cross-origin navigation,
 * so event.source alone is not a sufficient trust check.
 */

export const SESSION_MESSAGE = "civicflow:session";
export const READY_MESSAGE = "civicflow:ready";

/**
 * A framed WindowProxy survives navigation. Checking contentDocument ensures
 * that an iframe redirected to another origin cannot obtain a cloud token,
 * even if it sends a forged READY message through the same WindowProxy.
 *
 * The bundled app and pwa.html are same-origin; cross-origin contentDocument
 * access returns null. Match the actual document against the fixed local PWA
 * path, not against an attacker-controlled iframe src attribute.
 */
export function trustedPwaFrame(frame: HTMLIFrameElement | null): URL | null {
  if (!frame?.contentWindow) return null;
  try {
    const documentUrl = frame.contentDocument?.URL;
    if (!documentUrl) return null;
    const expected = new URL("pwa.html", window.location.href);
    const actual = new URL(documentUrl);
    if (
      actual.protocol !== expected.protocol ||
      actual.host !== expected.host ||
      actual.pathname !== expected.pathname
    ) {
      return null;
    }
    return actual;
  } catch {
    return null;
  }
}

/** Only what a Supabase client needs to adopt a session; nothing else is sent. */
export interface BridgedSession {
  accessToken: string;
  refreshToken: string;
}

export function isBridgedSession(value: unknown): value is BridgedSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.accessToken === "string" && typeof candidate.refreshToken === "string";
}

/** True when this document is framed, which is how the desktop shows it. */
export function isEmbedded(): boolean {
  return typeof window !== "undefined" && window.parent !== window;
}

/**
 * Asks the surrounding window for a session and waits for the answer. A null
 * answer is meaningful: the desktop is not signed in, so this document should
 * offer its own sign-in rather than a blank screen.
 */
export function awaitSessionFromParent(timeoutMs = 8000): Promise<BridgedSession | null> {
  if (!isEmbedded()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (session: BridgedSession | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", receive);
      resolve(session);
    };
    function receive(event: MessageEvent) {
      if (event.source !== window.parent) return;
      const data = event.data as { type?: string; session?: unknown } | null;
      if (!data || data.type !== SESSION_MESSAGE) return;
      finish(isBridgedSession(data.session) ? data.session : null);
    }
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: READY_MESSAGE }, "*");
    // A window that never answers is not a reason to hang on a blank page.
    setTimeout(() => finish(null), timeoutMs);
  });
}

/** Hands a session (or the absence of one) to the framed document. */
export function sendSession(
  frame: HTMLIFrameElement | null,
  session: { access_token: string; refresh_token: string } | null,
): void {
  const target = frame?.contentWindow;
  const trustedUrl = trustedPwaFrame(frame);
  if (!target || !trustedUrl) return;
  // For an opaque packaged-app origin, postMessage cannot target "null".
  // A wildcard is safe only after verifying the actual same-origin document.
  const targetOrigin = trustedUrl.origin === "null" ? "*" : trustedUrl.origin;
  target.postMessage(
    {
      type: SESSION_MESSAGE,
      session: session
        ? { accessToken: session.access_token, refreshToken: session.refresh_token }
        : null,
    },
    targetOrigin,
  );
}
