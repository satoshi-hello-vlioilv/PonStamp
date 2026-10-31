//! 更新とこの PC の写し（LotScope の形をそのまま使う）。
//!
//! - 共有・BOX・展開したフォルダの exe を開くと、この PC の `app\` へ写してから、写した方で開く（localize）
//! - `app\` の exe（入口）は、版ごとの写し `desktop\<印>\` へ渡して終わる（handoff）。動いている窓が `app\` を掴まないので入れ替えられる
//! - 使っている間に置き場の新しい版を裏で取り込み、指紋と中身を確かめて `update\stage\` に置いておく（起動を待たせない）
//! - 入れ替えは起動の最初（apply_staged）。起動の最初には置き場も確かめ、閉じている間に配られた版も 1 回の起動で入る（launch_check）
//! - 入れ替えた版の画面が出なければ（確かめの合図 page_ready が来ないまま次の起動になったら）、控えの前の版へ戻す（guard_applied）
//!
//! 配る形（ZIP の中・`app\`）は exe と名乗り `app.json`（{app_id, name, exe, version}）が並ぶフォルダ。画面は exe に入っている。
//! ここは窓に依らない処理だけ（試験から直に呼ぶ）。窓の係（裏の糸・画面への答え）は src/updater.rs。

use crate::paths::{now_text, read_json, write_json, Paths};
use crate::release::{self, newer, parse_version, Release, Scan};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

/// 配る形の名乗り（exe の隣）。
pub const MANIFEST: &str = "app.json";
/// 展開してよい大きさ（これを超える ZIP は断る）。
pub const MAX_BYTES: u64 = 1 << 30;
/// 入れ替えた版の画面が出ないまま起動してよい回数（これを超えたら控えへ戻す）。1 回: 入れ替えた版で開いて画面が出ないまま終われば、
/// 次に開いたときに前の版へ戻す（利用者が壊れた版を何度も開かなくてよい）。
pub const MAX_UNCONFIRMED_STARTS: u64 = 1;
/// 使用中（ウイルス対策の検査・終わる途中のプロセス）で断られた名前の付け替えを待つ長さ。
const BUSY_WAIT: Duration = Duration::from_millis(3000);
const BUSY_STEP: Duration = Duration::from_millis(150);

/// 配る形の名乗り（dir\app.json）。
pub fn manifest(dir: &Path) -> Option<Value> {
    read_json(&dir.join(MANIFEST)).filter(Value::is_object)
}

/// 配る形の版（名乗りの version が X.Y.Z なら）。
pub fn dist_version(dir: &Path) -> Option<String> {
    let v = manifest(dir)?["version"].as_str()?.to_string();
    parse_version(&v).map(|_| v)
}

/// このアプリの配る形か（名乗りの目印が合う）。
pub fn is_dist(dir: &Path, app_id: &str) -> bool {
    manifest(dir).is_some_and(|m| m["app_id"] == app_id)
}

/// 配る形（exe と名乗りが並ぶフォルダ）を確かめる → 版。版を指定すれば一致も見る。
pub fn validate_dist(dir: &Path, exe: &str, app_id: &str, expect: Option<&str>) -> Result<String, String> {
    let m = manifest(dir).ok_or(format!("{MANIFEST}（配る形の名乗り）がありません"))?;
    if m["app_id"].as_str() != Some(app_id) {
        return Err(format!("このアプリの物ではありません（{MANIFEST} の app_id が違います）"));
    }
    if !dir.join(exe).is_file() {
        return Err(format!("{exe} がありません"));
    }
    let v = dist_version(dir).ok_or(format!("{MANIFEST} の版を読めません"))?;
    if let Some(want) = expect {
        if v != want {
            return Err(format!("中身の版（{v}）が置き場の版（{want}）と違います"));
        }
    }
    Ok(v)
}

pub fn sha256_file(p: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(p)?;
    let mut h = Sha256::new();
    std::io::copy(&mut f, &mut h)?;
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// ZIP を dest へ展開する。絶対パス・ドライブ名・`..`・リンクの名前があれば断る。合計が MAX_BYTES を超えれば断る。
pub fn extract_zip(zip: &Path, dest: &Path) -> Result<(), String> {
    let f = std::fs::File::open(zip).map_err(|e| format!("ZIP を開けません: {e}"))?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| format!("ZIP として読めません: {e}"))?;
    let mut total = 0u64;
    for i in 0..z.len() {
        let mut e = z.by_index(i).map_err(|e| format!("ZIP の中を読めません: {e}"))?;
        let name = e.name().map_err(|e| format!("ZIP の中の名前を読めません: {e}"))?.to_string();
        let rel = Path::new(&name);
        let bad = name.contains(':')
            || name.starts_with(['/', '\\'])
            || rel.components().any(|c| !matches!(c, Component::Normal(_)))
            || e.is_symlink()
            || name.split(['/', '\\']).any(|p| p == "..");
        if bad {
            return Err(format!("ZIP に危ない名前があります: {name}"));
        }
        total = total.saturating_add(e.size());
        if total > MAX_BYTES {
            return Err("ZIP の中身が 1 GB を超えます".into());
        }
        let out = dest.join(rel);
        if e.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(d) = out.parent() {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        // 名乗った大きさより多くは読まない（名乗りで数えているので、実際の展開が名乗りを超えたら断る）
        let said = e.size();
        let mut buf = Vec::new();
        (&mut e).take(said.saturating_add(1)).read_to_end(&mut buf).map_err(|e| format!("ZIP の中を読めません（{name}）: {e}"))?;
        if buf.len() as u64 > said {
            return Err(format!("ZIP の中身が名乗った大きさを超えます: {name}"));
        }
        std::fs::write(&out, &buf).map_err(|e| format!("{} を書けません: {e}", out.display()))?;
        // 実行の許可を戻す（Linux などの試験の窓。Windows には無い考え）
        #[cfg(unix)]
        if let Some(mode) = e.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&out, std::fs::Permissions::from_mode(mode & 0o777));
        }
    }
    Ok(())
}

