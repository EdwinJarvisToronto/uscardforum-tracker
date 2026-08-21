export const ARCHIVE_ERROR_CODES = [
  "UNSUPPORTED_FILE",
  "FILE_TOO_LARGE",
  "INVALID_ZIP",
  "ZIP_TOO_MANY_ENTRIES",
  "CSV_NOT_FOUND",
  "AMBIGUOUS_CSV",
  "CSV_TOO_LARGE",
  "INVALID_UTF8",
  "INVALID_CSV",
  "MISSING_COLUMN",
  "DUPLICATE_COLUMN",
  "INVALID_LIKE_COUNT",
] as const;

export type ArchiveErrorCode = (typeof ARCHIVE_ERROR_CODES)[number];

export class ArchiveParseError extends Error {
  readonly code: ArchiveErrorCode;
  readonly details?: string;

  constructor(code: ArchiveErrorCode, message: string, details?: string) {
    super(message);
    this.name = "ArchiveParseError";
    this.code = code;
    this.details = details;
  }
}

export interface ArchiveInput {
  name: string;
  data: ArrayBuffer;
}

export interface ArchiveStats {
  postCount: number;
  likeHistogram: ReadonlyMap<number, number>;
}

export interface ParsedArchive {
  kind: "zip" | "csv";
  entryName?: string;
  stats: ArchiveStats;
}

export interface BadgeRule {
  key: string;
  name: string;
  type: "post_like_threshold";
  postLikeThreshold: number;
  target: number;
}

export interface BadgeProgress extends BadgeRule {
  current: number;
  remaining: number;
  isComplete: boolean;
  ratio: number;
  cappedRatio: number;
}

export interface LikeDistributionBucket {
  key: "zero" | "one" | "two" | "three" | "four" | "fivePlus";
  label: string;
  count: number;
}

export interface NearThresholdBucket {
  likeCount: number;
  count: number;
  likesNeeded: number;
}
