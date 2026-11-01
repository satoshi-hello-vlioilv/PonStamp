//! 配る ZIP を組み立てる（仕組みは docs/DESIGN.md の「配布と更新」）。
//!
//! ```text
//! cargo tools brand <項目>                    名前の定義（app/brand.json）の値を出す（CI が名前を書き写さない）
//! cargo tools version                         版（app/version.json）を出す（Releases の札 v<版> に使う）
//! cargo tools build --exe <exe> --out <出力先> 配る ZIP と release.json・.sha256 を作る
//! cargo tools notes --release <release.json>  GitHub Releases の説明（その版の更新履歴・配り方・指紋）を出す
//! ```
//! 配る形（ZIP の中。先頭のフォルダはアプリ名）: `<name>/<exe>`（窓。画面は exe に入っている）・`<name>/app.json`（名乗り）・`<name>/README.md`。
//! 名乗りと release.json の形・名前の決まり・ZIP の作り方は core（ps_core）の 1 か所の定義（窓の取り込み・版を置くと同じ）。

use crate::repo::{self, write_json};
use ps_core::release::{release_record, zip_name};
use ps_core::update::{manifest_record, sha256_file, MANIFEST, MAX_BYTES};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// 配る形のフォルダを作る（exe・名乗り・README）。version・extra は通しの確かめ（verify）が版を変えた形を作るため。
pub fn stage(repo: &Path, exe: &Path, dest: &Path, version: Option<&str>, extra: Option<&Value>) -> Result<PathBuf, String> {
    let b = repo::brand(repo)?;
    let version = match version {
        Some(v) => v.to_string(),
        None => repo::app_version(repo)?,
    };
    let _ = std::fs::remove_dir_all(dest);
    std::fs::create_dir_all(dest).map_err(|e| format!("{} を作れません: {e}", dest.display()))?;
    std::fs::copy(exe, dest.join(&b.exe)).map_err(|e| format!("{} を写せません: {e}", exe.display()))?;
    let mut m = manifest_record(&b.app_id, &b.name, &b.exe, &version);
    if let Some(Value::Object(more)) = extra {
        m.as_object_mut().expect("object").extend(more.clone());
    }
    write_json(&dest.join(MANIFEST), &m)?;
    std::fs::copy(repo.join("README.md"), dest.join("README.md")).map_err(|e| format!("README.md を写せません: {e}"))?;
    Ok(dest.to_path_buf())
}

/// 配る ZIP・release.json・<zip>.sha256 を out に作る。→ 要約（release.json の中身に path・files・bytes）
pub fn build(repo: &Path, exe: &Path, out: &Path, version: Option<&str>, extra: Option<&Value>) -> Result<Value, String> {
    let b = repo::brand(repo)?;
    let version = match version {
        Some(v) => v.to_string(),
        None => repo::app_version(repo)?,
    };
    std::fs::create_dir_all(out).map_err(|e| format!("{} を作れません: {e}", out.display()))?;
    let staging = out.join("stage");
    let top = stage(repo, exe, &staging.join(&b.name), Some(&version), extra)?;
    let zip = zip_name(&b.name, &version);
    let zpath = out.join(&zip);
    let n = ps_core::pack::zip_dir(&top, &b.name, &zpath);
    let _ = std::fs::remove_dir_all(&staging);
    let n = n?;
    let bytes = std::fs::metadata(&zpath).map_err(|e| e.to_string())?.len();
    if bytes > MAX_BYTES {
        return Err("配る ZIP が 1 GB を超えました（取り込む側が断ります）".into());
    }
    let sha = sha256_file(&zpath).map_err(|e| e.to_string())?;
    let rel = release_record(&b.app_id, &b.name, &version, &zip, &sha, &b.exe)?;
    write_json(&out.join("release.json"), &rel)?;
    std::fs::write(out.join(format!("{zip}.sha256")), format!("{sha}  {zip}\n")).map_err(|e| e.to_string())?;
    let mut summary = rel.clone();
    summary
        .as_object_mut()
        .expect("object")
        .extend(json!({"path": zpath.display().to_string(), "files": n, "bytes": bytes}).as_object().expect("object").clone());
    Ok(summary)
}

