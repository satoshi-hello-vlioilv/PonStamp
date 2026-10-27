"""版の上げ忘れを止める（LotScope の app_build.py と同じ考え）。

配る物（画面 app/・窓 desktop/）の中身の要約を app/version.json の release に記録しておき、tests/test_version.py が
いまの中身と比べる。版を上げずに中身を変えると試験が失敗して、直し方を言う。

    python tools/release.py            いまの要約を出す
    python tools/release.py --release  版を上げて更新履歴を足したあとに、記録する（版が上がっていない・履歴の先頭が今の版でなければ断る）
    python tools/release.py --amend    まだ配っていない版を直しただけのとき、版はそのままで要約だけ書き直す

release は手で書かない。desktop/Cargo.toml・desktop/tauri.conf.json の version もこの版にそろえる（--release が書き換える）。
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
VERSION_FILE = REPO / "app" / "version.json"
# 配る物: 画面と窓の作り（説明・試験・作業の物は含めない）。version.json 自身も含めない（release を書くと要約が変わるため）
RELEASE_GLOBS = ("app/**/*", "desktop/src/**/*", "desktop/capabilities/*", "desktop/build.rs", "desktop/Cargo.toml", "desktop/Cargo.lock",
                 "desktop/tauri.conf.json")
RELEASE_SKIP = {"app/version.json"}


def version_key(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in v.split("."))


def release_files(repo: Path = REPO) -> dict[str, Path]:
    out = {}
    for pattern in RELEASE_GLOBS:
        for p in repo.glob(pattern):
            if not p.is_file() or "__pycache__" in p.parts:
                continue
            rel = p.relative_to(repo).as_posix()
            if rel not in RELEASE_SKIP:
                out[rel] = p
    return dict(sorted(out.items()))


def release_digest(repo: Path = REPO) -> str:
    """配る物の中身の要約（16 桁）。改行は LF にそろえる（Windows で取り出して CRLF になっても同じ要約）。
    Cargo.toml・tauri.conf.json・Cargo.lock の自分の version の行は除く（--release が版をそろえて書き換えても、要約が変わらないように）。"""
    h = hashlib.sha256()
    for rel, p in release_files(repo).items():
        body = p.read_bytes().replace(b"\r\n", b"\n")
        if rel in ("desktop/Cargo.toml", "desktop/tauri.conf.json"):
            body = re.sub(rb'(?m)^(version = |  "version": )"[^"]*"', rb"\1", body, count=1)
        elif rel == "desktop/Cargo.lock":
            body = re.sub(rb'(name = "ponstamp-desktop"\nversion = )"[^"]*"', rb"\1", body, count=1)
        h.update(rel.encode("utf-8") + b"\0" + body + b"\0")
    return h.hexdigest()[:16]


def read_version(path: Path = VERSION_FILE) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def sync_build_versions(version: str, repo: Path = REPO) -> None:
    """desktop/Cargo.toml と tauri.conf.json の version をそろえる（Cargo.lock の自分の版も）。"""
    cargo = repo / "desktop" / "Cargo.toml"
    text = cargo.read_text(encoding="utf-8")
    cargo.write_text(re.sub(r'(?m)^version = "[^"]*"', f'version = "{version}"', text, count=1), encoding="utf-8")
    conf = repo / "desktop" / "tauri.conf.json"
    text = conf.read_text(encoding="utf-8")
    conf.write_text(re.sub(r'(?m)^  "version": "[^"]*"', f'  "version": "{version}"', text, count=1), encoding="utf-8")
    lock = repo / "desktop" / "Cargo.lock"
    if lock.is_file():
        text = lock.read_text(encoding="utf-8")
        lock.write_text(re.sub(r'(name = "ponstamp-desktop"\nversion = )"[^"]*"', rf'\1"{version}"', text, count=1), encoding="utf-8")


def record_release(repo: Path = REPO, amend: bool = False) -> str:
    """release を書く。版を上げずに中身だけ変えた記録は作らない（上げ忘れを止めるための仕組みなので）。"""
    path = repo / "app" / "version.json"
    v = read_version(path)
    cur, rel = v["version"], v["release"]
    if v["changelog"][0]["version"] != cur:
        raise SystemExit(f"更新履歴（changelog）の先頭が版 {cur} ではありません。先頭に {cur} の 1 件を足してください。")
    sync_build_versions(cur, repo)
    digest = release_digest(repo)
    if rel["version"] == cur and rel["digest"] == digest:
        return f"記録済みです（{cur}・{digest}）。"
    if rel["version"] == cur and rel["digest"] and not amend:
        raise SystemExit(f"版 {cur} は記録済みで、そのあと中身が変わっています。版を上げて（app/version.json の version と changelog の先頭）から"
                         f"もう一度。まだ配っていない {cur} を直しただけなら --amend。")
    if version_key(cur) < version_key(rel["version"]):
        raise SystemExit(f"版 {cur} が、記録済みの {rel['version']} より古くなっています。")
    text = path.read_text(encoding="utf-8")
    new, n = re.subn(r'"release": \{[^}]*\}', f'"release": {{"version": "{cur}", "digest": "{digest}"}}', text, count=1)
    if n != 1:
        raise SystemExit("app/version.json に release の行が見つかりません。")
    path.write_text(new, encoding="utf-8")
    return f"記録しました: {cur}・{digest}"


if __name__ == "__main__":
    if "--release" in sys.argv or "--amend" in sys.argv:
        print(record_release(amend="--amend" in sys.argv))
    else:
        print(f"配る物の要約 {release_digest()}（{len(release_files())} ファイル）")
