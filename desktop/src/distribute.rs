//! 配布（LotScope と同じ形）: 画面から版を置く・配る版を選ぶ・配る入口を置く・版を消す、と、配る入口から新しい PC へ。
//!
//! 置き場（release.rs と同じ形）:
//! ```text
//! <更新の置き場>\<アプリのフォルダ>\
//!   distribute.json          { schema:1, app_id, version, entry, setAt, setBy, setPc, previous }
//!   <exe>                    配る入口（配る版の ZIP の exe と名乗り。新しい PC へはこのアドレスだけを渡す）
//!   <版>\release.json        { schema:1, app_id, name, version, zip, sha256, exe, placedAt, placedBy, placedPc, source, bytes }
//!   <版>\<name>-<版>-windows.zip
//! ```
//! 置くときは `.<版>.placing-<pid>` へ写して指紋を確かめ直し、release.json を書いてから名前を変える（各 PC が置きかけを読まない）。
//! 消すときは逆に、先に `.<版>.removing-<pid>` へ名前を変えてから中身を消す（各 PC が消しかけを読まない）。
//! だれが置いてよいかは、置き場のフォルダに書ける人（共有・BOX の権限）で決まる。

use crate::paths::{now_text, read_json, write_json, Paths};
use crate::release::{self, Release, Scan, DISTRIBUTE, MARKER};
use crate::update::{self, dist_root, extract_zip, manifest, sha256_file, validate_dist, MANIFEST};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// だれが（Windows のログイン名と PC 名）。置き場の記録に残す。
#[derive(Debug, Clone, Default)]
pub struct Who {
    pub login: String,
    pub pc: String,
}

impl Who {
    /// この PC のだれか（環境変数 USERNAME・COMPUTERNAME。ほかの OS は USER・HOSTNAME）。
    pub fn here() -> Who {
        let var = |names: &[&str]| names.iter().find_map(|n| std::env::var(n).ok().filter(|v| !v.is_empty())).unwrap_or_default();
        Who { login: var(&["USERNAME", "USER"]), pc: var(&["COMPUTERNAME", "HOSTNAME"]) }
    }
}

/// 進み具合を伝える（段・済んだバイト・全部のバイト）。
pub type Progress<'a> = &'a dyn Fn(&str, u64, u64);

/// アプリのフォルダ（配る版の覚えがあればそこ、無ければいちばん新しい版の隣、どちらも無ければ 置き場\<アプリ名>）。
pub fn app_folder(found: &Path, scan: &Scan, name: &str) -> PathBuf {
    if let Some(d) = &scan.distribute {
        return d.dir.clone();
    }
    if let Some(r) = scan.newest() {
        if let Some(parent) = r.dir.parent() {
            return parent.to_path_buf();
        }
    }
    found.join(name)
}

/// 写しながら進み具合を伝える。
fn copy_with_progress(from: &Path, to: &Path, progress: Progress) -> Result<u64, String> {
    let total = std::fs::metadata(from).map(|m| m.len()).unwrap_or(0);
    let mut r = std::fs::File::open(from).map_err(|e| format!("{} を開けません: {e}", from.display()))?;
    let mut w = std::fs::File::create(to).map_err(|e| format!("{} を書けません: {e}", to.display()))?;
    let (mut buf, mut done) = (vec![0u8; 1 << 20], 0u64);
    loop {
        let n = r.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        w.write_all(&buf[..n]).map_err(|e| format!("置き場へ書けません: {e}"))?;
        done += n as u64;
        progress("copy", done, total);
    }
    w.sync_all().map_err(|e| e.to_string())?;
    Ok(done)
}

