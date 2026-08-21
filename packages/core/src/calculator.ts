import type {
  ArchiveStats,
  BadgeProgress,
  BadgeRule,
  LikeDistributionBucket,
  NearThresholdBucket,
} from "./types";

function countExactly(stats: ArchiveStats, likeCount: number): number {
  return stats.likeHistogram.get(likeCount) ?? 0;
}

export function calculateBadge(
  stats: ArchiveStats,
  rule: BadgeRule,
): BadgeProgress {
  let current = 0;
  for (const [likeCount, postCount] of stats.likeHistogram) {
    if (likeCount >= rule.postLikeThreshold) {
      current += postCount;
    }
  }

  const ratio = current / rule.target;
  return {
    ...rule,
    current,
    remaining: Math.max(rule.target - current, 0),
    isComplete: current >= rule.target,
    ratio,
    cappedRatio: Math.min(ratio, 1),
  };
}

export function calculateBadges(
  stats: ArchiveStats,
  rules: readonly BadgeRule[],
): readonly BadgeProgress[] {
  return rules.map((rule) => calculateBadge(stats, rule));
}

export function getLikeDistribution(
  stats: ArchiveStats,
): readonly LikeDistributionBucket[] {
  let fivePlus = 0;
  for (const [likeCount, postCount] of stats.likeHistogram) {
    if (likeCount >= 5) fivePlus += postCount;
  }

  return [
    { key: "zero", label: "0 赞", count: countExactly(stats, 0) },
    { key: "one", label: "1 赞", count: countExactly(stats, 1) },
    { key: "two", label: "2 赞", count: countExactly(stats, 2) },
    { key: "three", label: "3 赞", count: countExactly(stats, 3) },
    { key: "four", label: "4 赞", count: countExactly(stats, 4) },
    { key: "fivePlus", label: "5+ 赞", count: fivePlus },
  ];
}

export function getNearThresholdBuckets(
  stats: ArchiveStats,
  threshold: number,
  depth = 3,
): readonly NearThresholdBucket[] {
  const buckets: NearThresholdBucket[] = [];
  for (let likesNeeded = 1; likesNeeded <= depth; likesNeeded += 1) {
    const likeCount = threshold - likesNeeded;
    if (likeCount < 0) break;
    buckets.push({
      likeCount,
      count: countExactly(stats, likeCount),
      likesNeeded,
    });
  }
  return buckets;
}
