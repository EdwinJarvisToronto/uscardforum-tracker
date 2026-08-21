import JSZip from "jszip";
import Papa, {
  type ParseError,
  type Parser,
  type ParseStepResult,
} from "papaparse";

import {
  ArchiveParseError,
  type ArchiveInput,
  type ArchiveStats,
  type ParsedArchive,
} from "./types";

const USER_ARCHIVE_CSV = "user_archive.csv";
export const DEFAULT_PARSE_LIMITS = Object.freeze({
  maxInputBytes: 50 * 1024 * 1024,
  maxCsvBytes: 30 * 1024 * 1024,
  maxZipEntries: 1_000,
});

export interface ParseOptions {
  maxInputBytes?: number;
  maxCsvBytes?: number;
  maxZipEntries?: number;
}

interface ZipStreamHelper {
  on(event: "data", callback: (chunk: Uint8Array) => void): this;
  on(event: "error", callback: (error: Error) => void): this;
  on(event: "end", callback: () => void): this;
  pause(): this;
  resume(): this;
}

interface StreamableZipObject extends JSZip.JSZipObject {
  _data?: {
    uncompressedSize?: number;
  };
  internalStream(type: "uint8array"): ZipStreamHelper;
}

function normalizedLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function normalizeHeader(header: string): string {
  return header.replace(/^\uFEFF/, "").trim();
}

function csvErrorDetails(error: ParseError): string {
  const row = typeof error.row === "number" ? error.row + 1 : null;
  return row === null ? error.message : `第 ${row} 条记录：${error.message}`;
}

function decodeUtf8(data: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch (error) {
    throw new ArchiveParseError(
      "INVALID_UTF8",
      "user_archive.csv 不是有效的 UTF-8 文件",
      error instanceof Error ? error.message : undefined,
    );
  }
}

export function parseUserArchiveCsv(data: Uint8Array): ArchiveStats {
  const csvText = decodeUtf8(data);
  const headerProbe = Papa.parse<string[]>(csvText, {
    delimiter: ",",
    preview: 1,
    skipEmptyLines: false,
  });

  if (headerProbe.errors.length > 0) {
    throw new ArchiveParseError(
      "INVALID_CSV",
      "CSV 表头格式错误",
      csvErrorDetails(headerProbe.errors[0]),
    );
  }

  const header = (headerProbe.data[0] ?? []).map(normalizeHeader);
  const likeColumnCount = header.filter((column) => column === "like_count").length;
  if (likeColumnCount === 0) {
    throw new ArchiveParseError(
      "MISSING_COLUMN",
      "CSV 缺少 like_count 列",
      `检测到的列：${header.filter(Boolean).join(", ") || "无"}`,
    );
  }
  if (likeColumnCount > 1) {
    throw new ArchiveParseError(
      "DUPLICATE_COLUMN",
      "CSV 中有多个 like_count 列",
    );
  }

  const likeHistogram = new Map<number, number>();
  let processedRows = 0;
  let parseFailure: ArchiveParseError | undefined;

  Papa.parse<Record<string, string>>(csvText, {
    delimiter: ",",
    header: true,
    worker: false,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
    step(results: ParseStepResult<Record<string, string>>, parser: Parser) {
      if (parseFailure) {
        parser.abort();
        return;
      }

      const csvError = results.errors[0];
      if (csvError) {
        parseFailure = new ArchiveParseError(
          "INVALID_CSV",
          "CSV 内容格式错误",
          csvErrorDetails(csvError),
        );
        parser.abort();
        return;
      }

      const logicalRow = processedRows + 1;
      const rawLikeCount = String(results.data.like_count ?? "").trim();
      if (!/^\d+$/.test(rawLikeCount)) {
        parseFailure = new ArchiveParseError(
          "INVALID_LIKE_COUNT",
          "like_count 必须是非负整数",
          `第 ${logicalRow} 条记录的值为 ${JSON.stringify(rawLikeCount)}`,
        );
        parser.abort();
        return;
      }

      const likeCount = Number(rawLikeCount);
      if (!Number.isSafeInteger(likeCount)) {
        parseFailure = new ArchiveParseError(
          "INVALID_LIKE_COUNT",
          "like_count 超出安全整数范围",
          `第 ${logicalRow} 条记录`,
        );
        parser.abort();
        return;
      }

      likeHistogram.set(likeCount, (likeHistogram.get(likeCount) ?? 0) + 1);
      processedRows += 1;
    },
  });

  if (parseFailure) {
    throw parseFailure;
  }

  return {
    postCount: processedRows,
    likeHistogram,
  };
}

