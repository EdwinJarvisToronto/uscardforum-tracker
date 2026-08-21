import { describe, expect, it } from "vitest";

import {
  fetchGitHubStarCount,
  formatGitHubStarCount,
  GITHUB_REPOSITORY_URL,
  type RepositoryFetcher,
} from "../src/github-stars";

function responseWith(payload: unknown, ok = true): RepositoryFetcher {
  return async () => ({
    ok,
    json: async () => payload,
  });
}

describe("GitHub star count", () => {
  it("reads a valid public repository response, including zero", async () => {
    await expect(
      fetchGitHubStarCount(responseWith({ stargazers_count: 0 })),
    ).resolves.toBe(0);
    await expect(
      fetchGitHubStarCount(responseWith({ stargazers_count: 1_234 })),
    ).resolves.toBe(1_234);
  });

  it.each([
    {},
    { stargazers_count: "3" },
    { stargazers_count: -1 },
    { stargazers_count: 1.5 },
    { stargazers_count: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects an invalid count from %j", async (payload) => {
    await expect(fetchGitHubStarCount(responseWith(payload))).resolves.toBeNull();
  });

  it("falls back quietly when GitHub is unavailable", async () => {
    await expect(
      fetchGitHubStarCount(responseWith({ stargazers_count: 7 }, false)),
    ).resolves.toBeNull();
    await expect(
      fetchGitHubStarCount(async () => {
        throw new Error("offline");
      }),
    ).resolves.toBeNull();
  });

  it("stops waiting for a stalled response", async () => {
    const fetcher: RepositoryFetcher = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });

    await expect(fetchGitHubStarCount(fetcher, 1)).resolves.toBeNull();
  });

  it("sends no credentials, referrer, archive data, or computed result", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetcher: RepositoryFetcher = async (url, init) => {
      requestUrl = url;
      requestInit = init;
      return { ok: true, json: async () => ({ stargazers_count: 5 }) };
    };

    await fetchGitHubStarCount(fetcher);

    expect(requestUrl).toBe(
      "https://api.github.com/repos/EdwinJarvisToronto/uscardforum-tracker",
    );
    expect(requestInit).toMatchObject({
      headers: { Accept: "application/vnd.github+json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
    expect(requestInit?.signal?.aborted).toBe(false);
    expect(JSON.stringify(requestInit)).not.toMatch(/archive|like_count|result/i);
    expect(GITHUB_REPOSITORY_URL).toBe(
      "https://github.com/EdwinJarvisToronto/uscardforum-tracker",
    );
  });

  it("formats large counts compactly without changing small counts", () => {
    expect(formatGitHubStarCount(0)).toBe("0");
    expect(formatGitHubStarCount(999)).toBe("999");
    expect(formatGitHubStarCount(1_200)).toBe("1.2k");
  });
});