/// 画面から選んだ ZIP を置き場に置く。→ 置いた版の release.json
pub fn place(p: &Paths, found: &Path, zip: &Path, source_name: &str, app_id: &str, who: &Who, progress: Progress) -> Result<Value, String> {
    progress("check", 0, 0);
    let work = p.work();
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let tmp = work.join(format!("place-check-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let checked = (|| {
        extract_zip(zip, &tmp)?;
        let root = dist_root(&tmp).ok_or(format!("ZIP に {MANIFEST} がありません（配る ZIP ではありません）"))?;
        let m = manifest(&root).ok_or(format!("ZIP の {MANIFEST} を読めません"))?;
        if m["app_id"].as_str() != Some(app_id) {
            return Err("このアプリの ZIP ではありません（目印 app_id が違います）".to_string());
        }
        let exe = m["exe"].as_str().unwrap_or("").to_string();
        let name = m["name"].as_str().unwrap_or("").to_string();
        if !release::safe_name(&exe) || name.is_empty() {
            return Err(format!("ZIP の名乗り（{MANIFEST} の name・exe）が正しくありません"));
        }
        let version = validate_dist(&root, &exe, app_id, None)?;
        Ok((version, exe, name))
    })();
    let _ = std::fs::remove_dir_all(&tmp);
    let (version, exe, name) = checked?;
    let scan = release::scan(found, app_id);
    if scan.find(&version).is_some() {
        return Err(format!("版 {version} はもう置いてあります（同じ版は置けません。取り込んだ PC と中身が食い違うため）"));
    }
    let folder = app_folder(found, &scan, &name);
    let (dest, placing) = (folder.join(&version), folder.join(format!(".{version}.placing-{}", std::process::id())));
    if dest.exists() {
        return Err(format!("{} がもうあります", dest.display()));
    }
    let _ = std::fs::remove_dir_all(&placing);
    let result = (|| {
        std::fs::create_dir_all(&placing).map_err(|e| format!("置き場にフォルダを作れません（{}）: {e}", placing.display()))?;
        let zip_name = format!("{name}-{version}-windows.zip");
        let sha = sha256_file(zip).map_err(|e| e.to_string())?;
        copy_with_progress(zip, &placing.join(&zip_name), progress)?;
        progress("finish", 0, 0);
        if sha256_file(&placing.join(&zip_name)).map_err(|e| e.to_string())? != sha {
            return Err("置き場へ写した ZIP の指紋が元と違います（写す途中で壊れました）".to_string());
        }
        let rel = json!({"schema": 1, "app_id": app_id, "name": name, "version": version, "zip": zip_name, "sha256": sha, "exe": exe,
                         "placedAt": now_text(), "placedBy": who.login, "placedPc": who.pc, "source": source_name,
                         "bytes": std::fs::metadata(zip).map(|m| m.len()).unwrap_or(0)});
        write_json(&placing.join(MARKER), &rel)?;
        std::fs::rename(&placing, &dest).map_err(|e| format!("版のフォルダを置けません: {e}"))?;
        Ok(rel)
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&placing);
    }
    result
}

/// ZIP の中から、配る形の根（名乗りの隣）のファイルを取り出す（配る入口にする）。
fn extract_file(zip: &Path, file: &str, to: &Path) -> Result<(), String> {
    let f = std::fs::File::open(zip).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    let names: Vec<String> = z.file_names().map(|n| n.map(|n| n.into_owned()).map_err(|e| e.to_string())).collect::<Result<_, _>>()?;
    let root = names
        .iter()
        .find_map(|n| if n == MANIFEST { Some("") } else { n.strip_suffix(&format!("/{MANIFEST}")).map(|r| &n[..r.len() + 1]) })
        .ok_or(format!("ZIP に {MANIFEST} がありません"))?
        .to_string();
    let mut e = z.by_name(&format!("{root}{file}")).map_err(|_| format!("ZIP に {file} がありません"))?;
    let mut buf = Vec::new();
    e.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    std::fs::write(to, buf).map_err(|e| format!("{} を書けません: {e}", to.display()))
}

