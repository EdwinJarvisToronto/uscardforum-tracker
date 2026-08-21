#!/usr/bin/env python3
"""Calculate USCardForum badge progress from a Discourse user archive."""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable, Optional, Sequence, TextIO


DEFAULT_RULES_PATH = Path(__file__).with_name("badge_rules.json")
SUPPORTED_RULE_TYPE = "post_like_threshold"


class TrackerError(Exception):
    """An input error that can be shown directly to the user."""


@dataclass(frozen=True)
class BadgeRule:
    key: str
    name: str
    rule_type: str
    post_like_threshold: int
    target: int


@dataclass(frozen=True)
class ArchiveStats:
    source: str
    like_counts: tuple[int, ...]

    @property
    def post_count(self) -> int:
        return len(self.like_counts)


def _non_negative_int(value: object, field: str, rule_key: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise TrackerError(
            f"规则 {rule_key!r} 的 {field} 必须是非负整数，当前值为 {value!r}"
        )
    return value


def load_rules(path: Path) -> list[BadgeRule]:
    try:
        with path.open(encoding="utf-8") as file:
            raw_rules = json.load(file)
    except FileNotFoundError as exc:
        raise TrackerError(f"找不到徽章规则文件：{path}") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise TrackerError(f"无法读取徽章规则文件 {path}：{exc}") from exc

    if not isinstance(raw_rules, dict) or not raw_rules:
        raise TrackerError("徽章规则文件必须是一个非空 JSON 对象")

    rules: list[BadgeRule] = []
    for key, value in raw_rules.items():
        if not isinstance(key, str) or not isinstance(value, dict):
            raise TrackerError("每条徽章规则都必须使用字符串 ID 和 JSON 对象")

        name = value.get("name")
        rule_type = value.get("type")
        if not isinstance(name, str) or not name.strip():
            raise TrackerError(f"规则 {key!r} 缺少有效的 name")
        if rule_type != SUPPORTED_RULE_TYPE:
            raise TrackerError(
                f"规则 {key!r} 使用了不支持的类型：{rule_type!r}"
            )

        threshold = _non_negative_int(
            value.get("post_like_threshold"), "post_like_threshold", key
        )
        target = _non_negative_int(value.get("target"), "target", key)
        if target == 0:
            raise TrackerError(f"规则 {key!r} 的 target 必须大于 0")

        rules.append(
            BadgeRule(
                key=key,
                name=name.strip(),
                rule_type=rule_type,
                post_like_threshold=threshold,
                target=target,
            )
        )
    return rules


def _parse_user_archive(file: TextIO, source: str) -> ArchiveStats:
    # A long forum post can exceed csv's conservative default field limit.
    field_limit = sys.maxsize
    while True:
        try:
            csv.field_size_limit(field_limit)
            break
        except OverflowError:
            field_limit //= 10

    reader = csv.DictReader(file)
    if reader.fieldnames is None:
        raise TrackerError(f"CSV 是空文件：{source}")
    if "like_count" not in reader.fieldnames:
        columns = ", ".join(reader.fieldnames) or "（无）"
        raise TrackerError(
            f"CSV 缺少 like_count 列：{source}\n检测到的列：{columns}"
        )

    like_counts: list[int] = []
    try:
        for row_number, row in enumerate(reader, start=2):
            raw_value = row.get("like_count")
            try:
                like_count = int(raw_value) if raw_value is not None else -1
            except ValueError as exc:
                raise TrackerError(
                    f"{source} 第 {row_number} 条记录的 like_count 不是整数：{raw_value!r}"
                ) from exc
            if like_count < 0:
                raise TrackerError(
                    f"{source} 第 {row_number} 条记录的 like_count 无效：{raw_value!r}"
                )
            like_counts.append(like_count)
    except csv.Error as exc:
        raise TrackerError(f"CSV 格式错误（{source}）：{exc}") from exc

    return ArchiveStats(source=source, like_counts=tuple(like_counts))


def _csv_files_in_directory(path: Path) -> list[Path]:
    return sorted(
        candidate
        for candidate in path.rglob("user_archive.csv")
        if ".git" not in candidate.parts
    )


def _load_csv(path: Path) -> ArchiveStats:
    try:
        with path.open(encoding="utf-8-sig", newline="") as file:
            return _parse_user_archive(file, str(path))
    except UnicodeDecodeError as exc:
        raise TrackerError(f"CSV 不是有效的 UTF-8 文件：{path}") from exc
    except OSError as exc:
        raise TrackerError(f"无法读取 CSV {path}：{exc}") from exc


def _load_zip(path: Path) -> ArchiveStats:
    try:
        with zipfile.ZipFile(path) as archive:
            matches = [
                info
                for info in archive.infolist()
                if not info.is_dir()
                and PurePosixPath(info.filename).name == "user_archive.csv"
            ]
            if not matches:
                raise TrackerError(f"ZIP 中找不到 user_archive.csv：{path}")
            if len(matches) > 1:
                names = "、".join(info.filename for info in matches)
                raise TrackerError(f"ZIP 中有多个 user_archive.csv，无法确定应使用哪一个：{names}")

            member = matches[0]
            source = f"{path}!/{member.filename}"
            with archive.open(member) as binary_file:
                with io.TextIOWrapper(
                    binary_file, encoding="utf-8-sig", newline=""
                ) as text_file:
                    return _parse_user_archive(text_file, source)
    except zipfile.BadZipFile as exc:
        raise TrackerError(f"不是有效的 ZIP 文件：{path}") from exc
    except UnicodeDecodeError as exc:
        raise TrackerError(f"ZIP 中的 user_archive.csv 不是有效的 UTF-8 文件：{path}") from exc
    except OSError as exc:
        raise TrackerError(f"无法读取 ZIP {path}：{exc}") from exc


def load_archive(path: Path) -> ArchiveStats:
    path = path.expanduser()
    if not path.exists():
        raise TrackerError(f"找不到归档路径：{path}")
    if path.is_dir():
        matches = _csv_files_in_directory(path)
        if not matches:
            raise TrackerError(f"目录中找不到 user_archive.csv：{path}")
        if len(matches) > 1:
            names = "\n".join(f"  - {match}" for match in matches)
            raise TrackerError(
                f"目录中找到多个 user_archive.csv，请直接指定其中一个：\n{names}"
            )
        return _load_csv(matches[0])
    if path.suffix.lower() == ".zip":
        return _load_zip(path)
    if path.suffix.lower() == ".csv":
        return _load_csv(path)
    raise TrackerError("归档路径必须是目录、CSV 文件或 ZIP 文件")


def discover_archive(root: Path) -> Path:
    csv_candidates = _csv_files_in_directory(root)
    zip_candidates = sorted(
        candidate
        for candidate in root.rglob("user_archive-*.zip")
        if ".git" not in candidate.parts
    )
    candidates = csv_candidates + zip_candidates
    if not candidates:
        raise TrackerError(
            "当前目录中找不到归档。请传入解压目录、user_archive.csv 或归档 ZIP。"
        )
    return max(candidates, key=lambda candidate: candidate.stat().st_mtime)


def calculate_badge(like_counts: Iterable[int], rule: BadgeRule) -> int:
    if rule.rule_type != SUPPORTED_RULE_TYPE:
        raise TrackerError(f"不支持的徽章规则类型：{rule.rule_type}")
    return sum(
        like_count >= rule.post_like_threshold for like_count in like_counts
    )


def progress_bar(current: int, target: int, width: int = 24) -> str:
    ratio = min(current / target, 1.0)
    filled = min(width, int(ratio * width + 0.5))
    return "█" * filled + "░" * (width - filled)


def render_report(stats: ArchiveStats, rules: Sequence[BadgeRule], width: int) -> str:
    lines = [
        "USCardForum 徽章进度",
        f"数据源：{stats.source}",
        f"帖子记录：{stats.post_count:,}",
        "",
    ]
    for index, rule in enumerate(rules):
        current = calculate_badge(stats.like_counts, rule)
        percent = min(current / rule.target, 1.0)
        lines.append(rule.name)
        lines.append(
            f"[{progress_bar(current, rule.target, width)}] "
            f"{current:,} / {rule.target:,}  {percent:.1%}"
        )
        if current >= rule.target:
            lines.append(
                f"✓ 已达成：有 {current:,} 篇帖子获得至少 "
                f"{rule.post_like_threshold} 个赞"
            )
        else:
            remaining = rule.target - current
            lines.append(
                f"还差 {remaining:,} 篇点赞数 ≥ {rule.post_like_threshold} 的帖子"
            )
        if index != len(rules) - 1:
            lines.append("")
    return "\n".join(lines)


def positive_width(value: str) -> int:
    try:
        width = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("进度条宽度必须是整数") from exc
    if width <= 0:
        raise argparse.ArgumentTypeError("进度条宽度必须大于 0")
    return width


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="从 Discourse 用户归档统计 USCardForum 徽章进度"
    )
    parser.add_argument(
        "archive",
        nargs="?",
        type=Path,
        help="归档目录、user_archive.csv 或归档 ZIP；省略时自动查找",
    )
    parser.add_argument(
        "--rules",
        type=Path,
        default=DEFAULT_RULES_PATH,
        help=f"徽章规则 JSON（默认：{DEFAULT_RULES_PATH.name}）",
    )
    parser.add_argument(
        "--bar-width",
        type=positive_width,
        default=24,
        help="进度条字符宽度（默认：24）",
    )
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        archive_path = args.archive or discover_archive(Path.cwd())
        stats = load_archive(archive_path)
        rules = load_rules(args.rules)
        print(render_report(stats, rules, args.bar_width))
    except TrackerError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
