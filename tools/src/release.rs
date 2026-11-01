//! 版の上げ忘れを止める。
//!
//! 配る物（画面 app/・窓 desktop/・窓に依らない部品 core/）の中身の要約を app/version.json の release に記録しておき、
//! 試験（このモジュールの tests）がいまの中身と比べる。版を上げずに中身を変えると試験が失敗して、直し方を言う。
//!
//! ```text
//! cargo tools release            いまの要約を出す
//! cargo tools release --release  版を上げて更新履歴を足したあとに、記録する（版が上がっていない・履歴の先頭が今の版でなければ断る）
//! cargo tools release --amend    まだ配っていない版を直しただけのとき、版はそのままで要約だけ書き直す
//! ```
//! release は手で書かない。desktop/Cargo.toml・desktop/tauri.conf.json・Cargo.lock の窓の版もこの版にそろえる（--release が書き換える）。

use crate::repo::{read_text, write_text};
use ps_core::release::parse_version;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// 配る物: 画面と窓の作り（説明・試験・道具は含めない）。末尾の `/**` は下のフォルダも、`/*` はそのフォルダの直下だけ。
const RELEASE_GLOBS: &[&str] = &[
    "app/**",
    "core/src/**",
    "core/Cargo.toml",
    "desktop/src/**",
    "desktop/capabilities/*",
    "desktop/build.rs",
    "desktop/Cargo.toml",
    "desktop/tauri.conf.json",
    "Cargo.toml",
    "Cargo.lock",
];
/// version.json 自身は含めない（release を書くと要約が変わるため）。
const RELEASE_SKIP: &[&str] = &["app/version.json"];
/// Cargo.lock の窓の版の行（--release が書き換える。要約からは除く）。
const LOCK_PACKAGE: &str = "name = \"ponstamp-desktop\"\nversion = ";

#[cfg(test)]
pub const HOW: &str =
    "app/version.json の version を上げて changelog の先頭に 1 件足し、`cargo tools release --release` で記録してください\
                       （まだ配っていない版を直しただけなら `cargo tools release --amend`）。";

fn walk(dir: &Path, deep: bool, out: &mut Vec<PathBuf>) {
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_file() {
            out.push(p);
        } else if deep && p.is_dir() {
            walk(&p, true, out);
        }
    }
}

/// 配る物のファイル（リポジトリからの道「/」区切り → 場所）。道の名前順。
pub fn release_files(repo: &Path) -> Vec<(String, PathBuf)> {
    let mut found = vec![];
    for pattern in RELEASE_GLOBS {
        if let Some(dir) = pattern.strip_suffix("/**") {
            walk(&repo.join(dir), true, &mut found);
        } else if let Some(dir) = pattern.strip_suffix("/*") {
            walk(&repo.join(dir), false, &mut found);
        } else if repo.join(pattern).is_file() {
            found.push(repo.join(pattern));
        }
    }
    let mut out: Vec<(String, PathBuf)> = found
        .into_iter()
        .map(|p| {
            let rel = p
                .strip_prefix(repo)
                .unwrap_or(&p)
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/");
            (rel, p)
        })
        .filter(|(rel, _)| !RELEASE_SKIP.contains(&rel.as_str()))
        .collect();
    out.sort();
    out.dedup_by(|a, b| a.0 == b.0);
    out
}

/// text の中の、最初の「行頭が prefix で、その後が "…"」の値を置き換える（with = None なら値を消す）。置き換えた数。
fn replace_first_quoted(text: &str, prefix: &str, with: Option<&str>) -> (String, usize) {
    let mut pos = 0;
    loop {
        let Some(i) = text[pos..].find(prefix).map(|i| i + pos) else { return (text.to_string(), 0) };
        let at_line_start = i == 0 || text.as_bytes()[i - 1] == b'\n';
        let rest = &text[i + prefix.len()..];
        if at_line_start && rest.starts_with('"') {
            if let Some(end) = rest[1..].find('"') {
                let value_end = i + prefix.len() + 1 + end + 1;
                let new = with.map(|v| format!("\"{v}\"")).unwrap_or_default();
                return (format!("{}{new}{}", &text[..i + prefix.len()], &text[value_end..]), 1);
            }
        }
        pos = i + prefix.len();
    }
}