/// 展開したフォルダの中の配る形の根（名乗り app.json がある所。先頭のフォルダ名には頼らない）。
pub fn dist_root(dir: &Path) -> Option<PathBuf> {
    if dir.join(MANIFEST).is_file() {
        return Some(dir.to_path_buf());
    }
    let subs: Vec<PathBuf> = std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    match subs.as_slice() {
        [one] if one.join(MANIFEST).is_file() => Some(one.clone()),
        _ => None,
    }
}

/// 起動できなかった版。
pub fn failed_versions(p: &Paths) -> Vec<String> {
    read_json(&p.failed())
        .and_then(|v| v["versions"].as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|x| x.as_str().map(str::to_string))
        .collect()
}

pub fn mark_failed(p: &Paths, version: &str) {
    let mut vs = failed_versions(p);
    if !vs.iter().any(|v| v == version) {
        vs.push(version.to_string());
    }
    let _ = write_json(&p.failed(), &json!({ "versions": vs }));
}

/// 取り込み済みの次の版（stage.json の中身）。版のフォルダが無ければ None。
pub fn staged(p: &Paths) -> Option<Value> {
    let v = read_json(&p.stage_record())?;
    p.stage().join(MANIFEST).is_file().then_some(v)
}

/// 置き場の版を裏で取り込む: 手元へ写す → 指紋を照らす → 展開 → 中身を確かめる → update\stage へ（前の取り込みは捨てる）。
/// 動いているアプリには触らない（入れ替えは次の起動の最初・apply_staged）。
pub fn stage_release(p: &Paths, rel: &Release, app_id: &str, progress: &dyn Fn(&str)) -> Result<Value, String> {
    let work = p.work();
    std::fs::create_dir_all(&work).map_err(|e| format!("{} を作れません: {e}", work.display()))?;
    let pid = std::process::id();
    let (dl, tmp) = (work.join(format!("dl-{pid}.zip")), work.join(format!("stage-tmp-{pid}")));
    let clean = || {
        let _ = std::fs::remove_file(&dl);
        let _ = std::fs::remove_dir_all(&tmp);
    };
    clean();
    let result = (|| {
        progress(&format!("版 {} を写しています", rel.version));
        std::fs::copy(rel.zip_path(), &dl).map_err(|e| format!("置き場の ZIP を写せません（{}）: {e}", rel.zip_path().display()))?;
        progress(&format!("版 {} の指紋を確かめています", rel.version));
        let sum = sha256_file(&dl).map_err(|e| e.to_string())?;
        if sum != rel.sha256 {
            return Err(format!("ZIP の指紋が release.json と違います（置いている途中か、壊れています）: {}", rel.zip));
        }
        extract_zip(&dl, &tmp)?;
        let root = dist_root(&tmp).ok_or(format!("ZIP に {MANIFEST} がありません"))?;
        validate_dist(&root, &rel.exe, app_id, Some(&rel.version))?;
        let _ = std::fs::remove_dir_all(p.stage());
        let _ = std::fs::remove_file(p.stage_record());
        std::fs::rename(&root, p.stage()).map_err(|e| format!("取り込んだ版を置けません: {e}"))?;
        let rec = json!({"version": rel.version, "exe": rel.exe, "sha256": rel.sha256, "from": rel.zip_path(), "at": now_text()});
        write_json(&p.stage_record(), &rec)?;
        Ok(rec)
    })();
    clean();
    result
}

/// 名前の付け替え。「使用中」（Windows の 5・32・33）だけは BUSY_WAIT まで待ってやり直す。
pub fn rename_patiently(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut waited = Duration::ZERO;
    loop {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if matches!(e.raw_os_error(), Some(5 | 32 | 33)) && waited < BUSY_WAIT => {
                std::thread::sleep(BUSY_STEP);
                waited += BUSY_STEP;
            }
            Err(e) => return Err(e),
        }
    }
}

