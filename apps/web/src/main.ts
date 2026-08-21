import {
  ArchiveParseError,
  BADGE_RULES,
  DEFAULT_PARSE_LIMITS,
  calculateBadges,
  getLikeDistribution,
  getNearThresholdBuckets,
  parseDiscourseArchive,
  type ArchiveErrorCode,
  type BadgeProgress,
  type LikeDistributionBucket,
  type NearThresholdBucket,
} from "@uscard/core";

import {
  fetchGitHubStarCount,
  formatGitHubStarCount,
} from "./github-stars";

import "./styles.css";

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const fileInput = getElement<HTMLInputElement>("archive-input");
const dropZone = getElement<HTMLLabelElement>("drop-zone");
const uploadPanel = getElement<HTMLDivElement>("upload-panel");
const errorMessage = getElement<HTMLDivElement>("error-message");
const processing = getElement<HTMLDivElement>("processing");
const processingText = getElement<HTMLSpanElement>("processing-text");
const resultsSection = getElement<HTMLElement>("results");
const resultsTitle = getElement<HTMLHeadingElement>("results-title");
const resultsSummary = getElement<HTMLParagraphElement>("results-summary");
const badgeGrid = getElement<HTMLDivElement>("badge-grid");
const nearList = getElement<HTMLDivElement>("near-list");
const impactNote = getElement<HTMLParagraphElement>("impact-note");
const distributionList = getElement<HTMLDivElement>("distribution-list");
const resetButton = getElement<HTMLButtonElement>("reset-button");
const githubStarLink = getElement<HTMLAnchorElement>("github-star-link");
const githubStarCount = getElement<HTMLSpanElement>("github-star-count");

