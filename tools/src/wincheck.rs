//! Windows だけのコード（desktop/src の `#[cfg(windows)] mod imp`）を、Linux から Windows 向けに型と lint を確かめる（CLAUDE.md）。
//!
//! ```text
//! cargo tools wincheck [作業フォルダ]
//! ```
//! 窓全体は Linux から Windows 向けに組めない（Tauri の作る前の準備が Windows の道具を要る）。そこで Windows の部分だけを、
//! desktop/Cargo.toml と同じ版・同じ機能の `windows` クレートだけに頼る小さな作業用クレートへ写し、
//! `cargo clippy --target x86_64-pc-windows-msvc -- -D warnings` を流す。先に `rustup target add x86_64-pc-windows-msvc` が要る。

use std::path::Path;
use std::process::Command;

/// Windows の部分を持つファイル（mod imp を #[cfg(windows)] で分けてある物）
const FILES: &[&str] = &["lnk", "clip", "autostart", "proc", "shellmenu"];
/// 写した部分が使う ps_core の型の代わり
const SHIM: &str = "pub mod ps_core { pub mod install { #[derive(Debug, Clone, PartialEq)] pub struct Link { \
                    pub target: std::path::PathBuf, pub workdir: std::path::PathBuf, pub icon: std::path::PathBuf } } }";
const IMP: &str = "#[cfg(windows)]\nmod imp {";

/// desktop/Cargo.toml の Windows の部品の行（windows = { … ] }）
fn windows_dep(cargo: &str) -> Option<&str> {
    let head = "[target.'cfg(windows)'.dependencies]\n";
    let start = cargo.find(head)? + head.len();
    let rest = &cargo[start..];
    let end = rest.find("] }")? + 3;
    rest[..end].starts_with("windows = {").then(|| &rest[..end])
}

/// ファイルの `#[cfg(windows)] mod imp { … }`（行頭の `}` で閉じる所まで）
fn windows_imp(text: &str) -> Option<&str> {
    let start = text.find(IMP)?;
    let end = text[start..].find("\n}\n")? + start + 3;
    Some(&text[start..end])
}

/// 作業用クレートを dest に作る
pub fn make(repo: &Path, dest: &Path) -> Result<(), String> {
    let desktop = repo.join("desktop");
    // 改行を LF にそろえてから探す（Windows の取り出しは CRLF）
    let cargo = crate::repo::read_text(&desktop.join("Cargo.toml"))?.0;
    let dep = windows_dep(&cargo).ok_or("desktop/Cargo.toml に Windows の部品（windows = {…}）が見つかりません")?;
    std::fs::create_dir_all(dest.join("src")).map_err(|e| e.to_string())?;
    // 作業用クレートは、上にあるワークスペースに入らない（[workspace] を自分で持つ）
    std::fs::write(
        dest.join("Cargo.toml"),
        format!("[package]\nname = \"wincheck\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[workspace]\n\n[dependencies]\n{dep}\n"),
    )
    .map_err(|e| e.to_string())?;
    let mut out = vec!["#![allow(dead_code)]".to_string(), SHIM.to_string()];
    for name in FILES {
        let text = crate::repo::read_text(&desktop.join("src").join(format!("{name}.rs")))?.0;
        let body = windows_imp(&text).ok_or(format!("desktop/src/{name}.rs に #[cfg(windows)] mod imp が見つかりません"))?;
        let body = body.replacen("#[cfg(windows)]\n", "", 1).replace("use super::*;", "").replace("use ps_core::", "use crate::ps_core::");
        out.push(format!("pub mod {name} {{\n{body}\n}}"));
    }
    std::fs::write(dest.join("src").join("lib.rs"), out.join("\n")).map_err(|e| e.to_string())
}

/// 作って clippy を流す。→ clippy の終了コード
pub fn run(repo: &Path, dest: &Path) -> Result<i32, String> {
    make(repo, dest)?;
    let args = ["clippy", "--target", "x86_64-pc-windows-msvc", "--", "-D", "warnings"];
    println!("{}: cargo {}", dest.display(), args.join(" "));
    let status = Command::new("cargo").args(args).current_dir(dest).status().map_err(|e| format!("cargo を動かせません: {e}"))?;
    Ok(status.code().unwrap_or(1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_each_windows_part_and_the_same_windows_crate() {
        let dest = crate::repo::temp_dir("wincheck");
        make(&crate::repo::root(), &dest).unwrap();
        let lib = std::fs::read_to_string(dest.join("src/lib.rs")).unwrap();
        for name in FILES {
            assert!(lib.contains(&format!("pub mod {name} {{\nmod imp {{")), "{name} の mod imp を写す");
        }
        assert!(!lib.contains("#[cfg(windows)]\nmod imp"), "写した所は cfg を外す（Windows 向けにだけ組むので）");
        let cargo = std::fs::read_to_string(dest.join("Cargo.toml")).unwrap();
        let desktop = crate::repo::read_text(&crate::repo::root().join("desktop/Cargo.toml")).unwrap().0;
        assert!(cargo.contains(windows_dep(&desktop).unwrap()), "desktop と同じ windows の版・機能");
        assert!(cargo.contains("[workspace]"));
    }

    /// Windows の取り出し（改行が CRLF）からも作れる
    #[test]
    fn works_on_a_crlf_checkout() {
        let repo = crate::repo::root();
        let copy = crate::repo::temp_dir("wincheck-crlf-repo");
        let files: Vec<String> = std::iter::once("Cargo.toml".to_string()).chain(FILES.iter().map(|n| format!("src/{n}.rs"))).collect();
        for rel in &files {
            let dest = copy.join("desktop").join(rel);
            std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
            // 取り出しの改行によらず、LF にそろえた中身を CRLF で書く
            let (text, _) = crate::repo::read_text(&repo.join("desktop").join(rel)).unwrap();
            crate::repo::write_text(&dest, &text, true).unwrap();
        }
        let dest = crate::repo::temp_dir("wincheck-crlf");
        make(&copy, &dest).unwrap();
        let lib = std::fs::read_to_string(dest.join("src/lib.rs")).unwrap();
        assert_eq!(FILES.iter().filter(|n| lib.contains(&format!("pub mod {n} {{"))).count(), FILES.len());
        assert!(std::fs::read_to_string(dest.join("Cargo.toml")).unwrap().contains("windows = {"));
    }
}