function entryBaseName(entryName: string): string {
  const normalized = entryName.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? normalized;
}

function concatChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function readZipEntry(
  entry: JSZip.JSZipObject,
  maxCsvBytes: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let settled = false;
    // JSZip exposes this browser stream helper at runtime, but omits it from
    // JSZipObject's public type declaration.
    const stream = (entry as StreamableZipObject).internalStream("uint8array");

    stream.on("data", (chunk: Uint8Array) => {
      if (settled) return;
      totalBytes += chunk.byteLength;
      if (totalBytes > maxCsvBytes) {
        settled = true;
        stream.pause();
        reject(
          new ArchiveParseError(
            "CSV_TOO_LARGE",
            "ZIP 中的 user_archive.csv 过大",
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    stream.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      reject(
        new ArchiveParseError(
          "INVALID_ZIP",
          "无法解压 user_archive.csv",
          error.message,
        ),
      );
    });
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(concatChunks(chunks, totalBytes));
    });
    stream.resume();
  });
}

export async function parseDiscourseArchive(
  input: ArchiveInput,
  options: ParseOptions = {},
): Promise<ParsedArchive> {
  const maxInputBytes = normalizedLimit(
    options.maxInputBytes,
    DEFAULT_PARSE_LIMITS.maxInputBytes,
  );
  const maxCsvBytes = normalizedLimit(
    options.maxCsvBytes,
    DEFAULT_PARSE_LIMITS.maxCsvBytes,
  );
  const maxZipEntries = normalizedLimit(
    options.maxZipEntries,
    DEFAULT_PARSE_LIMITS.maxZipEntries,
  );
  if (input.data.byteLength > maxInputBytes) {
    throw new ArchiveParseError("FILE_TOO_LARGE", "所选文件过大");
  }

  const lowerName = input.name.toLowerCase();
  if (lowerName.endsWith(".csv")) {
    if (input.data.byteLength > maxCsvBytes) {
      throw new ArchiveParseError("CSV_TOO_LARGE", "user_archive.csv 过大");
    }
    return {
      kind: "csv",
      stats: parseUserArchiveCsv(new Uint8Array(input.data)),
    };
  }
  if (!lowerName.endsWith(".zip")) {
    throw new ArchiveParseError(
      "UNSUPPORTED_FILE",
      "只支持 Discourse 归档 ZIP 或 user_archive.csv",
    );
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input.data);
  } catch (error) {
    throw new ArchiveParseError(
      "INVALID_ZIP",
      "ZIP 文件损坏、加密或格式不受支持",
      error instanceof Error ? error.message : undefined,
    );
  }

  const entries = Object.values(zip.files);
  if (entries.length > maxZipEntries) {
    throw new ArchiveParseError(
      "ZIP_TOO_MANY_ENTRIES",
      "ZIP 中的文件条目数量异常",
    );
  }

  const matches = entries.filter(
    (entry) => !entry.dir && entryBaseName(entry.name) === USER_ARCHIVE_CSV,
  );
  if (matches.length === 0) {
    throw new ArchiveParseError(
      "CSV_NOT_FOUND",
      "ZIP 中找不到 user_archive.csv",
    );
  }
  if (matches.length > 1) {
    throw new ArchiveParseError(
      "AMBIGUOUS_CSV",
      "ZIP 中有多个 user_archive.csv",
      "请解压后单独选择正确的 user_archive.csv",
    );
  }

  const entry = matches[0];
  const declaredSize = (entry as StreamableZipObject)._data?.uncompressedSize;
  if (typeof declaredSize === "number" && declaredSize > maxCsvBytes) {
    throw new ArchiveParseError(
      "CSV_TOO_LARGE",
      "ZIP 中的 user_archive.csv 过大",
    );
  }
  const csvData = await readZipEntry(entry, maxCsvBytes);
  return {
    kind: "zip",
    entryName: entry.name,
    stats: parseUserArchiveCsv(csvData),
  };
}
