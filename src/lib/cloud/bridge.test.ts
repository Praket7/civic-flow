import {
  awaitSessionFromParent,
  isBridgedSession,
  sendSession,
  SESSION_MESSAGE,
  trustedPwaFrame,
} from "./bridge";

function sameOriginFrame(postMessage: (message: unknown, target: string) => void) {
  return {
    contentDocument: { URL: new URL("pwa.html#/", window.location.href).href },
    contentWindow: { postMessage },
  } as unknown as HTMLIFrameElement;
}

describe("desktop session bridge", () => {
  it("adopts only a pair of tokens", () => {
    expect(isBridgedSession({ accessToken: "a", refreshToken: "r" })).toBe(true);
    expect(isBridgedSession({ accessToken: "a" })).toBe(false);
    expect(isBridgedSession({ accessToken: 1, refreshToken: "r" })).toBe(false);
    expect(isBridgedSession(null)).toBe(false);
  });

  it("does nothing when there is no frame", () => {
    expect(() => sendSession(null, { access_token: "a", refresh_token: "r" })).not.toThrow();
  });

  it("posts the session as tokens and nothing else", () => {
    const posted: Array<{ message: unknown; target: string }> = [];
    const frame = sameOriginFrame((message, target) => posted.push({ message, target }));

    sendSession(frame, { access_token: "access", refresh_token: "refresh" });

    expect(posted).toEqual([
      {
        message: {
          type: SESSION_MESSAGE,
          session: { accessToken: "access", refreshToken: "refresh" },
        },
        target: window.location.origin === "null" ? "*" : window.location.origin,
      },
    ]);
  });

  it("passes an explicit absence of a session rather than staying silent", () => {
    const posted: unknown[] = [];
    const frame = sameOriginFrame((message) => posted.push(message));

    sendSession(frame, null);

    expect(posted).toEqual([{ type: SESSION_MESSAGE, session: null }]);
  });

  it("refuses to send credentials after the iframe navigates to another origin", () => {
    const posted: unknown[] = [];
    const frame = {
      contentDocument: null,
      contentWindow: { postMessage: (message: unknown) => posted.push(message) },
    } as unknown as HTMLIFrameElement;
    expect(trustedPwaFrame(frame)).toBeNull();
    sendSession(frame, { access_token: "secret", refresh_token: "refresh-secret" });
    expect(posted).toEqual([]);
  });

  it("refuses same-origin navigation to a different document", () => {
    const posted: unknown[] = [];
    const frame = {
      contentDocument: { URL: new URL("welcome.html", window.location.href).href },
      contentWindow: { postMessage: (message: unknown) => posted.push(message) },
    } as unknown as HTMLIFrameElement;
    sendSession(frame, { access_token: "secret", refresh_token: "refresh-secret" });
    expect(posted).toEqual([]);
  });

  it("resolves to no session in a top-level document", async () => {
    await expect(awaitSessionFromParent(10)).resolves.toBeNull();
  });
});
