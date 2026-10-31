"""配る形と更新の通しを、本物の窓で確かめる（評価関数。LotScope の verify.py と同じ筋書き）。Windows の CI と、手元の Linux（xvfb-run の下）で流す。

    python tools/verify.py --exe <作った exe> [--work <作業フォルダ>] [--keep]

利用者の PC を真似る: 作業場所（PONSTAMP_LOCAL_ROOT）はまっさら、配る形は共有を真似たフォルダ、更新の置き場は BOX を真似たフォルダ。
窓は自己診断（PONSTAMP_SELFTEST）で起こし、結果のファイル（desktop/src/selftest.js と main.rs の selftest_finish が書く）を読む。

  1. 共有の exe を開く → この PC の app へ写り、版ごとの写しの窓で開く。使っている間に置き場の次の版（+1）を取り込む（ready）。ショートカットを尋ねる
  2. app の exe（ショートカットの行き先）を開く → 起動の最初に +1 へ入れ替わり、その版で開く。直前の版は控えに。共有を指すショートカットはこの PC の app に直る
  3. 閉じている間に次の版（+2）を置く → 1 回開くだけで +2 になる（起動の最初に取り込んで入れ替える）
  4. 閉じている間に起動できない版（+3）を置く → +3 に入れ替わるが画面が出ない。次に開くと控え（+2）へ戻り、+3 には印が付く（もう取り込まない）
  5. 配る版を前の版（+1）に戻す（distribute.json と配る入口）→ 1 回開くだけで配る版になり、配る版を作業場所に覚える（want.json）
  6. 新しい PC（まっさらな作業場所）が配る入口を開くだけで、配る版をこの PC へ入れて開き、入口の置き場を更新の置き場にする
  7. 古い版が常駐している間に、新しい版の exe（展開した ZIP）を開く → 古い窓は終わり、新しい版で開く
     （1 つだけ起動の仕組みで古い窓が前に出るだけだと、直した版に移れない。1.0・1.1 の利用者はこれで、止まる版から抜けられなかった）
  あわせて: 共有の配る形は 1 ファイルも変わらない・終わったあと窓が残らない。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bundle

WAIT = 120
WINDOWS = os.name == "nt"


def bump(v: str, n: int) -> str:
    a, b, c = (int(x) for x in v.split("."))
    return f"{a}.{b}.{c + n}"


def tree_digest(root: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(x for x in root.rglob("*") if x.is_file()):
        h.update(p.relative_to(root).as_posix().encode())
        h.update(p.read_bytes())
    return h.hexdigest()


def place(exe: Path, version: str, rel_root: Path, broken: bool = False) -> None:
    """版を ZIP にし、置き場の <アプリ>/versions/<版>/ に release.json と並べて置く（画面の「版を置く」と同じ形。broken: 起動できない版の真似）。"""
    name = bundle.brand()["name"]
    with tempfile.TemporaryDirectory(prefix="ps-place-") as tmp:
        bundle.build(exe, Path(tmp), version, {"selftest_broken": True} if broken else None)
        dest = rel_root / name / "versions" / version
        dest.mkdir(parents=True, exist_ok=True)
        for f in Path(tmp).iterdir():
            if f.is_file() and not f.name.endswith(".sha256"):
                shutil.copy2(f, dest / f.name)


def distribute(exe: Path, version: str, rel_root: Path) -> Path:
    """配る版を決める（desktop/src/distribute.rs の set_distributed と同じ形: distribute.json と配る入口の exe・名乗り）。→ 入口"""
    b = bundle.brand()
    folder = rel_root / b["name"]
    shutil.copy2(exe, folder / b["exe"])
    (folder / bundle.MANIFEST).write_text(json.dumps(bundle.manifest(b, version), ensure_ascii=False), encoding="utf-8")
    d = {"schema": 1, "app_id": b["app_id"], "version": version, "entry": b["exe"], "setAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
         "setBy": "verify", "setPc": "verify", "previous": None}
    (folder / "distribute.json").write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    return folder / b["exe"]


def make_link(link: Path, target: Path) -> None:
    """人が作った、共有の exe を指すショートカット（Windows は本物の .lnk、ほかは窓の lnk.rs と同じ JSON）。"""
    link.parent.mkdir(parents=True, exist_ok=True)
    if WINDOWS:
        ps = (f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{link}');$s.TargetPath='{target}';"
              f"$s.WorkingDirectory='{target.parent}';$s.Save()")
        subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True)
    else:
        link.write_text(json.dumps({"target": str(target), "workdir": str(target.parent), "icon": str(target)}), encoding="utf-8")


def link_target(link: Path) -> str:
    if WINDOWS:
        ps = f"(New-Object -ComObject WScript.Shell).CreateShortcut('{link}').TargetPath"
        return subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True, capture_output=True, text=True).stdout.strip()
    return json.loads(link.read_text(encoding="utf-8"))["target"]


class Run:
    def __init__(self, work: Path, root: Path):
        self.work, self.n = work, 0
        home = work / "home"
        home.mkdir(parents=True, exist_ok=True)
        self.links = [work / "links" / "Desktop", work / "links" / "Programs"]
        self.env = {**os.environ, "PONSTAMP_LOCAL_ROOT": str(root), "HOME": str(home), "USERPROFILE": str(home),
                    "PONSTAMP_LINK_DIRS": os.pathsep.join(str(x) for x in self.links), "PONSTAMP_AUTOSTART_DIR": str(work / "autostart")}
        self.env.pop("PONSTAMP_NO_HANDOFF", None)

    def open(self, exe: Path, label: str, wait: int = WAIT) -> dict | None:
        """exe を開き、自己診断の結果を待つ（入口・写し・開き直しの窓をたどった先の窓が書く）。結果が無ければ None。"""
        self.n += 1
        out = self.work / f"selftest-{self.n}-{label}.json"
        env = {**self.env, "PONSTAMP_SELFTEST": str(out)}
        subprocess.Popen([str(exe)], cwd=str(exe.parent), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        end = time.time() + wait
        while time.time() < end and not out.exists():
            time.sleep(0.5)
        time.sleep(2)    # 窓が終わるのを待つ
        if not out.exists():
            return None
        return json.loads(out.read_text(encoding="utf-8"))

    def start_resident(self, exe: Path, root: Path, wait: int = 60) -> list[str]:
        """exe を常駐の形（窓を出さない・自己診断なし）で起こし、版ごとの写しの窓が動き出すまで待つ。→ 動いている写し（pid exe）"""
        subprocess.Popen([str(exe), "--tray"], cwd=str(exe.parent), env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        end = time.time() + wait
        while time.time() < end:
            running = [x for x in leftovers(self.work) if os.path.normcase(str(root / "desktop")) in os.path.normcase(x)]
            if running:
                time.sleep(3)    # 窓が「1 つだけ起動」の受け口を開くまで
                return running
            time.sleep(0.5)
        return []


class Checks:
    def __init__(self):
        self.rows: list[tuple[bool, str, str]] = []

    def __call__(self, name: str, ok: bool, info: object = "") -> bool:
        self.rows.append((bool(ok), name, str(info)))
        print(f"{'PASS' if ok else 'FAIL'}: {name} -- {info}", flush=True)
        return bool(ok)

    @property
    def ok(self) -> bool:
        return all(r[0] for r in self.rows)


def shell(r: dict | None) -> dict:
    return (r or {}).get("shell") or {}


def processes() -> list[tuple[int, str]]:
    """動いているこのアプリの exe（pid, exe の場所）。Linux は /proc、Windows は Win32_Process。"""
    if WINDOWS:
        ps = (f"Get-CimInstance Win32_Process -Filter \"Name='{bundle.brand()['exe']}'\" | "
              "ForEach-Object { \"$($_.ProcessId) $($_.ExecutablePath)\" }")
        out = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True, check=False).stdout
        rows = [line.strip().split(" ", 1) for line in out.splitlines() if line.strip()]
        return [(int(r[0]), r[1] if len(r) > 1 else "") for r in rows if r[0].isdigit()]
    found = []
    for pid in filter(str.isdigit, os.listdir("/proc")):
        try:
            found.append((int(pid), os.readlink(f"/proc/{pid}/exe")))
        except OSError:
            continue
    return found


def leftovers(work: Path) -> list[str]:
    """作業フォルダの下の exe がまだ動いているか（"pid exe の場所"）。"""
    return [f"{pid} {exe}" for pid, exe in processes() if os.path.normcase(exe).startswith(os.path.normcase(str(work)))]


def kill(rows: list[str]) -> None:
    """残った窓を終わらせる（確かめが失敗したときの片付け。次の確かめに残さない）。"""
    for row in rows:
        pid = int(row.split()[0])
        if WINDOWS:
            subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, check=False)
        else:
            try:
                os.kill(pid, 9)
            except OSError:
                pass


def run(exe: Path, work: Path) -> bool:
    b = bundle.brand()
    v = bundle.app_version()
    check = Checks()
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    share, rel, root = work / "share" / b["name"], work / "Releases", work / "root"
    bundle.stage(exe, share, v)
    share_digest = tree_digest(share)
    place(exe, bump(v, 1), rel)
    root.mkdir(parents=True)
    (root / "state.json").write_text(json.dumps({"updateSource": str(rel)}), encoding="utf-8")
    r = Run(work, root)
    app_exe = root / "app" / b["exe"]

    # 1. 共有の exe を開く
    r1 = r.open(share / b["exe"], "share")
    s = shell(r1)
    check("1 共有の exe からこの PC へ写して開く", s.get("installed") and s.get("version") == v and str(root / "desktop") in str(s.get("exe")), s)
    check("1 画面の自己診断が通る", r1 and r1.get("ok"), [x for x in (r1 or {}).get("results", []) if not x["ok"]])
    check("1 使っている間に次の版を取り込む", s.get("update", {}).get("state") == "ready" and s["update"].get("ready") == bump(v, 1), s.get("update"))
    check("1 ショートカットを尋ねる", s.get("install", {}).get("shortcut", {}).get("ask") is True, s.get("install"))
    make_link(r.links[0] / f"{b['name']}.lnk", share / b["exe"])

    # 2. app の exe を開く → 入れ替わる
    s = shell(r.open(app_exe, "apply"))
    check("2 開き直すと取り込んだ版になる", s.get("version") == bump(v, 1), s.get("version"))
    old = json.loads((root / "update" / "old" / "app.json").read_text(encoding="utf-8"))
    check("2 直前の版は控えに残す", old.get("version") == v, old)
    check("2 共有を指すショートカットをこの PC の app に直す", Path(link_target(r.links[0] / f"{b['name']}.lnk")).resolve() == app_exe.resolve(),
          link_target(r.links[0] / f"{b['name']}.lnk"))

    # 3. 閉じている間に +2 を置く → 1 回開くだけで入る
    place(exe, bump(v, 2), rel)
    s = shell(r.open(app_exe, "launch"))
    check("3 閉じている間に置いた版に 1 回の起動で入れ替わる", s.get("version") == bump(v, 2), s.get("version"))

    # 4. 起動できない版（+3）
    place(exe, bump(v, 3), rel, broken=True)
    first = r.open(app_exe, "broken", wait=40)
    check("4 起動できない版では画面が出ない（結果を書かない）", first is None, shell(first).get("version"))
    s = shell(r.open(app_exe, "revert"))
    check("4 次に開くと控えの版へ戻る", s.get("version") == bump(v, 2), s.get("version"))
    check("4 起動できなかった版には印を付け、もう取り込まない", bump(v, 3) in s.get("update", {}).get("failed", []) and s["update"].get("state") != "ready",
          s.get("update"))

    # 5. 配る版を +1 に戻す
    entry = distribute(exe, bump(v, 1), rel)
    s = shell(r.open(app_exe, "rollback"))
    want = json.loads((root / "want.json").read_text(encoding="utf-8")) if (root / "want.json").exists() else {}
    check("5 配る版を戻すと、1 回開くだけで配る版になる", s.get("version") == bump(v, 1), s.get("version"))
    check("5 配る版を作業場所に覚える", want.get("version") == bump(v, 1), want)

    # 6. 新しい PC: 配る入口を開くだけ
    root2 = work / "root-new"
    r2 = Run(work, root2)
    s = shell(r2.open(entry, "entry"))
    check("6 新しい PC が配る入口から配る版を入れて開く", s.get("installed") and s.get("version") == bump(v, 1), s)
    check("6 入口の置き場を更新の置き場にする", str(entry.parent) in str(s.get("source")), s.get("source"))

    # 7. 古い版が常駐している間に、新しい版の exe を開く
    root3 = work / "root-resident"
    r3 = Run(work, root3)
    old_running = r3.start_resident(share / b["exe"], root3)
    check("7 古い版が常駐している", old_running, old_running)
    newer = bundle.stage(exe, work / "unzipped" / b["name"], bump(v, 4))
    s = shell(r3.open(newer / b["exe"], "supersede"))
    check("7 新しい版の exe を開くと、新しい版で開く（古い窓が前に出るだけにならない）", s.get("version") == bump(v, 4), s.get("version"))
    still = [x for x in leftovers(work) if any(x.split()[0] == o.split()[0] for o in old_running)]
    check("7 古い版の窓は終わる", not still, still)
    kill(still)

    check("共有の配る形は 1 ファイルも変わらない", tree_digest(share) == share_digest)
    time.sleep(2)
    check("終わったあと窓が残らない", not leftovers(work), leftovers(work))
    return check.ok


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--exe", required=True, type=Path)
    ap.add_argument("--work", type=Path, default=Path(tempfile.gettempdir()) / "ponstamp-verify")
    ap.add_argument("--keep", action="store_true", help="作業フォルダを残す（記録を読むため）")
    a = ap.parse_args(argv)
    ok = run(a.exe.resolve(), a.work.resolve())
    for log in sorted(a.work.rglob("app.log")):
        print(f"--- {log}\n" + "".join(log.read_text(encoding="utf-8").splitlines(True)[-40:]))
    if not a.keep and ok:
        shutil.rmtree(a.work, ignore_errors=True)
    print("通し: " + ("OK" if ok else "FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