let isProcessing = false;
let dragDepth = 0;

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(bytes / 1024, 0.1).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadGitHubStarCount(): Promise<void> {
  const count = await fetchGitHubStarCount();
  if (count === null) {
    githubStarCount.hidden = true;
    githubStarLink.classList.add("is-count-unavailable");
    return;
  }

  githubStarCount.textContent = formatGitHubStarCount(count);
  githubStarCount.title = `${formatNumber(count)} 个 Star`;
  githubStarLink.setAttribute(
    "aria-label",
    `在新标签页打开 GitHub 项目仓库；当前 ${formatNumber(count)} 个 Star，欢迎支持`,
  );
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function setProcessing(message: string): void {
  processingText.textContent = message;
  processing.hidden = false;
  uploadPanel.classList.add("is-processing");
}

function clearProcessing(): void {
  processing.hidden = true;
  uploadPanel.classList.remove("is-processing");
}

function clearError(): void {
  errorMessage.hidden = true;
  errorMessage.replaceChildren();
  uploadPanel.classList.remove("has-error");
}

function errorCopy(code: ArchiveErrorCode): string {
  const messages: Record<ArchiveErrorCode, string> = {
    UNSUPPORTED_FILE: "请选择论坛导出的 .zip，或解压后的 user_archive.csv。",
    FILE_TOO_LARGE: "ZIP 超过 50 MB。请解压后只选择不超过 30 MB 的 user_archive.csv。",
    INVALID_ZIP: "这个 ZIP 无法读取，可能未下载完整、已损坏或经过加密。",
    ZIP_TOO_MANY_ENTRIES: "ZIP 中的文件条目数量异常。请解压后只选择 user_archive.csv。",
    CSV_NOT_FOUND: "ZIP 中没有找到 user_archive.csv。也可以解压后单独选择它。",
    AMBIGUOUS_CSV: "ZIP 中有多个 user_archive.csv，无法确定该使用哪一个。",
    CSV_TOO_LARGE: "user_archive.csv 超过 30 MB，当前浏览器版本无法安全处理。",
    INVALID_UTF8: "CSV 不是 Discourse 通常使用的 UTF-8 编码。",
    INVALID_CSV: "CSV 结构不完整或格式有误，请重新下载用户归档。",
    MISSING_COLUMN: "CSV 中缺少 like_count 列，请确认选择的是 user_archive.csv。",
    DUPLICATE_COLUMN: "CSV 中出现重复的 like_count 列，请重新下载用户归档。",
    INVALID_LIKE_COUNT: "CSV 中存在无法识别的点赞数，请重新下载用户归档。",
  };
  return messages[code];
}

function showError(error: unknown): void {
  const title = createElement("strong", undefined, "没有成功读取这份归档");
  const body = createElement(
    "span",
    undefined,
    error instanceof ArchiveParseError
      ? errorCopy(error.code)
      : "浏览器处理文件时发生意外错误，请重试。",
  );
  errorMessage.replaceChildren(title, body);
  errorMessage.hidden = false;
  uploadPanel.classList.add("has-error");
}

function renderBadgeCard(progress: BadgeProgress): HTMLElement {
  const card = createElement(
    "article",
    `badge-card${progress.key === "admired" ? " badge-card-featured" : ""}`,
  );
  const top = createElement("div", "badge-card-top");
  const titleWrap = createElement("div");
  titleWrap.append(
    createElement("p", "badge-label", progress.key === "admired" ? "核心目标" : "徽章进度"),
    createElement("h3", undefined, progress.name),
  );
  const status = createElement(
    "span",
    `badge-status${progress.isComplete ? " is-complete" : ""}`,
    progress.isComplete ? "✓ 已达到" : `${(progress.cappedRatio * 100).toFixed(1)}%`,
  );
  top.append(titleWrap, status);

  const value = createElement("p", "badge-value");
  value.append(
    createElement("strong", undefined, formatNumber(progress.current)),
    createElement("span", undefined, ` / ${formatNumber(progress.target)}`),
  );

  const bar = createElement("progress", "badge-progress");
  bar.max = progress.target;
  bar.value = Math.min(progress.current, progress.target);
  bar.setAttribute(
    "aria-label",
    `${progress.name}：${progress.current} / ${progress.target}`,
  );

  const rule = createElement(
    "p",
    "badge-rule",
    `${formatNumber(progress.target)} 篇帖子各获得至少 ${progress.postLikeThreshold} 个赞`,
  );
  const remaining = createElement(
    "p",
    "badge-remaining",
    progress.isComplete
      ? `已有 ${formatNumber(progress.current)} 篇符合条件`
      : `还差 ${formatNumber(progress.remaining)} 篇符合条件的帖子`,
  );

  card.append(top, value, bar, rule, remaining);
  return card;
}

function renderNearThreshold(
  buckets: readonly NearThresholdBucket[],
  admired: BadgeProgress,
): void {
  nearList.replaceChildren();
  for (const bucket of buckets) {
    const row = createElement("div", "near-row");
    const likes = createElement("div", "near-likes");
    likes.append(
      createElement("strong", undefined, `${bucket.likeCount}`),
      createElement("span", undefined, "赞"),
    );
    const copy = createElement("div", "near-copy");
    copy.append(
      createElement("strong", undefined, `${formatNumber(bucket.count)} 篇帖子`),
      createElement(
        "span",
        undefined,
        `每篇再获 ${bucket.likesNeeded} 个赞即可计入`,
      ),
    );
    row.append(likes, copy);
    nearList.append(row);
  }

  const closest = buckets[0];
  impactNote.textContent = closest && closest.count > 0
    ? `如果这 ${formatNumber(closest.count)} 篇 ${closest.likeCount} 赞帖子各再获 1 个赞，进度将从 ${formatNumber(admired.current)} 提升到 ${formatNumber(admired.current + closest.count)}。`
    : "目前没有恰好 4 赞的帖子；继续创作新的优质内容也能推进进度。";
}

function renderDistribution(buckets: readonly LikeDistributionBucket[]): void {
  distributionList.replaceChildren();
  const maximum = Math.max(...buckets.map((bucket) => bucket.count), 1);
  for (const bucket of buckets) {
    const row = createElement("div", "distribution-row");
    const label = createElement("span", "distribution-label", bucket.label);
    const bar = createElement("progress", "distribution-progress");
    bar.max = maximum;
    bar.value = bucket.count;
    bar.setAttribute("aria-label", `${bucket.label}：${bucket.count} 篇`);
    const count = createElement(
      "strong",
      "distribution-count",
      formatNumber(bucket.count),
    );
    row.append(label, bar, count);
    distributionList.append(row);
  }
}

function renderResults(
  kind: "zip" | "csv",
  fileSize: number,
  postCount: number,
  badges: readonly BadgeProgress[],
  near: readonly NearThresholdBucket[],
  distribution: readonly LikeDistributionBucket[],
): void {
  resultsSummary.textContent = `已读取 ${formatNumber(postCount)} 条帖子记录 · ${kind === "zip" ? "归档 ZIP" : "用户 CSV"} · ${formatBytes(fileSize)}`;
  badgeGrid.replaceChildren(...badges.map(renderBadgeCard));

  const admired = badges.find((badge) => badge.key === "admired");
  if (!admired) throw new Error("Missing admired badge rule");
  renderNearThreshold(near, admired);
  renderDistribution(distribution);

  resultsSection.hidden = false;
  resultsTitle.focus({ preventScroll: true });
  resultsSection.scrollIntoView({ behavior: preferredScrollBehavior() });
}

function preferredScrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

async function processFile(file: File): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;
  clearError();
  resultsSection.hidden = true;

  try {
    if (file.size > DEFAULT_PARSE_LIMITS.maxInputBytes) {
      throw new ArchiveParseError("FILE_TOO_LARGE", "所选文件过大");
    }

    setProcessing("正在读取本地文件…");
    await nextPaint();
    const data = await file.arrayBuffer();

    setProcessing(
      file.name.toLowerCase().endsWith(".zip")
        ? "正在浏览器内解压并查找帖子数据…"
        : "正在解析帖子数据…",
    );
    await nextPaint();
    const parsed = await parseDiscourseArchive({ name: file.name, data });

    setProcessing("正在计算徽章进度…");
    await nextPaint();
    const badges = calculateBadges(parsed.stats, BADGE_RULES);
    const admiredRule = BADGE_RULES.find((rule) => rule.key === "admired");
    if (!admiredRule) throw new Error("Missing admired badge rule");
    const near = getNearThresholdBuckets(
      parsed.stats,
      admiredRule.postLikeThreshold,
    );
    const distribution = getLikeDistribution(parsed.stats);
    renderResults(
      parsed.kind,
      file.size,
      parsed.stats.postCount,
      badges,
      near,
      distribution,
    );
  } catch (error) {
    showError(error);
  } finally {
    fileInput.value = "";
    clearProcessing();
    isProcessing = false;
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void processFile(file);
});

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (eventName === "dragenter") dragDepth += 1;
    dropZone.classList.add("is-dragging");
  });
}

dropZone.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(dragDepth - 1, 0);
  if (dragDepth === 0) dropZone.classList.remove("is-dragging");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropZone.classList.remove("is-dragging");
  const file = event.dataTransfer?.files[0];
  if (file) void processFile(file);
});

resetButton.addEventListener("click", () => {
  resultsSection.hidden = true;
  badgeGrid.replaceChildren();
  nearList.replaceChildren();
  distributionList.replaceChildren();
  resultsSummary.textContent = "";
  impactNote.textContent = "";
  clearError();
  dropZone.scrollIntoView({
    behavior: preferredScrollBehavior(),
    block: "center",
  });
  fileInput.focus();
});

void loadGitHubStarCount();