/// 配る物の中身の要約（16 桁）。改行は LF にそろえる（Windows で取り出して CRLF になっても同じ要約）。
/// Cargo.toml・tauri.conf.json・Cargo.lock の窓の version の行は除く（--release が版をそろえて書き換えても、要約が変わらないように）。
pub fn release_digest(repo: &Path) -> String {
    let mut h = Sha256::new();
    for (rel, p) in release_files(repo) {
        // バイトのまま（絵などの文字でないファイルも、違う中身は違う要約に）。CRLF → LF だけそろえる
        let raw = std::fs::read(&p).unwrap_or_default();
        let mut body = Vec::with_capacity(raw.len());
        for (i, &b) in raw.iter().enumerate() {
            if !(b == b'\r' && raw.get(i + 1) == Some(&b'\n')) {
                body.push(b);
            }
        }
        let text = |b: &[u8]| String::from_utf8_lossy(b).into_owned();
        match rel.as_str() {
            "desktop/Cargo.toml" => body = replace_first_quoted(&text(&body), "version = ", None).0.into_bytes(),
            "desktop/tauri.conf.json" => body = replace_first_quoted(&text(&body), "  \"version\": ", None).0.into_bytes(),
            "Cargo.lock" => body = without_lock_version(&text(&body)).into_bytes(),
            _ => {}
        }
        h.update(rel.as_bytes());
        h.update([0]);
        h.update(&body);
        h.update([0]);
    }
    h.finalize().iter().take(8).map(|b| format!("{b:02x}")).collect()
}

fn without_lock_version(lock: &str) -> String {
    match lock.find(LOCK_PACKAGE) {
        Some(i) => {
            let start = i + LOCK_PACKAGE.len();
            let end = lock[start..].find('\n').map(|e| start + e).unwrap_or(lock.len());
            format!("{}{}", &lock[..start], &lock[end..])
        }
        None => lock.to_string(),
    }
}

/// desktop/Cargo.toml と tauri.conf.json の version をそろえる（Cargo.lock の窓の版も）。
pub fn sync_build_versions(repo: &Path, version: &str) -> Result<(), String> {
    // 改行は LF にそろえて探し、元の改行（Windows の取り出しは CRLF）で書き戻す
    let edit = |rel: &str, prefix: &str| -> Result<(), String> {
        let path = repo.join(rel);
        let (text, crlf) = read_text(&path)?;
        let (new, n) = replace_first_quoted(&text, prefix, Some(version));
        if n != 1 {
            return Err(format!("{rel} に版の行が見つかりません"));
        }
        write_text(&path, &new, crlf)
    };
    edit("desktop/Cargo.toml", "version = ")?;
    edit("desktop/tauri.conf.json", "  \"version\": ")?;
    let lock = repo.join("Cargo.lock");
    if let Ok((text, crlf)) = read_text(&lock) {
        if let Some(i) = text.find(LOCK_PACKAGE) {
            let start = i + LOCK_PACKAGE.len();
            let end = text[start..].find('\n').map(|e| start + e).unwrap_or(text.len());
            write_text(&lock, &format!("{}\"{version}\"{}", &text[..start], &text[end..]), crlf)?;
        }
    }
    Ok(())
}

fn version_key(v: &str) -> (u64, u64, u64) {
    parse_version(v).unwrap_or((0, 0, 0))
}