/// 配る版を決める: distribute.json を書き、配る入口（その版の exe と名乗り）をアプリのフォルダの直下に置く。→ {version, notes, entry}
pub fn set_distributed(found: &Path, version: &str, app_id: &str, who: &Who) -> Result<Value, String> {
    let scan = release::scan(found, app_id);
    let rel: &Release = scan.find(version).ok_or_else(|| format!("版 {version} は置き場にありません"))?;
    if sha256_file(&rel.zip_path()).map_err(|e| format!("版 {version} の ZIP を読めません: {e}"))? != rel.sha256 {
        return Err(format!("版 {version} の ZIP の指紋が release.json と違います（置いている途中か、壊れています）"));
    }
    let folder = app_folder(found, &scan, &rel.name);
    let mut notes = vec![];
    let entry = folder.join(&rel.exe);
    // 配る入口: 指紋を確かめた ZIP からだけ取り出す。exe を開いている人がいると置き換えられないので、そのときは言う
    for file in [rel.exe.as_str(), MANIFEST] {
        let to = folder.join(file);
        let tmp = folder.join(format!(".{file}.new-{}", std::process::id()));
        extract_file(&rel.zip_path(), file, &tmp)?;
        if let Err(e) = update::rename_patiently(&tmp, &to) {
            let _ = std::fs::remove_file(&tmp);
            notes.push(format!(
                "配る入口（{}）を置き換えられませんでした（だれかが入口を開いている最中かもしれません）。少し待ってから、もう一度「この版を配る」を押してください: {e}",
                to.display()
            ));
        }
    }
    let prev = scan.distribute.as_ref();
    // 入口の名前が変わった版を配ったら、前の名前の入口は片付ける
    if let Some(old) = prev.and_then(|d| d.raw["entry"].as_str()).filter(|e| *e != rel.exe && release::safe_name(e)) {
        let _ = std::fs::remove_file(folder.join(old));
    }
    let previous = prev.map(|d| d.version.clone()).filter(|v| v != version);
    let d = json!({"schema": 1, "app_id": app_id, "version": version, "entry": rel.exe, "setAt": now_text(),
                   "setBy": who.login, "setPc": who.pc, "previous": previous});
    write_json(&folder.join(DISTRIBUTE), &d)?;
    Ok(json!({"version": version, "notes": notes, "entry": entry}))
}

/// 置いた版を消す（配っている版は消さない）。→ {version, removed, notes}
/// 版のフォルダを `.<版>.removing-<pid>` に変えてから消す。名前を変えた時点で各 PC からは見えない（scan は「.」で始まる物を見ない）。
pub fn remove_version(found: &Path, version: &str, app_id: &str) -> Result<Value, String> {
    let scan = release::scan(found, app_id);
    if scan.distribute.as_ref().is_some_and(|d| d.version == version) {
        return Err(format!("版 {version} は配っている版なので消せません。先にほかの版を配ってから消してください"));
    }
    let dirs: Vec<&Release> = scan.versions.iter().filter(|r| r.version == version).collect();
    if dirs.is_empty() {
        return Err(format!("版 {version} は置き場にありません（もう消したか、同期待ちかもしれません）"));
    }
    let (mut removed, mut notes) = (0, vec![]);
    for r in dirs {
        let parent = r.dir.parent().ok_or_else(|| format!("{} の上のフォルダが分かりません", r.dir.display()))?;
        let gone = parent.join(format!(".{version}.removing-{}", std::process::id()));
        update::rename_patiently(&r.dir, &gone)
            .map_err(|e| format!("版 {version}（{}）を消せません（だれかが開いているかもしれません）: {e}", r.dir.display()))?;
        removed += 1;
        if let Err(e) = std::fs::remove_dir_all(&gone) {
            notes.push(format!("各 PC からはもう見えませんが、{} を消しきれませんでした。あとで手で消してください: {e}", gone.display()));
        }
    }
    Ok(json!({"version": version, "removed": removed, "notes": notes}))
}

/// たどり終えた置き場（scan）から、配布の画面の答えを作る。
pub fn view_of(scan: &Scan, found: &Path, adjusted: bool, source: &str, name: &str) -> Value {
    let folder = app_folder(found, scan, name);
    let versions: Vec<Value> = scan
        .by_version()
        .iter()
        .map(|r| {
            let bytes = r.raw["bytes"].as_u64().or_else(|| std::fs::metadata(r.zip_path()).ok().map(|m| m.len())).unwrap_or(0);
            json!({"version": r.version, "placedAt": r.raw["placedAt"], "placedPc": r.raw["placedPc"], "placedBy": r.raw["placedBy"],
                   "source": r.raw["source"], "zip": r.zip, "bytes": bytes, "dir": r.dir})
        })
        .collect();
    let entry = scan.distribute.as_ref().and_then(|d| d.raw["entry"].as_str().map(|e| d.dir.join(e)));
    json!({
        "reachable": true, "found": found, "adjusted": adjusted, "folder": source, "appFolder": folder,
        "distributed": scan.distribute.as_ref().map(|d| d.raw.clone()), "versions": versions,
        "entry": {"exists": entry.as_ref().is_some_and(|e| e.is_file()), "path": entry},
        "problems": scan.problems,
    })
}

