import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentSession } from "./auth";
import { loadPushConfig } from "./notifications";

vi.mock("./auth", () => ({ currentSession: vi.fn(), supabase: vi.fn() }));
vi.mock("./config", () => ({
  supabaseUrl: "https://fixture.supabase.co",
  supabaseAnonKey: "sb_publishable_fixture",
}));

const request = vi.fn();
const session = { access_token: "fixture-user-access-token" } as Session;

describe("notification configuration authentication", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", request);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the signed-in JWT separately from the publishable project key", async () => {
    vi.mocked(currentSession).mockResolvedValue(session);
    request.mockResolvedValue(
      new Response(
        JSON.stringify({
          push: { configured: true, publicKey: "fixture-vapid-public-key" },
          channels: { email: false, sms: false },
        }),
        { status: 200 },
      ),
    );
    expect(await loadPushConfig()).toEqual({
      push: { configured: true, publicKey: "fixture-vapid-public-key" },
      channels: { email: false, sms: false },
    });
    expect(request).toHaveBeenCalledWith(
      "https://fixture.supabase.co/functions/v1/dispatch-reminders",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: "sb_publishable_fixture",
          Authorization: "Bearer fixture-user-access-token",
        },
        body: JSON.stringify({ action: "config" }),
      },
    );
  });

  it("does not contact the dispatcher without a signed-in session", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    expect((await loadPushConfig()).push.configured).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps push disabled if the gateway rejects the user session", async () => {
    vi.mocked(currentSession).mockResolvedValue(session);
    request.mockResolvedValue(new Response(null, { status: 401 }));
    expect((await loadPushConfig()).push.configured).toBe(false);
  });
});