/// フォルダ new を app に据える（今の app は old へ。途中で失敗したら戻す）。
fn swap_in(p: &Paths, new: &Path) -> Result<(), String> {
    let (app, old) = (p.app(), p.old());
    let _ = std::fs::remove_dir_all(&old);
    let had = app.exists();
    if had {
        rename_patiently(&app, &old).map_err(|e| format!("この PC のアプリを入れ替えられません（使用中）: {e}"))?;
    }
    if let Err(e) = rename_patiently(new, &app) {
        if had {
            let _ = std::fs::rename(&old, &app);
        }
        return Err(format!("新しい版を置けません: {e}"));
    }
    Ok(())
}

/// 入れ替えた結果。
#[derive(Debug, PartialEq)]
pub struct Applied {
    pub from: String,
    pub to: String,
}

/// 起動の最初: 取り込み済みの版があれば app と入れ替える。起動できなかった版・同じ版は入れ替えない（取り込みを捨てる）。
pub fn apply_staged(p: &Paths) -> Result<Option<Applied>, String> {
    let Some(rec) = staged(p) else { return Ok(None) };
    let to = rec["version"].as_str().unwrap_or("").to_string();
    let from = dist_version(&p.app()).unwrap_or_default();
    if to.is_empty() || to == from || failed_versions(p).contains(&to) {
        let _ = std::fs::remove_dir_all(p.stage());
        let _ = std::fs::remove_file(p.stage_record());
        return Ok(None);
    }
    swap_in(p, &p.stage())?;
    let _ = std::fs::remove_file(p.stage_record());
    write_json(&p.applied(), &json!({"from": from, "to": to, "at": now_text(), "starts": 0}))?;
    Ok(Some(Applied { from, to }))
}

/// 入れ替えた版が起動できなかった: その版に印を付け、控え（直前の版）へ戻す。→ 戻した版（戻せなければ None）。
pub fn revert(p: &Paths) -> Option<Applied> {
    let rec = read_json(&p.applied())?;
    let (from, to) = (rec["from"].as_str().unwrap_or("").to_string(), rec["to"].as_str().unwrap_or("").to_string());
    mark_failed(p, &to);
    let _ = std::fs::remove_file(p.applied());
    if !p.old().join(MANIFEST).is_file() {
        return None;
    }
    let broken = p.work().join(format!("broken-{}", std::process::id()));
    rename_patiently(&p.app(), &broken).ok()?;
    if rename_patiently(&p.old(), &p.app()).is_err() {
        let _ = std::fs::rename(&broken, p.app());
        return None;
    }
    let _ = std::fs::remove_dir_all(&broken);
    Some(Applied { from: to, to: from })
}

/// 画面が出た（確かめの合図）: 入れ替えた直後の印を消す（控えは次の入れ替えまで残す）。
pub fn confirm(p: &Paths) {
    let _ = std::fs::remove_file(p.applied());
}

/// 起動の最初に、入れ替えた直後の版を見張る。
#[derive(Debug, PartialEq)]
pub enum Guard {
    /// 入れ替えた直後ではない・まだ試してよい
    Go,
    /// 画面が出ないまま起動が続いた → 控えへ戻した（開き直す）
    Reverted(Applied),
}

/// 入れ替えた直後の版で起動するたびに数え、MAX_UNCONFIRMED_STARTS 回を超えて画面が出なければ控えへ戻す。
pub fn guard_applied(p: &Paths) -> Guard {
    let Some(mut rec) = read_json(&p.applied()) else { return Guard::Go };
    let starts = rec["starts"].as_u64().unwrap_or(0);
    if starts >= MAX_UNCONFIRMED_STARTS {
        return match revert(p) {
            Some(a) => Guard::Reverted(a),
            None => Guard::Go,
        };
    }
    rec["starts"] = json!(starts + 1);
    let _ = write_json(&p.applied(), &rec);
    Guard::Go
}

/// 置き場を探した結果から、取り込む版を決める（裏の確かめと起動の最初で同じ決め方）。
#[derive(Debug, PartialEq)]
pub enum Pick<'a> {
    /// 取り込む版が無い（理由。いまの版が最新なら None）
    Stay(Option<String>),
    /// この版を取り込む（向き: up＝新しい版へ・down＝配る版を前の版に戻した）
    Take(&'a Release, &'static str),
}

/// 配る版が決まっていればその版（前の版へ戻すときも）、決まっていなければいちばん新しい版。起動できなかった版は選ばない。
pub fn pick<'a>(scan: &'a Scan, failed: &[String], current: &str) -> Pick<'a> {
    let target = match &scan.distribute {
        Some(d) => scan.find(&d.version).filter(|r| !failed.contains(&r.version)),
        None => scan.by_version().into_iter().find(|r| !failed.contains(&r.version)),
    };
    let Some(target) = target else {
        return Pick::Stay(Some(match &scan.distribute {
            Some(d) if failed.contains(&d.version) => format!("配る版 {} はこの PC で起動できなかったので使いません", d.version),
            Some(d) => format!("配る版 {} がまだ置き場にありません（同期待ちかもしれません）", d.version),
            None => "置き場にこのアプリの版がありません".into(),
        }));
    };
    if target.version == current || (scan.distribute.is_none() && !newer(&target.version, current)) {
        return Pick::Stay(None);
    }
    Pick::Take(target, if newer(&target.version, current) { "up" } else { "down" })
}

