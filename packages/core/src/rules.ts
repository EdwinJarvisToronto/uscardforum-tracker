import rawRules from "../../../badge_rules.json";

import type { BadgeRule } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonNegativeInteger(
  value: unknown,
  field: string,
  key: string,
): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`规则 ${key} 的 ${field} 必须是非负整数`);
  }
  return value as number;
}

export function parseBadgeRules(value: unknown): readonly BadgeRule[] {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new Error("徽章规则必须是非空对象");
  }

  return Object.entries(value).map(([key, rawRule]) => {
    if (!isRecord(rawRule)) {
      throw new Error(`规则 ${key} 必须是对象`);
    }

    const name = rawRule.name;
    const type = rawRule.type;
    if (typeof name !== "string" || name.trim() === "") {
      throw new Error(`规则 ${key} 缺少有效名称`);
    }
    if (type !== "post_like_threshold") {
      throw new Error(`规则 ${key} 使用了不支持的类型`);
    }

    const postLikeThreshold = requireNonNegativeInteger(
      rawRule.post_like_threshold,
      "post_like_threshold",
      key,
    );
    const target = requireNonNegativeInteger(rawRule.target, "target", key);
    if (target === 0) {
      throw new Error(`规则 ${key} 的 target 必须大于 0`);
    }

    return {
      key,
      name: name.trim(),
      type,
      postLikeThreshold,
      target,
    };
  });
}

export const BADGE_RULES = parseBadgeRules(rawRules);