/// いま動いている exe が「配る入口」か（隣の distribute.json がこのアプリの物で、入口が自分）。→ アプリのフォルダ
pub fn entry_folder(me: &Path, app_id: &str) -> Option<PathBuf> {
    let dir = me.parent()?;
    let d = read_json(&dir.join(DISTRIBUTE))?;
    let name = me.file_name()?.to_string_lossy().to_string();
    (d["app_id"].as_str() == Some(app_id) && d["entry"].as_str().is_some_and(|e| e.eq_ignore_ascii_case(&name))).then(|| dir.to_path_buf())
}

/// 配る入口から: 配る版を取り込み、この PC の app に据える（app が配る版と同じなら写さない）。入口の置き場を控える。→ 据えた版
pub fn install_from_entry(p: &Paths, folder: &Path, app_id: &str, progress: &dyn Fn(&str)) -> Result<String, String> {
    let d = read_json(&folder.join(DISTRIBUTE)).ok_or("配る版の覚え（distribute.json）を読めません")?;
    let version = d["version"].as_str().unwrap_or("").to_string();
    let _ = write_json(&entry_record(p), &json!({"dir": folder, "at": now_text()}));
    let _ = write_json(&p.want(), &d);
    if update::dist_version(&p.app()).as_deref() == Some(version.as_str()) {
        return Ok(version);
    }
    let scan = release::scan(folder, app_id);
    let rel = scan.find(&version).ok_or_else(|| format!("配る版 {version} が置き場にありません（同期待ちかもしれません）"))?;
    update::stage_release(p, rel, app_id, progress)?;
    progress("この PC へ据えています");
    update::apply_staged(p)?;
    update::confirm(p);
    Ok(version)
}

fn entry_record(p: &Paths) -> PathBuf {
    p.root.join("entry.json")
}

