"""配る ZIP を組み立てる（LotScope と同じ形。仕組みは docs/DESIGN.md の「配布と更新」）。

    python tools/bundle.py brand <項目>                    名前の定義（app/brand.json）の値を出す（CI が名前を書き写さない）
    python tools/bundle.py version                         版（app/version.json）を出す（Releases の札 v<版> に使う）
    python tools/bundle.py build --exe <exe> --out <出力先> 配る ZIP と release.json・.sha256 を作る
    python tools/bundle.py notes --release <release.json>  GitHub Releases の説明（その版の更新履歴・配り方・指紋）を出す

配る形（ZIP の中。先頭のフォルダはアプリ名）:
    <name>/<exe>        窓（Rust）。画面（app/）は exe に入っている
    <name>/app.json     名乗り {app_id, name, exe, version}（取り込む側 desktop/src/update.rs が中身を確かめる）
    <name>/README.md

Python も部品も同梱しない（exe 1 つで動く）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
APP = REPO / "app"
MAX_BYTES = 1 << 30          # 取り込む側（desktop/src/update.rs）が断る大きさ
MANIFEST = "app.json"


def brand() -> dict:
    return {k: v for k, v in json.loads((APP / "brand.json").read_text(encoding="utf-8")).items() if not k.startswith("_")}


def version_info(app: Path = APP) -> dict:
    return json.loads((app / "version.json").read_text(encoding="utf-8"))


def app_version(app: Path = APP) -> str:
    return version_info(app)["version"]


def changelog(app: Path = APP) -> list[dict]:
    """更新履歴（新しい版が先）。"""
    return version_info(app)["changelog"]


def safe_name(name: str) -> bool:
    """release.json の zip・exe は 1 つの名前（区切り・..・ドライブ名を含まない）。desktop/src/release.rs の safe_name と同じ決まり。"""
    return bool(name) and name not in (".", "..") and not any(c in name for c in "/\\:") and name == name.strip()


def manifest(b: dict, version: str) -> dict:
    """配る形の名乗り（desktop/src/update.rs の validate_dist が読む）。"""
    return {"app_id": b["app_id"], "name": b["name"], "exe": b["exe"], "version": version}


def release_json(b: dict, version: str, zip_name: str, sha: str) -> dict:
    """版のフォルダの目印（desktop/src/release.rs が読む形・schema 1）。"""
    if not (safe_name(zip_name) and safe_name(b["exe"])):
        raise SystemExit(f"名前に使えない文字があります: {zip_name} / {b['exe']}")
    return {"schema": 1, "app_id": b["app_id"], "name": b["name"], "version": version, "zip": zip_name, "sha256": sha, "exe": b["exe"]}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def zip_dir(root: Path, top: str, out: Path) -> int:
    """root の中身を top/… として ZIP にする（並びは名前順・実行の許可を残す）。→ ファイルの数"""
    files = sorted(p for p in root.rglob("*") if p.is_file())
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in files:
            z.write(p, f"{top}/{p.relative_to(root).as_posix()}")
    return len(files)


def stage(exe: Path, dest: Path, version: str | None = None, extra: dict | None = None) -> Path:
    """配る形のフォルダを作る（exe・名乗り・README）。version・extra は通しの確かめ（verify.py）が版を変えた形を作るため。"""
    b = brand()
    shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True)
    shutil.copy2(exe, dest / b["exe"])
    m = {**manifest(b, version or app_version()), **(extra or {})}
    (dest / MANIFEST).write_text(json.dumps(m, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    shutil.copy2(REPO / "README.md", dest / "README.md")
    return dest


def build(exe: Path, out: Path, version: str | None = None, extra: dict | None = None) -> dict:
    b = brand()
    version = version or app_version()
    out.mkdir(parents=True, exist_ok=True)
    top = stage(exe, out / "stage" / b["name"], version, extra)
    zip_name = f"{b['name']}-{version}-windows.zip"
    zpath = out / zip_name
    n = zip_dir(top, b["name"], zpath)
    shutil.rmtree(out / "stage", ignore_errors=True)
    if zpath.stat().st_size > MAX_BYTES:
        raise SystemExit("配る ZIP が 1 GB を超えました（取り込む側が断ります）")
    sha = sha256_file(zpath)
    rel = release_json(b, version, zip_name, sha)
    (out / "release.json").write_text(json.dumps(rel, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (out / f"{zip_name}.sha256").write_text(f"{sha}  {zip_name}\n", encoding="ascii")
    summary = {**rel, "path": str(zpath), "files": n, "bytes": zpath.stat().st_size}
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    return summary


def release_notes(rel: dict, history: list[dict]) -> str:
    """GitHub Releases の説明（Markdown）。その版の更新履歴・配り方（README の「配る人」と同じ言葉）・指紋。"""
    entry = next((e for e in history if e["version"] == rel["version"]), None)
    if entry is None:
        raise SystemExit(f"更新履歴（app/version.json の changelog）に版 {rel['version']} がありません")
    lines = [f"## 版 {rel['version']}（{entry['date']}）", "", "### 変わったこと", *[f"- {n}" for n in entry["notes"]], "",
             "### 配り方", "",
             f"1. 下の `{rel['zip']}` を取ります（`release.json`・`.sha256` も同じ版の物です）。",
             ("2. アプリの「設定」→「配布（配る人）」→「ZIP から版を置く…」で選ぶと、中身を確かめてから置き場に版のフォルダを作ります。"
              "置いただけでは配りません。"),
             "3. 試してから、一覧の「この版を配る」を押します。各 PC は起動したとき・30 分ごとに確かめ、開き直したときにこの版になります。",
             "", "はじめて使う PC には、置き場の配る入口（`" + rel["exe"] + "`）のアドレスを渡します。開くだけでその PC に入ります。", "",
             f"指紋（SHA-256）: `{rel['sha256']}`", ""]
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("brand")
    s.add_argument("key")
    sub.add_parser("version")
    s = sub.add_parser("build")
    s.add_argument("--exe", required=True, type=Path)
    s.add_argument("--out", required=True, type=Path)
    s = sub.add_parser("notes")
    s.add_argument("--release", required=True, type=Path)
    a = ap.parse_args(argv)
    if a.cmd == "brand":
        print(brand()[a.key])
    elif a.cmd == "version":
        print(app_version())
    elif a.cmd == "notes":
        print(release_notes(json.loads(a.release.read_text(encoding="utf-8")), changelog()), end="")
    else:
        build(a.exe, a.out)


if __name__ == "__main__":
    main()
