"""配る ZIP の組み立て（tools/bundle.py）: release.json・名乗りの形（desktop/src の release.rs・update.rs が読む形）・名前の断り方・ZIP の中の並び。"""
import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))
_spec = importlib.util.spec_from_file_location("bundle", TOOLS / "bundle.py")
bundle = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bundle)


class Bundle(unittest.TestCase):
    def test_release_json_matches_what_the_window_reads(self):
        b = bundle.brand()
        r = bundle.release_json(b, "1.9.0", f"{b['name']}-1.9.0-windows.zip", "a" * 64)
        self.assertEqual(set(r), {"schema", "app_id", "name", "version", "zip", "sha256", "exe"})
        self.assertEqual((r["schema"], r["app_id"], r["exe"]), (1, b["app_id"], b["exe"]))
        for bad in ("../x.zip", "a/b.zip", "a\\b.zip", "C:x.zip", " x.zip", ".."):
            with self.assertRaises(SystemExit, msg=bad):
                bundle.release_json(b, "1.9.0", bad, "a" * 64)

    def test_manifest_names_the_app(self):
        b = bundle.brand()
        self.assertEqual(bundle.manifest(b, "1.2.3"), {"app_id": b["app_id"], "name": b["name"], "exe": b["exe"], "version": "1.2.3"})

    def test_build_makes_one_top_folder_with_exe_manifest_and_readme(self):
        b = bundle.brand()
        with tempfile.TemporaryDirectory() as tmp:
            exe = Path(tmp) / "built.exe"
            exe.write_bytes(b"MZ-fake")
            out = Path(tmp) / "out"
            s = bundle.build(exe, out, "2.0.0")
            z = zipfile.ZipFile(s["path"])
            self.assertEqual(sorted(z.namelist()), sorted(f"{b['name']}/{n}" for n in (b["exe"], "app.json", "README.md")))
            self.assertEqual(json.loads(z.read(f"{b['name']}/app.json"))["version"], "2.0.0", "名乗りの版 = 置き場の版")
            rel = json.loads((out / "release.json").read_text(encoding="utf-8"))
            self.assertEqual((rel["version"], rel["sha256"]), ("2.0.0", bundle.sha256_file(Path(s["path"]))))
            self.assertTrue((out / f"{rel['zip']}.sha256").read_text(encoding="ascii").startswith(rel["sha256"]))
            self.assertFalse((out / "stage").exists(), "途中の物を残さない")

    def test_release_notes_need_the_changelog_entry(self):
        rel = {"version": bundle.app_version(), "zip": "x.zip", "sha256": "a" * 64, "exe": "PonStamp.exe"}
        notes = bundle.release_notes(rel, bundle.changelog())
        self.assertIn(f"## 版 {rel['version']}", notes)
        self.assertIn("この版を配る", notes)
        with self.assertRaises(SystemExit):
            bundle.release_notes({**rel, "version": "9.9.9"}, bundle.changelog())


if __name__ == "__main__":
    unittest.main()