/// 控えた入口の置き場（更新の置き場の後ろの候補にする）。
pub fn remembered_entry(p: &Paths) -> Option<PathBuf> {
    read_json(&entry_record(p))?["dir"].as_str().map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::tmp;

    const ID: &str = "local.test.app";

    /// 配る ZIP を作る（App/App.exe・App/app.json）。
    fn make_zip(out: &Path, version: &str, exe_body: &str, app_id: &str) {
        let mut z = zip::ZipWriter::new(std::fs::File::create(out).unwrap());
        let o = zip::write::SimpleFileOptions::default();
        let files = [
            ("App/App.exe".to_string(), exe_body.to_string()),
            ("App/app.json".into(), format!(r#"{{"app_id":"{app_id}","name":"App","exe":"App.exe","version":"{version}"}}"#)),
            ("App/README.md".into(), "説明".into()),
        ];
        for (n, body) in files {
            z.start_file(n, o).unwrap();
            z.write_all(body.as_bytes()).unwrap();
        }
        z.finish().unwrap();
    }

    #[test]
    fn place_then_distribute_then_a_new_pc_takes_it() {
        let d = tmp("dist-flow");
        let (rels, p) = (d.join("Releases"), Paths::new(&d.join("local")));
        std::fs::create_dir_all(&rels).unwrap();
        let who = Who { login: "maint".into(), pc: "PC1".into() };
        let none = |_: &str, _: u64, _: u64| {};
        make_zip(&d.join("a.zip"), "1.10.0", "exe-1", ID);
        let r = place(&p, &rels, &d.join("a.zip"), "a.zip", ID, &who, &none).unwrap();
        assert_eq!((r["version"].as_str(), r["placedBy"].as_str()), (Some("1.10.0"), Some("maint")));
        assert!(rels.join("App").join("1.10.0").join(MARKER).is_file(), "置き場\\アプリ名\\版");
        assert!(place(&p, &rels, &d.join("a.zip"), "a.zip", ID, &who, &none).unwrap_err().contains("もう置いて"), "同じ版は置かない");
        make_zip(&d.join("other.zip"), "1.0.0", "x", "other.app");
        assert!(place(&p, &rels, &d.join("other.zip"), "o.zip", ID, &who, &none).unwrap_err().contains("このアプリ"), "ほかのアプリは断る");
        std::fs::write(d.join("junk.zip"), "not a zip").unwrap();
        assert!(place(&p, &rels, &d.join("junk.zip"), "j.zip", ID, &who, &none).is_err(), "ZIP でない物は断る");
        let left: Vec<_> = std::fs::read_dir(rels.join("App")).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(left.len(), 1, "途中の物を残さない: {left:?}");
        assert_eq!(release::scan(&rels, ID).newest().unwrap().version, "1.10.0", "各 PC の取り込みにそのまま通る");
        // 配る・前の版へ戻す
        make_zip(&d.join("b.zip"), "1.10.1", "exe-2", ID);
        place(&p, &rels, &d.join("b.zip"), "b.zip", ID, &who, &none).unwrap();
        let s = set_distributed(&rels, "1.10.1", ID, &who).unwrap();
        assert!(s["notes"].as_array().unwrap().is_empty(), "{s}");
        let entry = rels.join("App").join("App.exe");
        assert_eq!(std::fs::read_to_string(&entry).unwrap(), "exe-2", "配る入口はその版の exe");
        assert_eq!(update::dist_version(&rels.join("App")).as_deref(), Some("1.10.1"), "入口の隣に名乗りも置く");
        set_distributed(&rels, "1.10.0", ID, &who).unwrap();
        let dj = read_json(&rels.join("App").join(DISTRIBUTE)).unwrap();
        assert_eq!((dj["version"].as_str(), dj["previous"].as_str()), (Some("1.10.0"), Some("1.10.1")), "戻すのも選び直し・前の版を覚える");
        assert_eq!(std::fs::read_to_string(&entry).unwrap(), "exe-1");
        assert!(set_distributed(&rels, "9.9.9", ID, &who).is_err());
        // 配る入口は「この PC へ写す」と間違えない（名乗りが隣にあっても、入口として扱う）
        assert_eq!(entry_folder(&entry, ID), Some(rels.join("App")), "隣に distribute.json がある入口");
        assert_eq!(entry_folder(&d.join("a.zip"), ID), None);
        // 新しい PC: 入口を開くだけで配る版を取り込み、app に据える
        let v = view_of(&release::scan(&rels, ID), &rels, false, "src", "App");
        assert_eq!((v["versions"].as_array().unwrap().len(), v["entry"]["exists"].as_bool()), (2, Some(true)));
        assert_eq!(install_from_entry(&p, &rels.join("App"), ID, &|_| {}).unwrap(), "1.10.0");
        assert_eq!(update::dist_version(&p.app()).as_deref(), Some("1.10.0"));
        assert_eq!(remembered_entry(&p), Some(rels.join("App")), "入口の置き場を控える");
        assert_eq!(read_json(&p.want()).unwrap()["version"], "1.10.0", "配る版を覚える");
        assert_eq!(install_from_entry(&p, &rels.join("App"), ID, &|_| {}).unwrap(), "1.10.0", "2 回目は写さない");
        // 消す: 配っている版は消さない
        assert!(remove_version(&rels, "1.10.0", ID).unwrap_err().contains("配っている版"));
        let r = remove_version(&rels, "1.10.1", ID).unwrap();
        assert_eq!((r["removed"].as_u64(), r["notes"].as_array().unwrap().len()), (Some(1), 0), "{r}");
        assert!(!rels.join("App").join("1.10.1").exists());
        let left: Vec<_> = std::fs::read_dir(rels.join("App")).unwrap().flatten().map(|e| e.file_name()).collect();
        assert!(left.iter().all(|n| !n.to_string_lossy().contains("removing")), "消しかけを残さない: {left:?}");
        assert!(remove_version(&rels, "1.10.1", ID).unwrap_err().contains("ありません"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_half_removed_version_is_not_seen_by_any_pc() {
        let d = tmp("dist-half");
        let rels = d.join("Releases");
        let dir = rels.join("App").join(".1.10.1.removing-1");
        std::fs::create_dir_all(&dir).unwrap();
        let rel = json!({"schema": 1, "app_id": ID, "name": "App", "version": "1.10.1", "zip": "a.zip", "sha256": "a".repeat(64), "exe": "App.exe"});
        std::fs::write(dir.join(MARKER), serde_json::to_vec(&rel).unwrap()).unwrap();
        assert!(release::scan(&rels, ID).versions.is_empty(), "消しかけ（「.」で始まる名前）は取り込まない");
        let _ = std::fs::remove_dir_all(&d);
    }
}
