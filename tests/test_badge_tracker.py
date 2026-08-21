import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

import badge_tracker


CSV_CONTENT = """post_id,post_raw,like_count\n1,hello,0\n2,world,5\n3,again,7\n"""


class ArchiveTests(unittest.TestCase):
    def test_parse_csv_handles_multiline_post_content(self):
        content = 'post_id,post_raw,like_count\n1,"first line\nsecond line",5\n2,ok,4\n'
        stats = badge_tracker._parse_user_archive(io.StringIO(content), "test.csv")

        self.assertEqual(stats.post_count, 2)
        self.assertEqual(stats.like_counts, (5, 4))

    def test_load_zip_without_extracting_it(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            archive_path = Path(temp_dir) / "archive.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("nested/user_archive.csv", CSV_CONTENT)

            stats = badge_tracker.load_archive(archive_path)

        self.assertEqual(stats.like_counts, (0, 5, 7))
        self.assertIn("nested/user_archive.csv", stats.source)

    def test_load_directory_finds_nested_csv_with_utf8_bom(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            archive_dir = root / "nested" / "archive"
            archive_dir.mkdir(parents=True)
            (archive_dir / "user_archive.csv").write_text(
                "\ufeff" + CSV_CONTENT, encoding="utf-8"
            )

            stats = badge_tracker.load_archive(root)

        self.assertEqual(stats.like_counts, (0, 5, 7))

    def test_header_only_archive_has_zero_posts(self):
        stats = badge_tracker._parse_user_archive(
            io.StringIO("post_id,like_count\n"), "test.csv"
        )

        self.assertEqual(stats.post_count, 0)

    def test_large_post_field_is_supported(self):
        content = f'post_id,post_raw,like_count\n1,"{"x" * 200_000}",5\n'

        stats = badge_tracker._parse_user_archive(io.StringIO(content), "test.csv")

        self.assertEqual(stats.like_counts, (5,))

    def test_missing_like_count_column_is_rejected(self):
        with self.assertRaisesRegex(badge_tracker.TrackerError, "缺少 like_count"):
            badge_tracker._parse_user_archive(
                io.StringIO("post_id,title\n1,hello\n"), "test.csv"
            )

    def test_invalid_like_count_is_rejected(self):
        with self.assertRaisesRegex(badge_tracker.TrackerError, "不是整数"):
            badge_tracker._parse_user_archive(
                io.StringIO("post_id,like_count\n1,nope\n"), "test.csv"
            )

    def test_multiple_csv_files_in_directory_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            for name in ("one", "two"):
                directory = root / name
                directory.mkdir()
                (directory / "user_archive.csv").write_text(
                    CSV_CONTENT, encoding="utf-8"
                )

            with self.assertRaisesRegex(badge_tracker.TrackerError, "多个"):
                badge_tracker.load_archive(root)


class RuleTests(unittest.TestCase):
    def test_load_rules_and_calculate_threshold(self):
        payload = {
            "admired": {
                "name": "受人敬仰",
                "type": "post_like_threshold",
                "post_like_threshold": 5,
                "target": 300,
            }
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            rules_path = Path(temp_dir) / "rules.json"
            rules_path.write_text(json.dumps(payload), encoding="utf-8")
            rules = badge_tracker.load_rules(rules_path)

        self.assertEqual(len(rules), 1)
        self.assertEqual(badge_tracker.calculate_badge([0, 4, 5, 8], rules[0]), 2)

    def test_progress_bar_and_percentage_are_capped_after_completion(self):
        rule = badge_tracker.BadgeRule(
            key="test",
            name="测试徽章",
            rule_type="post_like_threshold",
            post_like_threshold=1,
            target=2,
        )
        stats = badge_tracker.ArchiveStats("test.csv", (1, 2, 3))

        report = badge_tracker.render_report(stats, [rule], width=4)

        self.assertIn("[████] 3 / 2  100.0%", report)
        self.assertIn("✓ 已达成", report)


if __name__ == "__main__":
    unittest.main()
