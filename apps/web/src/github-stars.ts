export const GITHUB_REPOSITORY_URL =
  "https://github.com/EdwinJarvisToronto/uscardforum-tracker";

const GITHUB_REPOSITORY_API_URL =
  "https://api.github.com/repos/EdwinJarvisToronto/uscardforum-tracker";
const STAR_COUNT_TIMEOUT_MS = 5_000;

interface JsonResponse {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

export type RepositoryFetcher = (
  url: string,
  init: RequestInit,
) => Promise<JsonResponse>;

function readStarCount(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null;

  const count = (payload as Record<string, unknown>).stargazers_count;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 0
    ? count
    : null;
}

export async function fetchGitHubStarCount(
  fetcher: RepositoryFetcher = fetch,
  timeoutMs = STAR_COUNT_TIMEOUT_MS,
): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(GITHUB_REPOSITORY_API_URL, {
      headers: { Accept: "application/vnd.github+json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return readStarCount(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function formatGitHubStarCount(count: number): string {
  if (count < 1_000) return String(count);

  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  })
    .format(count)
    .toLowerCase();
}
