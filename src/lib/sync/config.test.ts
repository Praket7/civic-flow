import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  window.history.replaceState({}, "", "/");
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("judging cloud boundary", () => {
  it("disables cloud credentials even when the build contains a public key", async () => {
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "sb_publishable_test_only");
    window.history.replaceState({}, "", "/judge/demo/");
    const config = await import("./config");
    expect(config.cloudConfigured()).toBe(false);
    expect(config.supabaseAnonKey).toBe("");
    expect(() => config.requireCloudConfig()).toThrow(config.MissingCloudConfigError);
  });

  it("does not disable the normal hosted root", async () => {
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "sb_publishable_test_only");
    const config = await import("./config");
    expect(config.cloudConfigured()).toBe(true);
    expect(config.isJudgingSample("/judge-other")).toBe(false);
    expect(config.isJudgingSample("/", "civic-flow-sample-praket7.vercel.app")).toBe(true);
  });
});