/// 更新の置き場を控える（空なら控えを消す＝起動の最初には確かめない）。
pub fn remember_source(p: &Paths, source: &str) {
    if source.trim().is_empty() {
        let _ = std::fs::remove_file(p.source_record());
    } else if remembered_source(p).as_deref() != Some(source) {
        let _ = write_json(&p.source_record(), &json!({"source": source, "at": now_text()}));
    }
}

/// 控えた更新の置き場（無ければ None）。
pub fn remembered_source(p: &Paths) -> Option<String> {
    read_json(&p.source_record())?["source"].as_str().map(str::to_string).filter(|s| !s.trim().is_empty())
}

/// 起動の最初に確かめた結果。
#[derive(Debug, PartialEq)]
pub enum Launch {
    /// 確かめなかった・取り込む版が無い（理由）
    Nothing(String),
    /// 置き場に届くのに時間が掛かるので待たなかった（裏の確かめに任せる）
    Slow,
    /// 取り込んだ（または取り込み済みだった）版。このあと apply_staged が入れ替える
    Staged(String),
    /// 取り込めなかった（理由。いまの版のまま開く）
    Failed(String),
}

/// 起動の最初: 置き場（source。区切りの候補つき）を探し、取り込む版があれば取り込む。
/// 置き場を探すのは別の糸で、wait を過ぎたら待たない（届かない共有で起動を待たせない）。配る版を作業場所に覚える（want.json）。
pub fn launch_check(p: &Paths, source: &str, app_id: &str, current: &str, wait: Duration, progress: &dyn Fn(&str)) -> Launch {
    if source.trim().is_empty() {
        return Launch::Nothing("更新の置き場を控えていません".into());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let (src, id) = (source.to_string(), app_id.to_string());
    std::thread::spawn(move || {
        let _ = tx.send(release::locate_source(&src).map(|(found, _)| release::scan(&found, &id)));
    });
    let scan = match rx.recv_timeout(wait) {
        Ok(Ok(scan)) => scan,
        Ok(Err(e)) => return Launch::Nothing(e),
        Err(_) => return Launch::Slow,
    };
    remember_want(p, &scan);
    match pick(&scan, &failed_versions(p), current) {
        Pick::Stay(why) => Launch::Nothing(why.unwrap_or_else(|| format!("版 {current} が最新です"))),
        Pick::Take(rel, _) if staged(p).is_some_and(|s| s["version"] == json!(rel.version)) => Launch::Staged(rel.version.clone()),
        Pick::Take(rel, _) => match stage_release(p, rel, app_id, progress) {
            Ok(_) => Launch::Staged(rel.version.clone()),
            Err(e) => Launch::Failed(format!("版 {} を取り込めません: {e}", rel.version)),
        },
    }
}

/// 配る版を作業場所に覚える（決まっていなければ消す）。
pub fn remember_want(p: &Paths, scan: &Scan) {
    match &scan.distribute {
        Some(d) => {
            let _ = write_json(&p.want(), &d.raw);
        }
        None => {
            let _ = std::fs::remove_file(p.want());
        }
    }
}

/// 写した exe から「インターネットから来た」印（Zone.Identifier）を外す（開くたびの実行前の警告を出さない）。
/// Windows の写し方は印も写すので、出どころの分かっている自分で写した物だけ外す。ほかの OS には印が無い。
pub fn drop_web_mark(path: &Path) {
    if cfg!(windows) {
        let mut s = path.as_os_str().to_os_string();
        s.push(":Zone.Identifier");
        let _ = std::fs::remove_file(PathBuf::from(s));
    }
}

/// 配る形（共有・BOX・展開したフォルダ）をこの PC の app へ写す（exe・名乗り・README）。
pub fn localize(p: &Paths, dist: &Path, exe: &str, app_id: &str) -> Result<String, String> {
    let version = validate_dist(dist, exe, app_id, None)?;
    std::fs::create_dir_all(p.work()).map_err(|e| e.to_string())?;
    let tmp = p.work().join(format!("local-tmp-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let copy = (|| {
        std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
        for name in [exe, MANIFEST, "README.md"] {
            let from = dist.join(name);
            if from.is_file() {
                std::fs::copy(&from, tmp.join(name)).map_err(|e| format!("{name} を写せません: {e}"))?;
            }
        }
        drop_web_mark(&tmp.join(exe));
        validate_dist(&tmp, exe, app_id, Some(&version))?;
        swap_in(p, &tmp)
    })();
    let _ = std::fs::remove_dir_all(&tmp);
    copy.map(|_| version)
}

/// app を写すべきか: まだ無い・この配る形の方が新しい（古い共有の exe を開いても戻さない）。
pub fn should_localize(p: &Paths, dist_version: &str) -> bool {
    match self::dist_version(&p.app()) {
        None => true,
        Some(have) => newer(dist_version, &have) && !failed_versions(p).iter().any(|v| v == dist_version),
    }
}

/// 起動のはじめに何をするか。
#[derive(Debug, PartialEq)]
pub enum Step {
    /// このまま窓として動く（版ごとの写し・開発・配る形でない所の exe）
    Stay,
    /// app の exe（入口）: 版ごとの写しへ渡して終わる
    Handoff,
    /// app の外（共有・BOX・展開したフォルダ）の配る形: この PC の app へ写して（新しければ）から入口を開く
    Localize(PathBuf),
}

fn same(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

fn inside(me: &Path, dir: &Path) -> bool {
    me.starts_with(dir) || std::fs::canonicalize(me).is_ok_and(|m| std::fs::canonicalize(dir).is_ok_and(|d| m.starts_with(d)))
}

/// 決める（純粋な判断・試験が直に確かめる）。me＝いま動いている exe、dev＝開発・引き継がない指定。
pub fn plan(p: &Paths, me: &Path, exe: &str, app_id: &str, dev: bool) -> Step {
    if dev || inside(me, &p.desktop()) {
        return Step::Stay;
    }
    if same(me, &p.app().join(exe)) || me.parent().is_some_and(|d| same(d, &p.app())) {
        return Step::Handoff;
    }
    match me.parent() {
        Some(dir) if is_dist(dir, app_id) => Step::Localize(dir.to_path_buf()),
        _ => Step::Stay,
    }
}

/// この PC のアプリ（app）から動いているか（版ごとの写し・入口そのもの）。更新を取り込むのはこのときだけ。
pub fn running_installed(p: &Paths, me: &Path, exe: &str) -> bool {
    p.app().join(exe).is_file() && (inside(me, &p.desktop()) || same(me, &p.app().join(exe)))
}

/// 版ごとの写しの置き場（exe の大きさ＋更新時刻。中身が変われば別の場所）。
pub fn copy_for_run(p: &Paths, app_exe: &Path) -> Result<PathBuf, String> {
    let m = std::fs::metadata(app_exe).map_err(|e| format!("{} を読めません: {e}", app_exe.display()))?;
    let t = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let dir = p.desktop().join(format!("{}-{t}", m.len()));
    let dest = dir.join(app_exe.file_name().unwrap_or_default());
    if dest.is_file() && std::fs::metadata(&dest).map(|d| d.len()).ok() == Some(m.len()) {
        return Ok(dest);
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("{} を作れません: {e}", dir.display()))?;
    let tmp = dir.join(format!(".copy-{}", std::process::id()));
    std::fs::copy(app_exe, &tmp).map_err(|e| format!("exe を写せません: {e}"))?;
    drop_web_mark(&tmp);
    std::fs::rename(&tmp, &dest).map_err(|e| format!("exe を置けません: {e}"))?;
    Ok(dest)
}

/// 古い版ごとの写しを片付ける（動いている版は消せないので、消せた物だけ）。
/// 前の版の窓（終わらせて、いまの版に代わる物）: いまの exe が版ごとの写しなら、ほかの写しから動いている窓（pid）。
///
/// 写しは app の exe から作るので、ほかの写しは app が入れ替わる前の物（古い版）。古い窓が常駐したままだと、
/// 「1 つだけ起動」の仕組みで古い窓が前に出るだけになり、新しい版に移れない（1.0・1.1 の利用者は、止まる版から抜けられなかった）。
/// 同じ写しの窓（同じ版）は代わらない（いつもどおり、前の窓を前に出す）。
pub fn stale_windows(p: &Paths, me: &Path, my_pid: u32, running: &[(u32, PathBuf)]) -> Vec<u32> {
    if !inside(me, &p.desktop()) {
        return vec![];
    }
    running.iter().filter(|(pid, exe)| *pid != my_pid && inside(exe, &p.desktop()) && !same(exe, me)).map(|(pid, _)| *pid).collect()
}

pub fn cleanup_copies(p: &Paths, keep: &Path) {
    for e in std::fs::read_dir(p.desktop()).into_iter().flatten().flatten() {
        let path = e.path();
        if path.is_dir() && !keep.starts_with(&path) {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::paths::tmp;
    use std::io::Write;

    pub const EXE: &str = "App.exe";
    pub const ID: &str = "local.test.app";

    /// 配る形を作る（exe・名乗り）。
    pub fn dist(dir: &Path, version: &str, exe_body: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(EXE), exe_body).unwrap();
        let m = json!({"app_id": ID, "name": "App", "exe": EXE, "version": version});
        std::fs::write(dir.join(MANIFEST), serde_json::to_vec(&m).unwrap()).unwrap();
    }

    pub fn zip_of(dir: &Path, top: &str, out: &Path) -> String {
        let f = std::fs::File::create(out).unwrap();
        let mut z = zip::ZipWriter::new(f);
        let opt = zip::write::SimpleFileOptions::default();
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            z.start_file(format!("{top}/{}", e.file_name().to_string_lossy()), opt).unwrap();
            z.write_all(&std::fs::read(e.path()).unwrap()).unwrap();
        }
        z.finish().unwrap();
        sha256_file(out).unwrap()
    }

    fn release(dir: &Path, version: &str, sha: &str) -> Release {
        Release {
            dir: dir.to_path_buf(),
            name: "App".into(),
            version: version.into(),
            zip: "App.zip".into(),
            sha256: sha.into(),
            exe: EXE.into(),
            raw: Value::Null,
        }
    }

    #[test]
    fn manifest_is_read_and_checked() {
        let d = tmp("upd-ver");
        dist(&d, "1.2.0", "x");
        assert_eq!(dist_version(&d).as_deref(), Some("1.2.0"));
        assert_eq!(validate_dist(&d, EXE, ID, Some("1.2.0")), Ok("1.2.0".into()));
        assert!(validate_dist(&d, EXE, "other", None).unwrap_err().contains("このアプリの物ではありません"), "ほかのアプリは断る");
        assert!(validate_dist(&d, EXE, ID, Some("1.2.1")).unwrap_err().contains("違います"));
        assert!(validate_dist(&d, "Other.exe", ID, None).unwrap_err().contains("ありません"), "exe が無い");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn stage_then_apply_then_revert() {
        let d = tmp("upd-flow");
        let p = Paths::new(&d.join("local"));
        dist(&d.join("share"), "1.9.0", "exe-1");
        assert!(should_localize(&p, "1.9.0"));
        assert_eq!(localize(&p, &d.join("share"), EXE, ID), Ok("1.9.0".into()));
        assert!(!should_localize(&p, "1.9.0") && !should_localize(&p, "1.8.0"), "同じ版・古い共有の exe では写さない");
        dist(&d.join("new"), "1.10.0", "exe-2");
        let rel_dir = d.join("rel");
        std::fs::create_dir_all(&rel_dir).unwrap();
        let sha = zip_of(&d.join("new"), "App", &rel_dir.join("App.zip"));
        let rec = stage_release(&p, &release(&rel_dir, "1.10.0", &sha), ID, &|_| {}).unwrap();
        assert_eq!(rec["version"], "1.10.0");
        assert_eq!(dist_version(&p.app()).as_deref(), Some("1.9.0"), "取り込んでも動いている app には触らない");
        let a = apply_staged(&p).unwrap().unwrap();
        assert_eq!((a.from.as_str(), a.to.as_str()), ("1.9.0", "1.10.0"));
        assert_eq!(std::fs::read_to_string(p.app().join(EXE)).unwrap(), "exe-2");
        assert_eq!(dist_version(&p.old()).as_deref(), Some("1.9.0"), "直前の版は控えに");
        let back = revert(&p).unwrap();
        assert_eq!((back.from.as_str(), back.to.as_str()), ("1.10.0", "1.9.0"));
        assert_eq!(dist_version(&p.app()).as_deref(), Some("1.9.0"));
        assert_eq!(failed_versions(&p), ["1.10.0"]);
        stage_release(&p, &release(&rel_dir, "1.10.0", &sha), ID, &|_| {}).unwrap();
        assert_eq!(apply_staged(&p).unwrap(), None, "起動できなかった版へは入れ替えない");
        assert!(!should_localize(&p, "1.10.0"), "起動できなかった版を共有から写し直さない");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn an_applied_version_whose_screen_never_appears_is_reverted() {
        let d = tmp("upd-guard");
        let p = Paths::new(&d.join("local"));
        dist(&d.join("share"), "1.0.0", "exe-1");
        localize(&p, &d.join("share"), EXE, ID).unwrap();
        dist(&d.join("new"), "1.1.0", "exe-2");
        let rel_dir = d.join("rel");
        std::fs::create_dir_all(&rel_dir).unwrap();
        let sha = zip_of(&d.join("new"), "App", &rel_dir.join("App.zip"));
        stage_release(&p, &release(&rel_dir, "1.1.0", &sha), ID, &|_| {}).unwrap();
        apply_staged(&p).unwrap().unwrap();
        // 画面が出れば（confirm）、見張りは終わる
        assert_eq!(guard_applied(&p), Guard::Go);
        confirm(&p);
        assert_eq!(guard_applied(&p), Guard::Go);
        assert!(!p.applied().exists());
        // 画面が出ないまま起動が続くと、控えへ戻す
        write_json(&p.applied(), &json!({"from": "1.0.0", "to": "1.1.0", "starts": 0})).unwrap();
        for _ in 0..MAX_UNCONFIRMED_STARTS {
            assert_eq!(guard_applied(&p), Guard::Go, "決めた回数まではその版で試す");
        }
        assert_eq!(guard_applied(&p), Guard::Reverted(Applied { from: "1.1.0".into(), to: "1.0.0".into() }));
        assert_eq!(dist_version(&p.app()).as_deref(), Some("1.0.0"));
        assert_eq!(failed_versions(&p), ["1.1.0"]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn staging_refuses_bad_zips_and_leaves_nothing() {
        let d = tmp("upd-bad");
        let p = Paths::new(&d.join("local"));
        dist(&d.join("new"), "1.10.0", "x");
        let rel_dir = d.join("rel");
        std::fs::create_dir_all(&rel_dir).unwrap();
        let sha = zip_of(&d.join("new"), "App", &rel_dir.join("App.zip"));
        assert!(stage_release(&p, &release(&rel_dir, "1.10.0", &"0".repeat(64)), ID, &|_| {}).unwrap_err().contains("指紋"));
        assert!(stage_release(&p, &release(&rel_dir, "1.11.0", &sha), ID, &|_| {}).unwrap_err().contains("版"));
        let evil = rel_dir.join("evil.zip");
        {
            let mut z = zip::ZipWriter::new(std::fs::File::create(&evil).unwrap());
            z.start_file("../outside.txt", zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(b"x").unwrap();
            z.finish().unwrap();
        }
        let mut r = release(&rel_dir, "1.10.0", &sha256_file(&evil).unwrap());
        r.zip = "evil.zip".into();
        assert!(stage_release(&p, &r, ID, &|_| {}).unwrap_err().contains("危ない"));
        assert!(!d.join("outside.txt").exists() && !d.join("local").join("outside.txt").exists(), "外に書かない");
        let left: Vec<_> = std::fs::read_dir(p.work()).unwrap().flatten().map(|e| e.file_name()).collect();
        assert!(left.is_empty(), "途中の物を残さない: {left:?}");
        assert!(staged(&p).is_none());
        let _ = std::fs::remove_dir_all(&d);
    }

    /// 置き場（rel/App/<版>/）に版を置く（release.json と ZIP）
    pub fn put_release(d: &Path, rel: &Path, version: &str) {
        let src = d.join(format!("src-{version}"));
        dist(&src, version, &format!("exe-{version}"));
        let dir = rel.join("App").join(version);
        std::fs::create_dir_all(&dir).unwrap();
        let sha = zip_of(&src, "App", &dir.join("App.zip"));
        let v = json!({"schema": 1, "app_id": ID, "name": "App", "version": version, "zip": "App.zip", "sha256": sha, "exe": EXE});
        std::fs::write(dir.join(crate::release::MARKER), serde_json::to_vec(&v).unwrap()).unwrap();
    }

    #[test]
    fn launch_check_stages_a_version_distributed_while_closed() {
        let d = tmp("upd-launch");
        let p = Paths::new(&d.join("local"));
        dist(&d.join("share"), "1.9.0", "exe-1.9.0");
        localize(&p, &d.join("share"), EXE, ID).unwrap();
        let rel = d.join("Releases");
        put_release(&d, &rel, "1.9.0");
        let src = rel.display().to_string();
        let wait = Duration::from_secs(10);
        assert_eq!(launch_check(&p, "", ID, "1.9.0", wait, &|_| {}), Launch::Nothing("更新の置き場を控えていません".into()));
        assert!(matches!(launch_check(&p, &src, ID, "1.9.0", wait, &|_| {}), Launch::Nothing(_)), "いまの版が最新なら取り込まない");
        put_release(&d, &rel, "1.10.0");
        let said = std::cell::RefCell::new(vec![]);
        assert_eq!(launch_check(&p, &src, ID, "1.9.0", wait, &|t| said.borrow_mut().push(t.to_string())), Launch::Staged("1.10.0".into()));
        assert!(!said.borrow().is_empty(), "取り込みの進み具合を言う");
        assert_eq!(apply_staged(&p).unwrap().map(|a| a.to), Some("1.10.0".into()));
        std::fs::write(
            rel.join("App").join(crate::release::DISTRIBUTE),
            serde_json::to_vec(&json!({"schema": 1, "app_id": ID, "version": "1.9.0", "setAt": "2026-10-16T10:00:00"})).unwrap(),
        )
        .unwrap();
        assert_eq!(launch_check(&p, &src, ID, "1.10.0", wait, &|_| {}), Launch::Staged("1.9.0".into()), "配る版を戻した向きでも");
        assert_eq!(read_json(&p.want()).unwrap()["version"], "1.9.0", "配る版を作業場所に覚える");
        mark_failed(&p, "1.9.0");
        assert!(matches!(launch_check(&p, &src, ID, "1.10.0", wait, &|_| {}), Launch::Nothing(w) if w.contains("起動できなかった")));
        assert!(matches!(launch_check(&p, &d.join("無い").display().to_string(), ID, "1.10.0", wait, &|_| {}), Launch::Nothing(_)));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn launch_check_does_not_wait_for_a_slow_place() {
        let d = tmp("upd-slow");
        let p = Paths::new(&d.join("local"));
        let t0 = std::time::Instant::now();
        let r = launch_check(&p, &d.display().to_string(), ID, "1.9.0", Duration::ZERO, &|_| {});
        assert!(matches!(r, Launch::Slow | Launch::Nothing(_)), "{r:?}");
        assert!(t0.elapsed() < Duration::from_secs(2));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_source_is_remembered_for_the_next_launch() {
        let d = tmp("upd-source");
        let p = Paths::new(&d.join("local"));
        assert_eq!(remembered_source(&p), None);
        remember_source(&p, "C:\\Box\\PonStamp;D:\\rel");
        assert_eq!(remembered_source(&p).as_deref(), Some("C:\\Box\\PonStamp;D:\\rel"));
        remember_source(&p, " ");
        assert_eq!(remembered_source(&p), None, "置き場を外したら、起動の最初にも確かめない");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn pick_follows_the_distributed_version_and_skips_failed_ones() {
        let r = |v: &str| release(Path::new("x"), v, "s");
        let scan = Scan { versions: vec![r("1.9.0"), r("1.11.0"), r("1.10.0")], distribute: None, problems: vec![] };
        assert!(matches!(pick(&scan, &[], "1.9.0"), Pick::Take(x, "up") if x.version == "1.11.0"), "配る版が無ければいちばん新しい版");
        assert!(
            matches!(pick(&scan, &["1.11.0".into()], "1.9.0"), Pick::Take(x, "up") if x.version == "1.10.0"),
            "起動できなかった版は飛ばす"
        );
        assert_eq!(pick(&scan, &[], "1.11.0"), Pick::Stay(None));
        assert_eq!(pick(&scan, &[], "1.12.0"), Pick::Stay(None), "配る版が無ければ古い版へは戻さない");
        let down = Scan {
            distribute: Some(crate::release::Distribute { dir: "x".into(), version: "1.10.0".into(), raw: Value::Null }),
            ..scan.clone()
        };
        assert!(matches!(pick(&down, &[], "1.11.0"), Pick::Take(x, "down") if x.version == "1.10.0"), "配る版へは戻す向きでも");
        let missing =
            Scan { distribute: Some(crate::release::Distribute { dir: "x".into(), version: "1.12.0".into(), raw: Value::Null }), ..scan };
        assert!(matches!(pick(&missing, &[], "1.11.0"), Pick::Stay(Some(w)) if w.contains("まだ置き場にありません")));
    }

    #[test]
    fn plan_of_the_start() {
        let d = tmp("upd-plan");
        let p = Paths::new(&d.join("local"));
        dist(&d.join("share"), "1.9.0", "x");
        localize(&p, &d.join("share"), EXE, ID).unwrap();
        assert_eq!(plan(&p, &d.join("share").join(EXE), EXE, ID, false), Step::Localize(d.join("share")), "共有の exe はこの PC へ写す");
        assert_eq!(plan(&p, &p.app().join(EXE), EXE, ID, false), Step::Handoff, "入口は版ごとの写しへ渡す");
        let copy = copy_for_run(&p, &p.app().join(EXE)).unwrap();
        assert!(copy.starts_with(p.desktop()));
        assert_eq!(copy_for_run(&p, &p.app().join(EXE)).unwrap(), copy, "同じ exe なら写し直さない");
        assert_eq!(plan(&p, &copy, EXE, ID, false), Step::Stay, "版ごとの写しは窓として動く");
        assert!(running_installed(&p, &copy, EXE) && !running_installed(&p, &d.join("share").join(EXE), EXE));
        assert_eq!(plan(&p, &d.join("share").join(EXE), EXE, ID, true), Step::Stay, "開発は引き継がない");
        assert_eq!(plan(&p, &d.join("nowhere").join(EXE), EXE, ID, false), Step::Stay, "配る形でない所の exe はそのまま動く");
        std::fs::create_dir_all(p.desktop().join("old-1")).unwrap();
        cleanup_copies(&p, &copy);
        assert!(copy.is_file() && !p.desktop().join("old-1").exists(), "古い写しは片付け、動いている写しは残す");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_newer_copy_replaces_windows_of_other_copies_only() {
        let d = tmp("stale");
        let p = Paths::new(&d);
        let copy = |n: &str| {
            let f = p.desktop().join(n).join(EXE);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(&f, n).unwrap();
            f
        };
        let (old, new, other) = (copy("100-1"), copy("200-2"), d.join("elsewhere").join(EXE));
        let running = vec![(10, old.clone()), (20, new.clone()), (21, new.clone()), (30, other.clone())];
        assert_eq!(stale_windows(&p, &new, 20, &running), vec![10], "ほかの写し（古い版）の窓だけ。同じ写し・写しの外の物は残す");
        assert!(stale_windows(&p, &other, 30, &running).is_empty(), "写しでない exe（開発・写していない形）は何も終わらせない");
        assert!(stale_windows(&p, &old, 10, &[(10, old.clone())]).is_empty(), "自分は数えない");
    }
}
