import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  parseDiscourseArchive,
  parseUserArchiveCsv,
} from "../src";

const encoder = new TextEncoder();

function csvBytes(csv: string): Uint8Array {
  return encoder.encode(csv);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

describe("parseUserArchiveCsv", () => {
  it("handles BOM, commas, quotes, and multiline post bodies", () => {
    const csv =
      '\uFEFFpost_id,post_raw,like_count\r\n1,"第一行, 有逗号\n第二行 ""有引号""",5\r\n2,普通内容,4\r\n';

    const stats = parseUserArchiveCsv(csvBytes(csv));

    expect(stats.postCount).toBe(2);
    expect(stats.likeHistogram.get(5)).toBe(1);
    expect(stats.likeHistogram.get(4)).toBe(1);
  });

  it("accepts a header-only archive", () => {
    const stats = parseUserArchiveCsv(csvBytes("post_id,like_count\n"));

    expect(stats.postCount).toBe(0);
    expect(stats.likeHistogram.size).toBe(0);
  });

  it("rejects a missing or duplicate like_count column", () => {
    expect(() => parseUserArchiveCsv(csvBytes("post_id,title\n1,test\n"))).toThrowError(
      expect.objectContaining({ code: "MISSING_COLUMN" }),
    );
    expect(() =>
      parseUserArchiveCsv(csvBytes("post_id,like_count,like_count\n1,2,3\n")),
    ).toThrowError(expect.objectContaining({ code: "DUPLICATE_COLUMN" }));
  });

  it.each(["", "-1", "5.0", "1e2", "nope", "9007199254740992"])(
    "rejects invalid like_count value %j",
    (value) => {
      const csv = `post_id,like_count,title\n1,${value},test\n`;

      expect(() => parseUserArchiveCsv(csvBytes(csv))).toThrowError(
        expect.objectContaining({ code: "INVALID_LIKE_COUNT" }),
      );
    },
  );
});

describe("parseDiscourseArchive", () => {
  it("parses a direct CSV", async () => {
    const data = toArrayBuffer(csvBytes("post_id,like_count\n1,5\n"));

    const parsed = await parseDiscourseArchive(
      { name: "USER_ARCHIVE.CSV", data },
      { maxInputBytes: data.byteLength, maxCsvBytes: data.byteLength },
    );

    expect(parsed.kind).toBe("csv");
    expect(parsed.stats.likeHistogram.get(5)).toBe(1);
  });

  it("finds a nested user_archive.csv without extracting other entries", async () => {
    const zip = new JSZip();
    zip.file("export/private/auth_tokens.csv", "secret");
    zip.file("export/data/user_archive.csv", "post_id,like_count\n1,7\n2,0\n");
    const data = await zip.generateAsync({ type: "arraybuffer" });

    const parsed = await parseDiscourseArchive({ name: "archive.zip", data });

    expect(parsed.kind).toBe("zip");
    expect(parsed.entryName).toBe("export/data/user_archive.csv");
    expect(parsed.stats.postCount).toBe(2);
  });

  it("rejects archives with zero or multiple matching CSV files", async () => {
    const emptyZip = await new JSZip()
      .file("readme.txt", "nothing here")
      .generateAsync({ type: "arraybuffer" });
    await expect(
      parseDiscourseArchive({ name: "archive.zip", data: emptyZip }),
    ).rejects.toMatchObject({ code: "CSV_NOT_FOUND" });

    const duplicateZip = new JSZip();
    duplicateZip.file("one/user_archive.csv", "post_id,like_count\n1,0\n");
    duplicateZip.file("two/user_archive.csv", "post_id,like_count\n2,0\n");
    const duplicateData = await duplicateZip.generateAsync({ type: "arraybuffer" });
    await expect(
      parseDiscourseArchive({ name: "archive.zip", data: duplicateData }),
    ).rejects.toMatchObject({ code: "AMBIGUOUS_CSV" });
  });

  it("accepts an uppercase ZIP extension", async () => {
    const zip = new JSZip();
    zip.file("user_archive.csv", "post_id,like_count\n1,5\n");
    const data = await zip.generateAsync({ type: "arraybuffer" });

    const parsed = await parseDiscourseArchive({ name: "ARCHIVE.ZIP", data });

    expect(parsed.kind).toBe("zip");
    expect(parsed.stats.postCount).toBe(1);
  });

  it("rejects bad ZIPs, unsupported files, and configured size overflows", async () => {
    const invalidData = toArrayBuffer(csvBytes("not a zip"));
    await expect(
      parseDiscourseArchive({ name: "archive.zip", data: invalidData }),
    ).rejects.toMatchObject({ code: "INVALID_ZIP" });
    await expect(
      parseDiscourseArchive({ name: "archive.txt", data: invalidData }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FILE" });
    await expect(
      parseDiscourseArchive(
        { name: "user_archive.csv", data: invalidData },
        { maxInputBytes: 4 },
      ),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("rejects a ZIP entry that exceeds the configured CSV limit", async () => {
    const zip = new JSZip();
    zip.file("user_archive.csv", "post_id,like_count\n1,5\n");
    const data = await zip.generateAsync({ type: "arraybuffer" });

    await expect(
      parseDiscourseArchive(
        { name: "archive.zip", data },
        { maxCsvBytes: 8 },
      ),
    ).rejects.toMatchObject({ code: "CSV_TOO_LARGE" });
  });

  it("rejects ZIPs with an abnormal number of entries", async () => {
    const zip = new JSZip();
    zip.file("one.txt", "1");
    zip.file("two.txt", "2");
    zip.file("user_archive.csv", "post_id,like_count\n1,5\n");
    const data = await zip.generateAsync({ type: "arraybuffer" });

    await expect(
      parseDiscourseArchive(
        { name: "archive.zip", data },
        { maxZipEntries: 2 },
      ),
    ).rejects.toMatchObject({ code: "ZIP_TOO_MANY_ENTRIES" });
  });
});
