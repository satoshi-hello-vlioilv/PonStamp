"""版の管理（app/version.json・tools/release.py）。版を上げずに配る物を変えることを止める。失敗したら、表示された手順で版を上げて記録し直す。"""
import importlib.util
import json
import re
import unittest
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("release", REPO / "tools" / "release.py")
release = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(release)

INFO = release.read_version()
HOW = ("app/version.json の version を上げて changelog の先頭に 1 件足し、`python tools/release.py --release` で記録してください"
       "（まだ配っていない版を直しただけなら `python tools/release.py --amend`）。")


class Changelog(unittest.TestCase):
    def test_head_is_the_app_version(self):
        self.assertRegex(INFO["version"], r"^\d+\.\d+\.\d+$")
        self.assertEqual(INFO["changelog"][0]["version"], INFO["version"], "changelog の先頭にいまの版の 1 件を足してください")

    def test_newest_first_and_filled(self):
        keys = [release.version_key(e["version"]) for e in INFO["changelog"]]
        self.assertEqual(keys, sorted(keys, reverse=True), "新しい版を上に")
        self.assertEqual(len(keys), len(set(keys)), "同じ版が 2 つある")
        dates = [date.fromisoformat(e["date"]) for e in INFO["changelog"]]
        self.assertEqual(dates, sorted(dates, reverse=True))
        for e in INFO["changelog"]:
            self.assertTrue(e["notes"] and all(n.strip() for n in e["notes"]), e["version"])


class Release(unittest.TestCase):
    def test_contents_match_the_recorded_release(self):
        rec = INFO["release"]
        self.assertEqual(rec["version"], INFO["version"], f"版 {INFO['version']} がまだ記録されていません。{HOW}")
        self.assertEqual(rec["digest"], release.release_digest(), f"版 {INFO['version']} を記録したあとに中身が変わっています。{HOW}")

    def test_digest_covers_what_is_shipped(self):
        files = release.release_files()
        self.assertNotIn("app/version.json", files, "release を書くと要約が変わってしまう")
        for must in ("app/index.html", "app/js/app.js", "app/brand.json", "desktop/src/main.rs", "desktop/Cargo.toml", "desktop/tauri.conf.json"):
            self.assertIn(must, files)
        self.assertFalse(any(k.startswith(("tests/", "tools/", "docs/")) or k.endswith(".md") for k in files), "説明・試験・道具は含めない")

    def test_build_files_carry_the_same_version(self):
        cargo = re.search(r'^version = "([^"]+)"', (REPO / "desktop" / "Cargo.toml").read_text(encoding="utf-8"), re.MULTILINE).group(1)
        conf = json.loads((REPO / "desktop" / "tauri.conf.json").read_text(encoding="utf-8"))["version"]
        self.assertEqual((cargo, conf), (INFO["version"],) * 2, "desktop/Cargo.toml と tauri.conf.json の version を app/version.json にそろえる（--release がそろえる）")

    def test_digest_ignores_line_endings_and_build_versions(self):
        """改行が CRLF になっても・--release が Cargo.toml の版を書き換えても、要約は変わらない。"""
        import shutil
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp)
            for rel, p in release.release_files().items():
                (copy / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(p, copy / rel)
            before = release.release_digest(copy)
            main = copy / "app" / "js" / "app.js"
            main.write_bytes(main.read_bytes().replace(b"\n", b"\r\n"))
            release.sync_build_versions("99.0.0", copy)
            self.assertEqual(release.release_digest(copy), before)
            main.write_bytes(main.read_bytes() + b"// x")
            self.assertNotEqual(release.release_digest(copy), before, "中身が変われば要約も変わる")


if __name__ == "__main__":
    unittest.main()
