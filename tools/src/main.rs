//! PonStamp の開発の道具（`cargo tools <命令>`。.cargo/config.toml の別名）。Python は要らない。
//!
//! ```text
//! cargo tools brand <項目>                      名前の定義（app/brand.json）の値
//! cargo tools version                           版（app/version.json）
//! cargo tools build --exe <exe> --out <出力先>   配る ZIP・release.json・.sha256 を作る
//! cargo tools notes --release <release.json>    GitHub Releases の説明
//! cargo tools release [--release | --amend]     配る物の要約を出す・版を記録する
//! cargo tools verify --exe <exe> [--work <フォルダ>] [--keep]   本物の窓で配布と更新の通しを確かめる
//! cargo tools score <採点.json>                 改良案の採点の合計と判定
//! cargo tools wincheck [作業フォルダ]            Windows だけのコードを Windows 向けに clippy
//! cargo tools selftest <結果.json>              自己診断の結果を読む（すべて通れば 0）
//! ```

mod bundle;
mod release;
mod repo;
mod score;
mod selftest;
mod verify;
mod wincheck;

use std::path::PathBuf;
use std::process::ExitCode;

const USAGE: &str =
    "使い方: cargo tools <brand 項目 | version | build --exe E --out D | notes --release R | release [--release|--amend] | \
                     verify --exe E [--work D] [--keep] | score F | wincheck [D] | selftest F>";

/// `--名前 値` の値（無ければ None）
fn opt(args: &[String], name: &str) -> Option<PathBuf> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(PathBuf::from)
}

fn need(args: &[String], name: &str) -> Result<PathBuf, String> {
    opt(args, name).ok_or(format!("{name} が要ります。{USAGE}"))
}

fn run(args: &[String]) -> Result<ExitCode, String> {
    let repo = repo::root();
    let rest = &args[1..];
    match args.first().map(String::as_str) {
        Some("brand") => println!("{}", repo::brand_value(&repo, rest.first().ok_or(USAGE)?)?),
        Some("version") => println!("{}", repo::app_version(&repo)?),
        Some("build") => {
            let s = bundle::build(&repo, &need(rest, "--exe")?, &need(rest, "--out")?, None, None)?;
            println!("{}", serde_json::to_string_pretty(&s).unwrap_or_default());
        }
        Some("notes") => {
            let rel = repo::read_json(&need(rest, "--release")?)?;
            let info = repo::version_info(&repo)?;
            print!("{}", bundle::release_notes(&rel, info["changelog"].as_array().map(Vec::as_slice).unwrap_or(&[]))?);
        }
        Some("release") => {
            if rest.iter().any(|a| a == "--release" || a == "--amend") {
                println!("{}", release::record_release(&repo, rest.iter().any(|a| a == "--amend"))?);
            } else {
                println!("配る物の要約 {}（{} ファイル）", release::release_digest(&repo), release::release_files(&repo).len());
            }
        }
        Some("verify") => {
            let exe = need(rest, "--exe")?;
            let exe = std::fs::canonicalize(&exe).map_err(|e| format!("{} が見つかりません: {e}", exe.display()))?;
            let work = opt(rest, "--work").unwrap_or_else(|| std::env::temp_dir().join("ponstamp-verify"));
            std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
            let work = std::fs::canonicalize(&work).map_err(|e| e.to_string())?;
            let ok = verify::run(&repo, &exe, &work)?;
            verify::print_logs(&work);
            if ok && !rest.iter().any(|a| a == "--keep") {
                let _ = std::fs::remove_dir_all(&work);
            }
            println!("通し: {}", if ok { "OK" } else { "FAILED" });
            return Ok(if ok { ExitCode::SUCCESS } else { ExitCode::FAILURE });
        }
        Some("score") => {
            let file = PathBuf::from(rest.first().ok_or(USAGE)?);
            println!("{}", score::report(&file, &repo::read_json(&file)?)?);
        }
        Some("wincheck") => {
            let dest = rest.first().map(PathBuf::from).unwrap_or_else(|| std::env::temp_dir().join("ponstamp-wincheck"));
            let code = wincheck::run(&repo, &dest)?;
            return Ok(ExitCode::from(u8::try_from(code).unwrap_or(1)));
        }
        Some("selftest") => {
            let file = PathBuf::from(rest.first().ok_or(USAGE)?);
            let r = repo::read_json(&file).map_err(|e| format!("結果のファイルがありません・読めません: {e}"))?;
            let (lines, ok) = selftest::report(&r);
            println!("{}", lines.join("\n"));
            return Ok(if ok { ExitCode::SUCCESS } else { ExitCode::FAILURE });
        }
        _ => return Err(USAGE.into()),
    }
    Ok(ExitCode::SUCCESS)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}