/// release を書く。版を上げずに中身だけ変えた記録は作らない（上げ忘れを止めるための仕組みなので）。
pub fn record_release(repo: &Path, amend: bool) -> Result<String, String> {
    let path = repo.join("app").join("version.json");
    let v = crate::repo::read_json(&path)?;
    let cur = v["version"].as_str().ok_or("app/version.json に version がありません")?.to_string();
    let rec_version = v["release"]["version"].as_str().unwrap_or("").to_string();
    let rec_digest = v["release"]["digest"].as_str().unwrap_or("").to_string();
    if v["changelog"][0]["version"].as_str() != Some(cur.as_str()) {
        return Err(format!("更新履歴（changelog）の先頭が版 {cur} ではありません。先頭に {cur} の 1 件を足してください。"));
    }
    sync_build_versions(repo, &cur)?;
    let digest = release_digest(repo);
    if rec_version == cur && rec_digest == digest {
        return Ok(format!("記録済みです（{cur}・{digest}）。"));
    }
    if rec_version == cur && !rec_digest.is_empty() && !amend {
        return Err(format!(
            "版 {cur} は記録済みで、そのあと中身が変わっています。版を上げて（app/version.json の version と changelog の先頭）からもう一度。\
             まだ配っていない {cur} を直しただけなら --amend。"
        ));
    }
    if version_key(&cur) < version_key(&rec_version) {
        return Err(format!("版 {cur} が、記録済みの {rec_version} より古くなっています。"));
    }
    // 書式（1 行の release）を保つため、文字として置き換える
    let (text, crlf) = read_text(&path)?;
    let start = text.find("\"release\": {").ok_or("app/version.json に release の行が見つかりません。")?;
    let end = text[start..].find('}').map(|e| start + e + 1).ok_or("app/version.json の release が閉じていません。")?;
    let new = format!("{}\"release\": {{\"version\": \"{cur}\", \"digest\": \"{digest}\"}}{}", &text[..start], &text[end..]);
    write_text(&path, &new, crlf)?;
    Ok(format!("記録しました: {cur}・{digest}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo::{root, temp_dir, version_info};

    #[test]
    fn changelog_head_is_the_app_version() {
        let info = version_info(&root()).unwrap();
        let v = info["version"].as_str().unwrap();
        assert!(parse_version(v).is_some(), "版は X.Y.Z");
        assert_eq!(info["changelog"][0]["version"].as_str(), Some(v), "changelog の先頭にいまの版の 1 件を足してください");
    }

    #[test]
    fn changelog_is_newest_first_and_filled() {
        let info = version_info(&root()).unwrap();
        let log = info["changelog"].as_array().unwrap();
        let keys: Vec<_> = log.iter().map(|e| version_key(e["version"].as_str().unwrap())).collect();
        let mut sorted = keys.clone();
        sorted.sort_by(|a, b| b.cmp(a));
        assert_eq!(keys, sorted, "新しい版を上に");
        sorted.dedup();
        assert_eq!(sorted.len(), keys.len(), "同じ版が 2 つある");
        let dates: Vec<&str> = log.iter().map(|e| e["date"].as_str().unwrap()).collect();
        for d in &dates {
            let ok = d.len() == 10
                && d.as_bytes()[4] == b'-'
                && d.as_bytes()[7] == b'-'
                && d.replace('-', "").bytes().all(|b| b.is_ascii_digit());
            assert!(ok, "日付は YYYY-MM-DD: {d}");
        }
        let mut sorted_dates = dates.clone();
        sorted_dates.sort_by(|a, b| b.cmp(a));
        assert_eq!(dates, sorted_dates, "日付も新しい順");
        for e in log {
            let notes = e["notes"].as_array().unwrap();
            assert!(!notes.is_empty() && notes.iter().all(|n| !n.as_str().unwrap_or("").trim().is_empty()), "{}", e["version"]);
        }
    }

    #[test]
    fn contents_match_the_recorded_release() {
        let repo = root();
        let info = version_info(&repo).unwrap();
        let v = info["version"].as_str().unwrap();
        assert_eq!(info["release"]["version"].as_str(), Some(v), "版 {v} がまだ記録されていません。{HOW}");
        assert_eq!(
            info["release"]["digest"].as_str(),
            Some(release_digest(&repo).as_str()),
            "版 {v} を記録したあとに中身が変わっています。{HOW}"
        );
    }

    #[test]
    fn digest_covers_what_is_shipped() {
        let files: Vec<String> = release_files(&root()).into_iter().map(|(r, _)| r).collect();
        assert!(!files.contains(&"app/version.json".to_string()), "release を書くと要約が変わってしまう");
        for must in [
            "app/index.html",
            "app/js/app.js",
            "app/brand.json",
            "desktop/src/main.rs",
            "core/src/update.rs",
            "desktop/Cargo.toml",
            "desktop/tauri.conf.json",
            "Cargo.lock",
        ] {
            assert!(files.contains(&must.to_string()), "{must}");
        }
        assert!(
            !files.iter().any(|k| k.starts_with("tests/") || k.starts_with("tools/") || k.starts_with("docs/") || k.ends_with(".md")),
            "説明・試験・道具は含めない"
        );
    }

    #[test]
    fn build_files_carry_the_same_version() {
        let repo = root();
        let v = crate::repo::app_version(&repo).unwrap();
        let cargo = read_text(&repo.join("desktop/Cargo.toml")).unwrap().0;
        let cargo_v = cargo.lines().find_map(|l| l.strip_prefix("version = \"").and_then(|r| r.strip_suffix('"'))).unwrap();
        let conf = crate::repo::read_json(&repo.join("desktop/tauri.conf.json")).unwrap();
        assert_eq!(
            (cargo_v, conf["version"].as_str().unwrap()),
            (v.as_str(), v.as_str()),
            "desktop/Cargo.toml と tauri.conf.json の version を app/version.json にそろえる（--release がそろえる）"
        );
        let lock = read_text(&repo.join("Cargo.lock")).unwrap().0;
        assert!(lock.contains(&format!("{LOCK_PACKAGE}\"{v}\"")), "Cargo.lock の窓の版も同じ");
    }

    /// 改行が CRLF になっても・--release が Cargo.toml の版を書き換えても、要約は変わらない。中身が変われば変わる。
    #[test]
    fn digest_ignores_line_endings_and_build_versions() {
        let repo = root();
        let copy = temp_dir("release");
        for (rel, p) in release_files(&repo) {
            let dest = copy.join(&rel);
            std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
            std::fs::copy(&p, &dest).unwrap();
        }
        let before = release_digest(&copy);
        // 改行を入れ替える（取り出しが LF なら CRLF に、Windows の取り出しで CRLF なら LF に）
        let main = copy.join("app/js/app.js");
        let (text, crlf) = read_text(&main).unwrap();
        write_text(&main, &text, !crlf).unwrap();
        sync_build_versions(&copy, "99.0.0").unwrap();
        let lf = |rel: &str| read_text(&copy.join(rel)).unwrap().0;
        assert!(lf("desktop/Cargo.toml").contains("version = \"99.0.0\""), "版を書き換えた");
        assert!(lf("Cargo.lock").contains(&format!("{LOCK_PACKAGE}\"99.0.0\"")));
        assert_eq!(release_digest(&copy), before);
        let (text, crlf) = read_text(&main).unwrap();
        write_text(&main, &format!("{text}// x"), crlf).unwrap();
        assert_ne!(release_digest(&copy), before, "中身が変われば要約も変わる");
    }

    /// Windows の取り出し（Git が改行を CRLF にする）でも、版をそろえられ・CRLF のまま保ち・要約は LF の取り出しと同じ。
    /// 写しは、取り出しの改行（Linux は LF・Windows は CRLF）によらず、LF にそろえた中身から LF 版と CRLF 版を作る
    #[test]
    fn versions_sync_and_digest_on_a_crlf_checkout() {
        let repo = root();
        let (lf, crlf) = (temp_dir("release-lf"), temp_dir("release-crlf"));
        for (rel, p) in release_files(&repo) {
            for (dir, to_crlf) in [(&lf, false), (&crlf, true)] {
                let dest = dir.join(&rel);
                std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
                match read_text(&p) {
                    Ok((text, _)) => write_text(&dest, &text, to_crlf).unwrap(),
                    Err(_) => {
                        std::fs::copy(&p, &dest).unwrap(); // 文字でないファイル（絵）はそのまま
                    }
                }
            }
        }
        assert_eq!(release_digest(&crlf), release_digest(&lf), "改行の違いで要約は変わらない");
        sync_build_versions(&crlf, "99.0.0").unwrap();
        let read = |rel: &str| std::fs::read_to_string(crlf.join(rel)).unwrap();
        assert!(read("desktop/Cargo.toml").contains("version = \"99.0.0\"\r\n"), "Cargo.toml の版（CRLF のまま）");
        assert!(read("desktop/tauri.conf.json").contains("\"version\": \"99.0.0\""));
        assert!(
            read("Cargo.lock").contains("name = \"ponstamp-desktop\"\r\nversion = \"99.0.0\"\r\n"),
            "Cargo.lock の窓の版（CRLF のまま）"
        );
        assert!(!read("Cargo.lock").replace("\r\n", "").contains('\n'), "LF だけの行を混ぜない");
        assert_eq!(release_digest(&crlf), release_digest(&lf), "版をそろえても要約は変わらない");
    }

    #[test]
    fn replacing_the_first_version_line_only() {
        let toml = "[package]\nname = \"x\"\nversion = \"1.0.0\"\n[dependencies]\nversion = \"9\"\n";
        assert_eq!(
            replace_first_quoted(toml, "version = ", Some("2.0.0")),
            ("[package]\nname = \"x\"\nversion = \"2.0.0\"\n[dependencies]\nversion = \"9\"\n".into(), 1)
        );
        assert_eq!(replace_first_quoted("a_version = \"1\"\n", "version = ", None).1, 0, "行頭の物だけ");
    }
}
