import { describe, expect, it } from "vitest";

import {
  BADGE_RULES,
  calculateBadge,
  calculateBadges,
  getLikeDistribution,
  getNearThresholdBuckets,
  parseBadgeRules,
} from "../src";

const stats = {
  postCount: 11,
  likeHistogram: new Map([
    [0, 2],
    [1, 2],
    [2, 2],
    [3, 2],
    [4, 1],
    [5, 1],
    [9, 1],
  ]),
};

describe("badge calculator", () => {
  it("uses inclusive thresholds for every configured badge", () => {
    const progress = calculateBadges(stats, BADGE_RULES);

    expect(progress.map((badge) => [badge.key, badge.current])).toEqual([
      ["admired", 2],
      ["respected", 7],
      ["appreciated", 9],
    ]);
  });

  it("caps visual progress while retaining the real current value", () => {
    const progress = calculateBadge(stats, {
      key: "test",
      name: "测试",
      type: "post_like_threshold",
      postLikeThreshold: 1,
      target: 2,
    });

    expect(progress.current).toBe(9);
    expect(progress.remaining).toBe(0);
    expect(progress.isComplete).toBe(true);
    expect(progress.ratio).toBe(4.5);
    expect(progress.cappedRatio).toBe(1);
  });

  it("builds the fixed like distribution and near-threshold buckets", () => {
    const distribution = getLikeDistribution(stats);
    const near = getNearThresholdBuckets(stats, 5);

    expect(distribution.map((bucket) => bucket.count)).toEqual([2, 2, 2, 2, 1, 2]);
    expect(distribution.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(
      stats.postCount,
    );
    expect(near).toEqual([
      { likeCount: 4, count: 1, likesNeeded: 1 },
      { likeCount: 3, count: 2, likesNeeded: 2 },
      { likeCount: 2, count: 2, likesNeeded: 3 },
    ]);
  });

  it("validates external badge rules", () => {
    expect(() => parseBadgeRules({ bad: { name: "Bad" } })).toThrow(
      "不支持的类型",
    );
    expect(() =>
      parseBadgeRules({
        bad: {
          name: "Bad",
          type: "post_like_threshold",
          post_like_threshold: 1,
          target: 0,
        },
      }),
    ).toThrow("target 必须大于 0");
  });
});
