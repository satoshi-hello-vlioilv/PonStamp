//! 窓の更新の係（裏の糸と画面への答え）。取り込み・入れ替えの中身は ps_core::update、置き場の探し方は ps_core::release。
//!
//! - 確かめる: 起動の直後・30 分ごと・画面の「今すぐ確かめる」・更新の置き場を変えたとき
//! - 置き場 = 設定の「更新の置き場」（無ければ app/brand.json の既定）＋ 配る入口から入れた PC が控えた入口の置き場
//! - 配る版が決まっていればその版（前の版へ戻すときも）、決まっていなければいちばん新しい版を、使っている間に取り込む
//! - 置き場を控える（次の起動の最初、窓を出す前にも確かめる: 閉じている間に配った版も 1 回の起動で入る）
//! - 状態が変わるたびに知らせる（画面の札とトレイのメニューが変わる）

use ps_core::brand::brand;
use ps_core::distribute::{self, Who};
use ps_core::paths::Paths;
use ps_core::release;
use ps_core::update;
use serde_json::{json, Map, Value};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

/// 確かめる間隔。
const EVERY: Duration = Duration::from_secs(30 * 60);

type Listener = Box<dyn Fn(&Value) + Send + Sync>;

pub struct Updater {
    pub paths: Paths,
    /// この PC のアプリ（app）から動いているか。開発・共有から動くときは取り込まない
    pub installed: bool,
    /// いま動いている版
    pub current: String,
    state: Mutex<Map<String, Value>>,
    wake: (Mutex<bool>, Condvar),
    listener: Mutex<Option<Listener>>,
}

/// 更新の置き場: 設定の値（空なら app/brand.json の既定）に、配る入口から入れた PC が控えた入口の置き場を後ろの候補として足す。
pub fn source_of(paths: &Paths, setting: &str) -> String {
    let base = if setting.trim().is_empty() { brand().update_source.clone() } else { setting.to_string() };
    match distribute::remembered_entry(paths) {
        Some(dir) if !base.contains(&*dir.to_string_lossy()) => {
            if base.trim().is_empty() {
                dir.display().to_string()
            } else {
                format!("{base};{}", dir.display())
            }
        }
        _ => base,
    }
}

impl Updater {
    pub fn new(paths: Paths, installed: bool, current: String) -> Arc<Updater> {
        let mut st = Map::new();
        st.insert("state".into(), json!(if installed { "idle" } else { "off" }));
        st.insert("current".into(), json!(current));
        if !installed {
            st.insert(
                "detail".into(),
                json!("この PC へ写したアプリで動いていないので、更新は取り込みません（開発・共有から直に開いた形）"),
            );
        }
        Arc::new(Updater {
            paths,
            installed,
            current,
            state: Mutex::new(st),
            wake: (Mutex::new(false), Condvar::new()),
            listener: Mutex::new(None),
        })
    }

    /// 状態が変わったら呼ぶ物（画面への知らせ・トレイのメニュー）。
    pub fn listen(&self, f: impl Fn(&Value) + Send + Sync + 'static) {
        *self.listener.lock().unwrap() = Some(Box::new(f));
    }

    /// 画面へ。
    pub fn status(&self) -> Value {
        let mut s = self.state.lock().unwrap().clone();
        s.insert("failed".into(), json!(update::failed_versions(&self.paths)));
        Value::Object(s)
    }

    /// 開き直せば入れ替わる版（無ければ None）。
    pub fn ready(&self) -> Option<String> {
        let s = self.state.lock().unwrap();
        (s.get("state") == Some(&json!("ready"))).then(|| s.get("ready").and_then(Value::as_str).unwrap_or("").to_string())
    }

    fn set(&self, pairs: Value) {
        {
            let mut s = self.state.lock().unwrap();
            for k in ["ready", "direction", "detail", "problem"] {
                s.remove(k);
            }
            if let Value::Object(m) = pairs {
                s.extend(m);
            }
        }
        let st = self.status();
        if let Some(f) = self.listener.lock().unwrap().as_ref() {
            f(&st);
        }
    }

    /// すぐ確かめる。
    pub fn wake(&self) {
        *self.wake.0.lock().unwrap() = true;
        self.wake.1.notify_all();
    }

    /// 裏の糸: 確かめて、間隔を空けて繰り返す。source は置き場の今の値を返す。
    pub fn run(self: &Arc<Self>, source: impl Fn() -> String + Send + 'static, log: fn(&str)) {
        if !self.installed {
            return;
        }
        let me = self.clone();
        std::thread::spawn(move || loop {
            me.check(&source(), log);
            let (m, cv) = (&me.wake.0, &me.wake.1);
            let g = m.lock().unwrap();
            let (mut g, _) = cv.wait_timeout_while(g, EVERY, |w| !*w).unwrap();
            *g = false;
        });
    }