/// GitHub Releases の説明（Markdown）。その版の更新履歴・配り方（README の「配る人」と同じ言葉）・指紋。
pub fn release_notes(rel: &Value, changelog: &[Value]) -> Result<String, String> {
    let version = rel["version"].as_str().unwrap_or("");
    let entry = changelog
        .iter()
        .find(|e| e["version"] == version)
        .ok_or(format!("更新履歴（app/version.json の changelog）に版 {version} がありません"))?;
    let s = |v: &Value| v.as_str().unwrap_or("").to_string();
    let mut lines = vec![format!("## 版 {version}（{}）", s(&entry["date"])), String::new(), "### 変わったこと".into()];
    lines.extend(entry["notes"].as_array().into_iter().flatten().map(|n| format!("- {}", s(n))));
    lines.extend([
        String::new(),
        "### 配り方".into(),
        String::new(),
        format!("1. 下の `{}` を取ります（`release.json`・`.sha256` も同じ版の物です）。", s(&rel["zip"])),
        "2. アプリの「設定」→「配布（配る人）」→「ZIP から版を置く…」で選ぶと、中身を確かめてから、置き場のアプリのフォルダの下の versions\
         （設定で名前を変えられます）に版のフォルダを作ります。置いただけでは配りません。"
            .into(),
        "3. 試してから、一覧の「この版を配る」を押します。各 PC は起動したとき・30 分ごとに確かめ、開き直したときにこの版になります。"
            .into(),
        String::new(),
        format!("はじめて使う PC には、置き場の配る入口（`{}`）のアドレスを渡します。開くだけでその PC に入ります。", s(&rel["exe"])),
        String::new(),
        format!("指紋（SHA-256）: `{}`", s(&rel["sha256"])),
        String::new(),
    ]);
    Ok(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo::{brand, read_json, root, temp_dir};

    #[test]
    fn release_json_matches_what_the_window_reads_and_refuses_bad_names() {
        let b = brand(&root()).unwrap();
        let r = release_record(&b.app_id, &b.name, "1.9.0", &zip_name(&b.name, "1.9.0"), &"a".repeat(64), &b.exe).unwrap();
        let keys: Vec<&String> = r.as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 7);
        for k in ["schema", "app_id", "name", "version", "zip", "sha256", "exe"] {
            assert!(r.get(k).is_some(), "{k}");
        }
        assert_eq!((r["schema"].as_u64(), r["exe"].as_str()), (Some(1), Some(b.exe.as_str())));
        for bad in ["../x.zip", "a/b.zip", "a\\b.zip", "C:x.zip", " x.zip", ".."] {
            assert!(release_record(&b.app_id, &b.name, "1.9.0", bad, "a", &b.exe).is_err(), "{bad}");
        }
    }

    #[test]
    fn manifest_names_the_app() {
        let b = brand(&root()).unwrap();
        assert_eq!(
            manifest_record(&b.app_id, &b.name, &b.exe, "1.2.3"),
            json!({"app_id": b.app_id, "name": b.name, "exe": b.exe, "version": "1.2.3"})
        );
    }

    #[test]
    fn build_makes_one_top_folder_with_exe_manifest_and_readme() {
        let repo = root();
        let b = brand(&repo).unwrap();
        let d = temp_dir("bundle");
        let exe = d.join("built.exe");
        std::fs::write(&exe, "MZ-fake").unwrap();
        let out = d.join("out");
        let s = build(&repo, &exe, &out, Some("2.0.0"), None).unwrap();
        let zpath = PathBuf::from(s["path"].as_str().unwrap());
        let mut z = zip::ZipArchive::new(std::fs::File::open(&zpath).unwrap()).unwrap();
        let mut names: Vec<String> = z.file_names().map(|n| n.unwrap().to_string()).collect();
        names.sort();
        let mut want: Vec<String> = [b.exe.as_str(), "README.md", "app.json"].iter().map(|n| format!("{}/{n}", b.name)).collect();
        want.sort();
        assert_eq!(names, want);
        let mut m = String::new();
        std::io::Read::read_to_string(&mut z.by_name(&format!("{}/app.json", b.name)).unwrap(), &mut m).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&m).unwrap()["version"], "2.0.0", "名乗りの版 = 置き場の版");
        let rel = read_json(&out.join("release.json")).unwrap();
        assert_eq!((rel["version"].as_str(), rel["sha256"].as_str()), (Some("2.0.0"), Some(sha256_file(&zpath).unwrap().as_str())));
        let sha_file = std::fs::read_to_string(out.join(format!("{}.sha256", rel["zip"].as_str().unwrap()))).unwrap();
        assert!(sha_file.starts_with(rel["sha256"].as_str().unwrap()));
        assert!(!out.join("stage").exists(), "途中の物を残さない");
        // 取り込む側（窓の validate_dist）が、この ZIP の中身をこのアプリの版と認める
        let back = d.join("back");
        ps_core::update::extract_zip(&zpath, &back).unwrap();
        let v = ps_core::update::validate_dist(&back.join(&b.name), &b.exe, &b.app_id, Some("2.0.0")).unwrap();
        assert_eq!(v, "2.0.0");
    }

    #[test]
    fn release_notes_need_the_changelog_entry() {
        let repo = root();
        let info = repo::version_info(&repo).unwrap();
        let log = info["changelog"].as_array().unwrap().clone();
        let v = info["version"].as_str().unwrap();
        let rel = json!({"version": v, "zip": "x.zip", "sha256": "a".repeat(64), "exe": "PonStamp.exe"});
        let notes = release_notes(&rel, &log).unwrap();
        assert!(notes.contains(&format!("## 版 {v}")));
        assert!(notes.contains("この版を配る"));
        assert!(release_notes(&json!({"version": "9.9.9"}), &log).is_err());
    }
}
