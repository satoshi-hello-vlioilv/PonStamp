//! 配る形と更新の通しを、本物の窓で確かめる（評価関数）。Windows の CI と、手元の Linux（xvfb-run の下）で流す。
//!
//! ```text
//! cargo tools verify --exe <作った exe> [--work <作業フォルダ>] [--keep]
//! ```
//! 利用者の PC を真似る: 作業場所（PONSTAMP_LOCAL_ROOT）はまっさら、配る形は共有を真似たフォルダ、更新の置き場は BOX を真似たフォルダ。
//! 窓は自己診断（PONSTAMP_SELFTEST）で起こし、結果のファイル（desktop/src/selftest.js と main.rs の selftest_finish が書く）を読む。
//!
//! 1. 共有の exe を開く → この PC の app へ写り、版ごとの写しの窓で開く。使っている間に置き場の次の版（+1）を取り込む（ready）。ショートカットを尋ねる
//! 2. app の exe（ショートカットの行き先）を開く → 起動の最初に +1 へ入れ替わり、その版で開く。直前の版は控えに。共有を指すショートカットはこの PC の app に直る
//! 3. 閉じている間に次の版（+2）を置く → 1 回開くだけで +2 になる（起動の最初に取り込んで入れ替える）
//! 4. 閉じている間に起動できない版（+3）を置く → +3 に入れ替わるが画面が出ない。次に開くと控え（+2）へ戻り、+3 には印が付く（もう取り込まない）
//! 5. 配る版を前の版（+1）に戻す（distribute.json と配る入口）→ 1 回開くだけで配る版になり、配る版を作業場所に覚える（want.json）
//! 6. 新しい PC（まっさらな作業場所）が配る入口を開くだけで、配る版をこの PC へ入れて開き、入口の置き場を更新の置き場にする
//! 7. 古い版が常駐している間に、新しい版の exe（展開した ZIP）を開く → 古い窓は終わり、新しい版で開く
//!    （1 つだけ起動の仕組みで古い窓が前に出るだけだと、直した版に移れない。1.0・1.1 の利用者はこれで、止まる版から抜けられなかった）
//!
//! あわせて: 共有の配る形は 1 ファイルも変わらない・終わったあと窓が残らない。

use crate::bundle;
use crate::repo::{self, read_json};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const WAIT: Duration = Duration::from_secs(120);
const WINDOWS: bool = cfg!(windows);

fn bump(v: &str, n: u64) -> String {
    let (a, b, c) = ps_core::release::parse_version(v).expect("版は X.Y.Z");
    format!("{a}.{b}.{}", c + n)
}

