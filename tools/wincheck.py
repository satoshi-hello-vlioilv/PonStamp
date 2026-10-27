"""Windows だけのコード（desktop/src の `#[cfg(windows)] mod imp`）を、Linux から Windows 向けに型と lint を確かめる（CLAUDE.md）。

    python tools/wincheck.py [作業フォルダ]

窓全体は Linux から Windows 向けに組めない（Tauri の作る前の準備が Windows の道具を要る）。そこで Windows の部分だけを、
desktop/Cargo.toml と同じ版・同じ機能の `windows` クレートだけに頼る小さな作業用クレートへ写し、
`cargo clippy --target x86_64-pc-windows-msvc -- -D warnings` を流す。先に `rustup target add x86_64-pc-windows-msvc` が要る。
"""
from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path

DESKTOP = Path(__file__).resolve().parents[1] / "desktop"
# Windows の部分を持つファイル（mod imp を #[cfg(windows)] で分けてある物）
FILES = ("lnk", "clip", "autostart", "proc", "shellmenu")
# 写した部分が使う ps_core の型の代わり
SHIM = ("pub mod ps_core { pub mod install { #[derive(Debug, Clone, PartialEq)] pub struct Link { "
        "pub target: std::path::PathBuf, pub workdir: std::path::PathBuf, pub icon: std::path::PathBuf } } }")


def make(dest: Path) -> None:
    cargo = (DESKTOP / "Cargo.toml").read_text(encoding="utf-8")
    dep = re.search(r"\[target\.'cfg\(windows\)'\.dependencies\]\n(windows = \{.*?\] \})", cargo, re.DOTALL)
    if not dep:
        raise SystemExit("desktop/Cargo.toml に Windows の部品（windows = {…}）が見つかりません")
    (dest / "src").mkdir(parents=True, exist_ok=True)
    (dest / "Cargo.toml").write_text(f'[package]\nname = "wincheck"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n{dep.group(1)}\n',
                                     encoding="utf-8")
    out = ["#![allow(dead_code)]", SHIM]
    for name in FILES:
        text = (DESKTOP / "src" / f"{name}.rs").read_text(encoding="utf-8")
        m = re.search(r"#\[cfg\(windows\)\]\nmod imp \{.*?\n\}\n", text, re.DOTALL)
        if not m:
            raise SystemExit(f"desktop/src/{name}.rs に #[cfg(windows)] mod imp が見つかりません")
        body = m.group(0).replace("#[cfg(windows)]\n", "").replace("use super::*;", "").replace("use ps_core::", "use crate::ps_core::")
        out.append(f"pub mod {name} {{\n{body}\n}}")
    (dest / "src" / "lib.rs").write_text("\n".join(out), encoding="utf-8")


def main() -> int:
    dest = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.gettempdir()) / "ponstamp-wincheck"
    make(dest)
    cmd = ["cargo", "clippy", "--target", "x86_64-pc-windows-msvc", "--", "-D", "warnings"]
    print(f"{dest}: {' '.join(cmd)}", flush=True)
    return subprocess.run(cmd, cwd=dest, check=False).returncode


if __name__ == "__main__":
    sys.exit(main())