    /// 1 回確かめる（取り込みまで）。
    pub fn check(&self, source: &str, log: fn(&str)) {
        let b = brand();
        self.set(json!({"state": "checking"}));
        {
            let mut s = self.state.lock().unwrap();
            s.insert("source".into(), json!(source));
            s.insert("checkedAt".into(), json!(chrono::Local::now().format("%Y-%m-%d %H:%M").to_string()));
        }
        update::remember_source(&self.paths, source);
        if source.trim().is_empty() {
            let _ = std::fs::remove_file(self.paths.want());
            return self.set(json!({"state": "off", "detail": "更新の置き場が決まっていません（設定の「更新」で決められます）"}));
        }
        let (found, adjusted) = match release::locate_source(source) {
            Ok(f) => f,
            Err(e) => return self.set(json!({"state": "error", "problem": e})),
        };
        let scan = release::scan(&found, &b.app_id);
        {
            let mut s = self.state.lock().unwrap();
            s.insert("found".into(), json!(found.display().to_string()));
            s.insert("adjusted".into(), json!(adjusted));
            s.insert("distributed".into(), scan.distribute.as_ref().map(|d| d.raw.clone()).unwrap_or(Value::Null));
        }
        update::remember_want(&self.paths, &scan);
        let (target, direction) = match update::pick(&scan, &update::failed_versions(&self.paths), &self.current) {
            update::Pick::Take(t, d) => (t, d),
            update::Pick::Stay(why) => {
                // いまの版が最新なら、取り込みかけの別の版は捨てる（配る版が戻された等）
                if why.is_none() && update::staged(&self.paths).is_some() {
                    let _ = std::fs::remove_dir_all(self.paths.stage());
                    let _ = std::fs::remove_file(self.paths.stage_record());
                }
                return self.set(match why {
                    Some(w) => json!({"state": "latest", "detail": w}),
                    None => json!({"state": "latest"}),
                });
            }
        };
        if update::staged(&self.paths).is_some_and(|s| s["version"] == json!(target.version)) {
            return self.set(json!({"state": "ready", "ready": target.version, "direction": direction}));
        }
        self.set(json!({"state": "staging", "detail": target.version}));
        match update::stage_release(&self.paths, target, &b.app_id, &|_| {}) {
            Ok(_) => {
                log(&format!("UPDATE 版 {} を取り込みました（{}）", target.version, target.zip_path().display()));
                self.set(json!({"state": "ready", "ready": target.version, "direction": direction}));
            }
            Err(e) => {
                log(&format!("UPDATE 版 {} を取り込めません: {e}", target.version));
                self.set(json!({"state": "error", "problem": format!("版 {} を取り込めません: {e}", target.version)}));
            }
        }
    }

    /// 配布の画面（置き場をたどる）。
    pub fn release_view(&self, source: &str) -> Value {
        let b = brand();
        let who = Who::here();
        let me = json!({"login": who.login, "pc": who.pc, "current": self.current});
        let mut v = match release::locate_source(source) {
            Ok((found, adjusted)) => distribute::view_of(&release::scan(&found, &b.app_id), &found, adjusted, source, &b.name),
            Err(e) => json!({"reachable": false, "why": e, "folder": source, "found": null, "versions": []}),
        };
        v["me"] = me;
        v
    }

    /// 画面から選んだ ZIP（読み終えたバイト列）を置き場に置く。
    pub fn place(&self, source: &str, file_name: &str, body: &[u8]) -> Result<Value, String> {
        let b = brand();
        let (found, _) = release::locate_source(source)?;
        std::fs::create_dir_all(self.paths.work()).map_err(|e| e.to_string())?;
        let dl = self.paths.work().join(format!("place-{}.zip", std::process::id()));
        std::fs::write(&dl, body).map_err(|e| format!("受け取った ZIP を書けません: {e}"))?;
        let r = distribute::place(&self.paths, &found, &dl, file_name, &b.app_id, &Who::here(), &|_, _, _| {});
        let _ = std::fs::remove_file(&dl);
        self.wake();
        r
    }

    /// 配る版を決める（前の版へ戻すのも同じ）。
    pub fn distribute(&self, source: &str, version: &str) -> Result<Value, String> {
        let (found, _) = release::locate_source(source)?;
        let r = distribute::set_distributed(&found, version, &brand().app_id, &Who::here())?;
        self.wake();
        Ok(r)
    }

    /// 置いた版を消す（配っている版は消さない）。
    pub fn remove(&self, source: &str, version: &str) -> Result<Value, String> {
        let (found, _) = release::locate_source(source)?;
        let r = distribute::remove_version(&found, version, &brand().app_id)?;
        self.wake();
        Ok(r)
    }

    /// 設定の「確かめる」（この PC での見え方で探し、見つけた版を言う）。
    pub fn probe(value: &str) -> Value {
        let b = brand();
        let (found, adjusted) = match release::locate_source(value) {
            Ok(f) => f,
            Err(e) => return json!({"ok": false, "message": e}),
        };
        let scan = release::scan(&found, &b.app_id);
        let vers: Vec<String> = scan.by_version().iter().map(|r| r.version.clone()).collect();
        let adj = if adjusted { "（この PC での見え方に合わせて探しました）" } else { "" };
        let dist = scan.distribute.as_ref().map(|d| format!("・配る版 {}", d.version)).unwrap_or_default();
        let problems = if scan.problems.is_empty() { String::new() } else { format!("。読めない物: {}", scan.problems.join("・")) };
        if vers.is_empty() {
            return json!({"ok": true, "message": format!("{}{adj} に届きました。このアプリの版はまだ置いてありません{problems}", found.display())});
        }
        json!({"ok": true, "message": format!("{}{adj} に届きました。版 {} 個（いちばん新しい版 {}）{dist}{problems}",
            found.display(), vers.len(), vers[0])})
    }
}