/// フォルダの中身の要約（道と中身）。共有の配る形が変わっていないかを見る
fn tree_digest(root: &Path) -> String {
    let mut files = vec![];
    let mut stack = vec![root.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else {
                files.push(p);
            }
        }
    }
    let rel = |p: &Path| p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/");
    files.sort_by_key(|p| rel(p));
    let mut h = Sha256::new();
    for p in files {
        h.update(rel(&p).as_bytes());
        h.update(std::fs::read(&p).unwrap_or_default());
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// 版を ZIP にし、置き場の `<アプリ>/versions/<版>/` に release.json と並べて置く（画面の「版を置く」と同じ形。broken: 起動できない版の真似）
fn place(repo: &Path, exe: &Path, version: &str, rel_root: &Path, broken: bool) -> Result<(), String> {
    let name = repo::brand(repo)?.name;
    let tmp = repo::temp_dir(&format!("place-{version}"));
    let extra = broken.then(|| json!({"selftest_broken": true}));
    bundle::build(repo, exe, &tmp, Some(version), extra.as_ref())?;
    let dest = rel_root.join(&name).join("versions").join(version);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    for e in std::fs::read_dir(&tmp).map_err(|e| e.to_string())?.flatten() {
        let p = e.path();
        if p.is_file() && !p.to_string_lossy().ends_with(".sha256") {
            std::fs::copy(&p, dest.join(e.file_name())).map_err(|e| e.to_string())?;
        }
    }
    let _ = std::fs::remove_dir_all(&tmp);
    Ok(())
}

/// 配る版を決める（core の set_distributed と同じ形: distribute.json と配る入口の exe・名乗り）。→ 入口
fn distribute(repo: &Path, exe: &Path, version: &str, rel_root: &Path) -> Result<PathBuf, String> {
    let b = repo::brand(repo)?;
    let folder = rel_root.join(&b.name);
    std::fs::copy(exe, folder.join(&b.exe)).map_err(|e| e.to_string())?;
    let m = ps_core::update::manifest_record(&b.app_id, &b.name, &b.exe, version);
    std::fs::write(folder.join(ps_core::update::MANIFEST), m.to_string()).map_err(|e| e.to_string())?;
    let d = json!({"schema": 1, "app_id": b.app_id, "version": version, "entry": b.exe, "setAt": ps_core::paths::now_text(),
                   "setBy": "verify", "setPc": "verify", "previous": null});
    std::fs::write(folder.join(ps_core::release::DISTRIBUTE), d.to_string()).map_err(|e| e.to_string())?;
    Ok(folder.join(&b.exe))
}

fn powershell(script: &str) -> Result<String, String> {
    let out = Command::new("powershell").args(["-NoProfile", "-Command", script]).output().map_err(|e| format!("powershell: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// 人が作った、共有の exe を指すショートカット（Windows は本物の .lnk、ほかは窓の lnk.rs と同じ JSON）
fn make_link(link: &Path, target: &Path) -> Result<(), String> {
    std::fs::create_dir_all(link.parent().unwrap()).map_err(|e| e.to_string())?;
    let workdir = target.parent().unwrap();
    if WINDOWS {
        powershell(&format!(
            "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');$s.TargetPath='{}';$s.WorkingDirectory='{}';$s.Save()",
            link.display(),
            target.display(),
            workdir.display()
        ))
        .map(|_| ())
    } else {
        let v = json!({"target": target, "workdir": workdir, "icon": target});
        std::fs::write(link, v.to_string()).map_err(|e| e.to_string())
    }
}

fn link_target(link: &Path) -> String {
    if WINDOWS {
        powershell(&format!("(New-Object -ComObject WScript.Shell).CreateShortcut('{}').TargetPath", link.display())).unwrap_or_default()
    } else {
        read_json(link).ok().and_then(|v| v["target"].as_str().map(str::to_string)).unwrap_or_default()
    }
}

/// 動いているこのアプリの exe（pid, exe の場所）。Linux は /proc、Windows は Win32_Process
fn processes(exe_name: &str) -> Vec<(u32, String)> {
    if WINDOWS {
        let script = format!(
            "Get-CimInstance Win32_Process -Filter \"Name='{exe_name}'\" | ForEach-Object {{ \"$($_.ProcessId) $($_.ExecutablePath)\" }}"
        );
        return powershell(&script)
            .unwrap_or_default()
            .lines()
            .filter_map(|l| {
                let (pid, path) = l.trim().split_once(' ').unwrap_or((l.trim(), ""));
                pid.parse().ok().map(|p| (p, path.to_string()))
            })
            .collect();
    }
    std::fs::read_dir("/proc")
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let pid: u32 = e.file_name().to_str()?.parse().ok()?;
            let exe = std::fs::read_link(format!("/proc/{pid}/exe")).ok()?;
            Some((pid, exe.to_string_lossy().into_owned()))
        })
        .collect()
}

fn norm(p: &str) -> String {
    if WINDOWS {
        p.to_lowercase()
    } else {
        p.to_string()
    }
}

/// 作業フォルダの下の exe がまだ動いているか（"pid exe の場所"）
fn leftovers(work: &Path, exe_name: &str) -> Vec<String> {
    let w = norm(&work.to_string_lossy());
    processes(exe_name).into_iter().filter(|(_, p)| norm(p).starts_with(&w)).map(|(pid, p)| format!("{pid} {p}")).collect()
}

/// 残った窓を終わらせる（確かめが失敗したときの片付け。次の確かめに残さない）
fn kill(rows: &[String]) {
    for row in rows {
        let pid = row.split_whitespace().next().unwrap_or("");
        let _ = if WINDOWS {
            Command::new("taskkill").args(["/F", "/PID", pid]).output()
        } else {
            Command::new("kill").args(["-9", pid]).output()
        };
    }
}

struct Run {
    work: PathBuf,
    root: PathBuf,
    n: u32,
    links: [PathBuf; 2],
    env: Vec<(String, String)>,
}

impl Run {
    fn new(work: &Path, root: &Path) -> Run {
        let home = work.join("home");
        let _ = std::fs::create_dir_all(&home);
        let links = [work.join("links").join("Desktop"), work.join("links").join("Programs")];
        let sep = if WINDOWS { ";" } else { ":" };
        let env = vec![
            ("PONSTAMP_LOCAL_ROOT".into(), root.display().to_string()),
            ("HOME".into(), home.display().to_string()),
            ("USERPROFILE".into(), home.display().to_string()),
            ("PONSTAMP_LINK_DIRS".into(), links.iter().map(|l| l.display().to_string()).collect::<Vec<_>>().join(sep)),
            ("PONSTAMP_AUTOSTART_DIR".into(), work.join("autostart").display().to_string()),
        ];
        Run { work: work.to_path_buf(), root: root.to_path_buf(), n: 0, links, env }
    }

    fn command(&self, exe: &Path) -> Command {
        let mut c = Command::new(exe);
        c.current_dir(exe.parent().unwrap()).env_remove("PONSTAMP_NO_HANDOFF").stdout(Stdio::null()).stderr(Stdio::null());
        for (k, v) in &self.env {
            c.env(k, v);
        }
        c
    }

    /// exe を開き、自己診断の結果を待つ（入口・写し・開き直しの窓をたどった先の窓が書く）。結果が無ければ None
    fn open(&mut self, exe: &Path, label: &str, wait: Duration) -> Option<Value> {
        self.n += 1;
        let out = self.work.join(format!("selftest-{}-{label}.json", self.n));
        let _ = self.command(exe).env("PONSTAMP_SELFTEST", &out).spawn();
        let end = Instant::now() + wait;
        while Instant::now() < end && !out.exists() {
            std::thread::sleep(Duration::from_millis(500));
        }
        std::thread::sleep(Duration::from_secs(2)); // 窓が終わるのを待つ
        read_json(&out).ok()
    }

    /// exe を常駐の形（窓を出さない・自己診断なし）で起こし、版ごとの写しの窓が動き出すまで待つ。→ 動いている写し（pid exe）
    fn start_resident(&self, exe: &Path, exe_name: &str, wait: Duration) -> Vec<String> {
        let _ = self.command(exe).arg("--tray").spawn();
        let desk = norm(&self.root.join("desktop").to_string_lossy());
        let end = Instant::now() + wait;
        while Instant::now() < end {
            let running: Vec<String> = leftovers(&self.work, exe_name).into_iter().filter(|x| norm(x).contains(&desk)).collect();
            if !running.is_empty() {
                std::thread::sleep(Duration::from_secs(3)); // 窓が「1 つだけ起動」の受け口を開くまで
                return running;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        vec![]
    }
}

#[derive(Default)]
struct Checks(Vec<bool>);

impl Checks {
    fn check(&mut self, name: &str, ok: bool, info: impl std::fmt::Display) -> bool {
        self.0.push(ok);
        println!("{}: {name} -- {info}", if ok { "PASS" } else { "FAIL" });
        ok
    }
    fn ok(&self) -> bool {
        self.0.iter().all(|x| *x)
    }
}

fn shell(r: &Option<Value>) -> Value {
    r.as_ref().map(|v| v["shell"].clone()).unwrap_or(Value::Null)
}

/// 通しを流す。→ すべて PASS か
pub fn run(repo: &Path, exe: &Path, work: &Path) -> Result<bool, String> {
    let b = repo::brand(repo)?;
    let v = repo::app_version(repo)?;
    let mut c = Checks::default();
    let _ = std::fs::remove_dir_all(work);
    std::fs::create_dir_all(work).map_err(|e| e.to_string())?;
    let (share, rel, root) = (work.join("share").join(&b.name), work.join("Releases"), work.join("root"));
    bundle::stage(repo, exe, &share, Some(&v), None)?;
    let share_digest = tree_digest(&share);
    place(repo, exe, &bump(&v, 1), &rel, false)?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    std::fs::write(root.join("state.json"), json!({"updateSource": rel}).to_string()).map_err(|e| e.to_string())?;
    let mut r = Run::new(work, &root);
    let app_exe = root.join("app").join(&b.exe);
    let s_str = |s: &Value, k: &str| s[k].as_str().unwrap_or("").to_string();

    // 1. 共有の exe を開く
    let r1 = r.open(&share.join(&b.exe), "share", WAIT);
    let s = shell(&r1);
    c.check(
        "1 共有の exe からこの PC へ写して開く",
        s["installed"] == true && s_str(&s, "version") == v && s_str(&s, "exe").contains(&root.join("desktop").display().to_string()),
        &s,
    );
    let failed: Vec<Value> =
        r1.as_ref().and_then(|x| x["results"].as_array().cloned()).unwrap_or_default().into_iter().filter(|x| x["ok"] != true).collect();
    c.check("1 画面の自己診断が通る", r1.as_ref().is_some_and(|x| x["ok"] == true), json!(failed));
    c.check(
        "1 使っている間に次の版を取り込む",
        s["update"]["state"] == "ready" && s["update"]["ready"] == bump(&v, 1).as_str(),
        &s["update"],
    );
    c.check("1 ショートカットを尋ねる", s["install"]["shortcut"]["ask"] == true, &s["install"]);
    let lnk = r.links[0].join(format!("{}.lnk", b.name));
    make_link(&lnk, &share.join(&b.exe))?;

    // 2. app の exe を開く → 入れ替わる
    let s = shell(&r.open(&app_exe, "apply", WAIT));
    c.check("2 開き直すと取り込んだ版になる", s_str(&s, "version") == bump(&v, 1), s_str(&s, "version"));
    let old = read_json(&root.join("update").join("old").join("app.json")).unwrap_or(Value::Null);
    c.check("2 直前の版は控えに残す", old["version"] == v.as_str(), &old);
    let target = link_target(&lnk);
    let same = std::fs::canonicalize(&target).ok() == std::fs::canonicalize(&app_exe).ok();
    c.check("2 共有を指すショートカットをこの PC の app に直す", same, &target);

    // 3. 閉じている間に +2 を置く → 1 回開くだけで入る
    place(repo, exe, &bump(&v, 2), &rel, false)?;
    let s = shell(&r.open(&app_exe, "launch", WAIT));
    c.check("3 閉じている間に置いた版に 1 回の起動で入れ替わる", s_str(&s, "version") == bump(&v, 2), s_str(&s, "version"));

    // 4. 起動できない版（+3）
    place(repo, exe, &bump(&v, 3), &rel, true)?;
    let first = r.open(&app_exe, "broken", Duration::from_secs(40));
    c.check("4 起動できない版では画面が出ない（結果を書かない）", first.is_none(), s_str(&shell(&first), "version"));
    let s = shell(&r.open(&app_exe, "revert", WAIT));
    c.check("4 次に開くと控えの版へ戻る", s_str(&s, "version") == bump(&v, 2), s_str(&s, "version"));
    let failed_marked = s["update"]["failed"].as_array().is_some_and(|f| f.iter().any(|x| x == bump(&v, 3).as_str()));
    c.check("4 起動できなかった版には印を付け、もう取り込まない", failed_marked && s["update"]["state"] != "ready", &s["update"]);

    // 5. 配る版を +1 に戻す
    let entry = distribute(repo, exe, &bump(&v, 1), &rel)?;
    let s = shell(&r.open(&app_exe, "rollback", WAIT));
    let want = read_json(&root.join("want.json")).unwrap_or(json!({}));
    c.check("5 配る版を戻すと、1 回開くだけで配る版になる", s_str(&s, "version") == bump(&v, 1), s_str(&s, "version"));
    c.check("5 配る版を作業場所に覚える", want["version"] == bump(&v, 1).as_str(), &want);

    // 6. 新しい PC: 配る入口を開くだけ
    let root2 = work.join("root-new");
    let mut r2 = Run::new(work, &root2);
    let s = shell(&r2.open(&entry, "entry", WAIT));
    c.check("6 新しい PC が配る入口から配る版を入れて開く", s["installed"] == true && s_str(&s, "version") == bump(&v, 1), &s);
    c.check(
        "6 入口の置き場を更新の置き場にする",
        s_str(&s, "source").contains(&entry.parent().unwrap().display().to_string()),
        s_str(&s, "source"),
    );

    // 7. 古い版が常駐している間に、新しい版の exe を開く
    let root3 = work.join("root-resident");
    let mut r3 = Run::new(work, &root3);
    let old_running = r3.start_resident(&share.join(&b.exe), &b.exe, Duration::from_secs(60));
    c.check("7 古い版が常駐している", !old_running.is_empty(), format!("{old_running:?}"));
    let newer = bundle::stage(repo, exe, &work.join("unzipped").join(&b.name), Some(&bump(&v, 4)), None)?;
    let s = shell(&r3.open(&newer.join(&b.exe), "supersede", WAIT));
    c.check(
        "7 新しい版の exe を開くと、新しい版で開く（古い窓が前に出るだけにならない）",
        s_str(&s, "version") == bump(&v, 4),
        s_str(&s, "version"),
    );
    let pid = |x: &String| x.split_whitespace().next().unwrap_or("").to_string();
    let old_pids: Vec<String> = old_running.iter().map(pid).collect();
    let still: Vec<String> = leftovers(work, &b.exe).into_iter().filter(|x| old_pids.contains(&pid(x))).collect();
    c.check("7 古い版の窓は終わる", still.is_empty(), format!("{still:?}"));
    kill(&still);

    c.check("共有の配る形は 1 ファイルも変わらない", tree_digest(&share) == share_digest, "");
    std::thread::sleep(Duration::from_secs(2));
    let left = leftovers(work, &b.exe);
    c.check("終わったあと窓が残らない", left.is_empty(), format!("{left:?}"));
    kill(&left);
    Ok(c.ok())
}

/// 作業フォルダの記録（app.log の最後の 40 行）を出す
pub fn print_logs(work: &Path) {
    let mut stack = vec![work.to_path_buf()];
    let mut logs = vec![];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.file_name().is_some_and(|n| n == "app.log") {
                logs.push(p);
            }
        }
    }
    logs.sort();
    for p in logs {
        let text = std::fs::read_to_string(&p).unwrap_or_default();
        let lines: Vec<&str> = text.lines().collect();
        println!("--- {}\n{}", p.display(), lines[lines.len().saturating_sub(40)..].join("\n"));
    }
}
