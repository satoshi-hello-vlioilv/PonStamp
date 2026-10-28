//! PonStamp（電子印メーカー）の窓。設計は docs/DESIGN.md。
//!
//! 役割の分け方:
//!   - 画面（WebView。app/ の HTML・CSS・JS を exe に埋め込む）: 印を描く・設定を選ぶ
//!   - Rust（この exe）: 窓・通知領域の常駐・1 つだけ起動・保存（解像度つき PNG）・クリップボード・Windows 起動時の常駐・
//!     ショートカット・配布と更新
//!
//! 起動の流れ（LotScope と同じ形。update.rs）:
//!   配る入口・共有の exe → この PC の app\ へ写して入口を開く → 入口は版ごとの写し desktop\<印>\ へ渡す →
//!   写しが窓として動く（起動の最初に取り込み済みの版へ入れ替え・置き場を確かめる。入れ替えたら開き直す）
//! ポートを開かないので、プロキシ・ポートの取り合い・古いサーバーの残りが無い。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod autostart;
mod clip;
mod commands;
mod lnk;
mod locate;
mod proc;
mod shellmenu;
mod tray;
mod updater;

use locate::log;
use ps_core::brand::{brand, version};
use ps_core::paths::Paths;
use ps_core::store::Store;
use ps_core::{distribute, install, update};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use updater::Updater;

/// 自己診断（PONSTAMP_SELFTEST=<結果のファイル>）で、画面が出たあとに流す確かめ。
pub const SELFTEST_JS: &str = include_str!("selftest.js");
const SELFTEST_LIMIT: Duration = Duration::from_secs(150);
/// 起動の最初に置き場を確かめるとき、届くのを待つ長さ（過ぎたら待たずに開き、裏の確かめに任せる）。
const LAUNCH_CHECK_WAIT: Duration = Duration::from_secs(5);
/// 答えを画面へ返してから閉じるまで。
const QUIT_DELAY: Duration = Duration::from_millis(150);

/// 窓の中の共有の物（命令・トレイ・更新の係が使う）。
pub struct Ctx {
    pub paths: Paths,
    pub store: Store,
    /// いま動いている exe
    pub me: PathBuf,
    /// この PC へ写したアプリから動いているか
    pub installed: bool,
    /// 開発（作業ツリー・--here・PONSTAMP_NO_HANDOFF）
    pub dev: bool,
    /// 常駐で起こされた（窓を出さない）
    pub tray_only: bool,
    pub version: String,
    pub updater: Arc<Updater>,
    /// 起動のときの知らせ（写せなかった・取り込めなかった等）。画面が出す
    pub notes: Mutex<Vec<String>>,
    pub selftest: Option<PathBuf>,
    /// 右クリックのメニューから起こされたとき、画面が出たらコピーする印（--copy <番号 | last>）
    pub pending_copy: Mutex<Option<String>>,
}

impl Ctx {
    /// 常駐とショートカットが指す exe（この PC の入口。写していなければ今の exe）。
    pub fn entry_exe(&self) -> PathBuf {
        if self.installed {
            self.paths.app().join(&brand().exe)
        } else {
            self.me.clone()
        }
    }

    pub fn output_dir(&self) -> PathBuf {
        PathBuf::from(self.store.load()["outputDir"].as_str().unwrap_or(""))
    }

    /// 置き場に作るフォルダの名前（設定の「アプリのフォルダ」「版を置くフォルダ」。空なら既定）。
    pub fn layout(&self) -> distribute::Layout {
        let st = self.store.load();
        distribute::Layout::new(st["releaseFolder"].as_str().unwrap_or(""), st["versionsFolder"].as_str().unwrap_or(""), &brand().name)
    }

    pub fn update_source(&self) -> String {
        updater::source_of(&self.paths, self.store.load()["updateSource"].as_str().unwrap_or(""))
    }

    pub fn autostart_status(&self) -> Value {
        let reg = autostart::registered(&brand().name);
        let on = reg.as_deref().is_some_and(|c| autostart::points_to(c, &self.entry_exe()));
        json!({"on": on, "can": self.installed || self.dev, "registered": reg})
    }

    /// 右クリックのメニューを今の登録した印で書き直す（この PC のアプリ・開発のときだけ。自己診断では触らない）。
    pub fn sync_shell_menu(&self) {
        if !(self.installed || self.dev) || self.selftest.is_some() {
            return;
        }
        let st = self.store.load();
        let names: Vec<String> =
            st["presets"].as_array().map(|a| a.iter().filter_map(|p| p["name"].as_str().map(str::to_string)).collect()).unwrap_or_default();
        let rows = shellmenu::entries(&self.entry_exe(), st["last"].is_object(), &names, tray::PRESETS_IN_MENU);
        if let Err(e) = shellmenu::sync(&brand().name, shortcut_icon(&self.paths), &rows) {
            log(&format!("MENU {e}"));
        }
    }

    pub fn names(&self) -> install::Names<'static> {
        let b = brand();
        install::Names { name: &b.name, exe: &b.exe, description: &b.subtitle, icon: shortcut_icon(&self.paths).clone() }
    }
}

/// ショートカットが指すアイコン: 作業場所の icon\<絵の指紋>.ico（書けなければ入口の exe の中の絵）。
fn shortcut_icon(p: &Paths) -> &'static PathBuf {
    static I: OnceLock<PathBuf> = OnceLock::new();
    I.get_or_init(|| {
        install::icon_file(p, include_bytes!("../../app/stamp.ico")).unwrap_or_else(|e| {
            log(&format!("SHORTCUT アイコンを書き出せません（exe の絵を使います）: {e}"));
            p.app().join(&brand().exe)
        })
    })
}

fn has_arg(name: &str) -> bool {
    std::env::args().any(|a| a == name)
}

fn arg_u32(name: &str) -> Option<u32> {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).and_then(|v| v.parse().ok())
}

/// 開発: 作業ツリーの target の下・--here・PONSTAMP_NO_HANDOFF。この PC へ写さず、そのまま動く。
fn dev_mode(me: &Path) -> bool {
    has_arg("--here")
        || std::env::var_os("PONSTAMP_NO_HANDOFF").is_some()
        || me
            .ancestors()
            .any(|d| d.file_name().is_some_and(|n| n == "target") && d.parent().is_some_and(|p| p.join("Cargo.toml").is_file()))
}

/// 次の窓へ渡す引数（常駐で起こされたら、次も窓を出さない。右クリックのメニューから起こされたら、何をコピーするかも渡す）。
fn pass_args() -> Vec<String> {
    let mut out = vec![];
    if has_arg(autostart::TRAY_ARG) {
        out.push(autostart::TRAY_ARG.to_string());
    }
    if let Some(which) = copy_arg() {
        out.extend([shellmenu::COPY_ARG.to_string(), which]);
    }
    out
}

fn copy_arg() -> Option<String> {
    shellmenu::copy_target(&std::env::args().collect::<Vec<_>>())
}

/// exe を、この exe が終わるのを待つ印つきで起こす。
fn spawn_waiting(exe: &Path) -> Result<(), String> {
    let mut args = vec!["--wait-pid".to_string(), std::process::id().to_string()];
    args.extend(pass_args());
    std::process::Command::new(exe)
        .args(&args)
        .current_dir(exe.parent().unwrap_or(Path::new(".")))
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("{} を開けません: {e}", exe.display()))
}

/// 写す仕事を 1 台で同時に 1 つだけにする（初めての PC でダブルクリックを 2 回しても、写しがぶつからない）。
struct InstallLock(PathBuf);

impl InstallLock {
    fn take(p: &Paths) -> Option<InstallLock> {
        let file = p.work().join("install.lock");
        let _ = std::fs::create_dir_all(p.work());
        for _ in 0..600 {
            if std::fs::OpenOptions::new().write(true).create_new(true).open(&file).is_ok() {
                return Some(InstallLock(file));
            }
            // 2 分より古い錠は、止まった前の物
            let stale = std::fs::metadata(&file)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|e| e > Duration::from_secs(120));
            if stale {
                let _ = std::fs::remove_file(&file);
                continue;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        None
    }
}

impl Drop for InstallLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// 起動のはじめ（窓を作る前）。配る入口・共有の exe ならこの PC へ写して入口を開き、入口なら版ごとの写しへ渡す。
/// 渡したら true（この exe は終わる）。写せなければ理由を notes に足して、このまま動く。
fn hand_off(p: &Paths, me: &Path, notes: &mut Vec<String>) -> bool {
    let b = brand();
    // 配る入口（置き場のアプリのフォルダの exe）: 配る版を取り込んでこの PC に据える
    if let Some(folder) = distribute::entry_folder(me, &b.app_id) {
        let _lock = InstallLock::take(p);
        return match distribute::install_from_entry(p, &folder, &b.app_id, &|t| log(&format!("INSTALL {t}"))) {
            Ok(v) => {
                log(&format!("INSTALL 配る入口（{}）から版 {v} をこの PC へ据えました", folder.display()));
                spawn_waiting(&p.app().join(&b.exe)).map_err(|e| notes.push(e)).is_ok()
            }
            Err(e) => {
                log(&format!("INSTALL 配る入口から取り込めないので、入口のまま開きます: {e}"));
                notes.push(format!("この PC へ写せませんでした（入口のまま開いています）: {e}"));
                false
            }
        };
    }
    match update::plan(p, me, &b.exe, &b.app_id, false) {
        update::Step::Stay => false,
        update::Step::Handoff => match update::copy_for_run(p, me) {
            Ok(copy) => spawn_waiting(&copy).map_err(|e| log(&format!("START 写しを開けないので、入口のまま開きます: {e}"))).is_ok(),
            Err(e) => {
                log(&format!("START 版ごとの写しを作れないので、入口のまま開きます: {e}"));
                false
            }
        },
        update::Step::Localize(dist) => {
            let _lock = InstallLock::take(p);
            let version = update::validate_dist(&dist, &b.exe, &b.app_id, None).unwrap_or_default();
            if update::should_localize(p, &version) {
                if let Err(e) = update::localize(p, &dist, &b.exe, &b.app_id) {
                    log(&format!("INSTALL この PC へ写せないので、共有のまま開きます: {e}"));
                    notes.push(format!("この PC へ写せませんでした（共有のまま開いています）: {e}"));
                    return false;
                }
                log(&format!("INSTALL {} からこの PC へ写しました（版 {version}）", dist.display()));
            }
            spawn_waiting(&p.app().join(&b.exe)).map_err(|e| notes.push(e)).is_ok()
        }
    }
}

/// 入口（この PC の app の exe）で開き直して、この窓を閉じる。入口はこの窓が終わるのを待ってから、版ごとの写しへ渡す。
pub fn relaunch(app: &AppHandle, ctx: &Ctx) -> Result<(), String> {
    if !ctx.installed {
        return Err("この PC へ写したアプリで開いていないので、開き直せません".into());
    }
    spawn_waiting(&ctx.paths.app().join(&brand().exe))?;
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(QUIT_DELAY);
        log("EXIT 開き直す（入口へ渡した）");
        app.exit(0);
    });
    Ok(())
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit_to("main", "ps:shown", ());
    }
}

pub fn hide_main(app: &AppHandle) {
    static TOLD: OnceLock<()> = OnceLock::new();
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
        // 初めて隠したときだけ、どこへ行ったかを言う（閉じても常駐が続くことを知らせる）
        if TOLD.set(()).is_ok() {
            toast(app, "通知領域（右下の ^ の中）で動いています。終了は右クリックから");
        }
    }
}

/// 画面の右下に小さな知らせを出す（窓が隠れていても見える。1.8 秒で消える。押しても消える）。
pub fn toast(app: &AppHandle, text: &str) {
    let app = app.clone();
    let text = text.to_string();
    std::thread::spawn(move || {
        if let Some(old) = app.get_webview_window("toast") {
            let _ = old.destroy();
        }
        let (w, h) = (360.0, 64.0);
        let mut b = WebviewWindowBuilder::new(&app, "toast", WebviewUrl::App(format!("toast.html#{}", encode(&text)).into()))
            .title(brand().name.as_str())
            .inner_size(w, h)
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .shadow(true);
        if let Ok(Some(m)) = app.primary_monitor() {
            let s = m.scale_factor();
            let area = m.work_area();
            let x = (area.position.x as f64 + area.size.width as f64) / s - w - 16.0;
            let y = (area.position.y as f64 + area.size.height as f64) / s - h - 16.0;
            b = b.position(x, y);
        }
        if let Ok(win) = b.build() {
            std::thread::sleep(Duration::from_millis(2200));
            let _ = win.destroy();
        }
    });
}

/// 知らせの字を URL の # の後ろに入れる形に（encodeURIComponent と同じ）。
fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

/// 主の窓（隠して作り、常駐で起こされていなければ出す。閉じても隠すだけ）。
fn main_window(app: &AppHandle, visible: bool) -> tauri::Result<()> {
    let b = brand();
    let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title(format!("{} — {}", b.name, b.subtitle))
        .inner_size(1180.0, 800.0)
        .min_inner_size(900.0, 620.0)
        .center()
        .visible(visible)
        // 画面の背景と同じ色（開いた瞬間の白い光りを出さない）
        .background_color(tauri::window::Color(0xf5, 0xf6, 0xf8, 0xff))
        .disable_drag_drop_handler();
    let builder = if std::env::var_os("PONSTAMP_SELFTEST").is_some() {
        builder.initialization_script(
            "window.__psErrors=[];addEventListener('error',e=>__psErrors.push(String(e.message||e.type)));\
             addEventListener('unhandledrejection',e=>__psErrors.push('promise: '+String(e.reason&&(e.reason.message||e.reason))));",
        )
    } else {
        builder
    };
    builder.build()?;
    Ok(())
}

/// 起動の最初（窓を出す前・裏の糸）: 入れ替えた版の見張り・取り込み済みの版へ入れ替え・置き場を確かめる → 窓を出す。
fn start(app: AppHandle) {
    let ctx = app.state::<Arc<Ctx>>().inner().clone();
    let p = &ctx.paths;
    if ctx.installed {
        if let update::Guard::Reverted(a) = update::guard_applied(p) {
            log(&format!("UPDATE 版 {} の画面が出ないので、前の版 {} に戻して開き直します", a.from, a.to));
            if relaunch(&app, &ctx).is_ok() {
                return;
            }
        }
        // 通しの確かめ（tools/verify.py）だけ: 名乗りに selftest_broken がある版は、画面を出す前に終わる（起動できない版の真似）
        if ctx.selftest.is_some() && update::manifest(&p.app()).is_some_and(|m| m["selftest_broken"] == true) {
            log("SELFTEST 起動できない版の真似として終わります");
            std::process::exit(3);
        }
        let source = update::remembered_source(p).unwrap_or_default();
        match update::launch_check(p, &source, &brand().app_id, &ctx.version, LAUNCH_CHECK_WAIT, &|t| log(&format!("UPDATE {t}"))) {
            update::Launch::Staged(v) => log(&format!("UPDATE 起動の最初に版 {v} を取り込みました")),
            update::Launch::Nothing(why) => log(&format!("UPDATE 起動の最初の確かめ: {why}")),
            update::Launch::Slow => log("UPDATE 起動の最初の確かめ: 置き場に届かないので、裏で確かめます"),
            update::Launch::Failed(e) => {
                log(&format!("UPDATE {e}"));
                ctx.notes.lock().unwrap().push(format!("{e}（使っている間に、もう一度試します）"));
            }
        }
        match update::apply_staged(p) {
            Ok(Some(a)) => {
                log(&format!("UPDATE {} → {} に入れ替えました。開き直します", a.from, a.to));
                if relaunch(&app, &ctx).is_ok() {
                    return;
                }
            }
            Ok(None) => {}
            Err(e) => {
                log(&format!("UPDATE 入れ替えられません: {e}"));
                ctx.notes.lock().unwrap().push(format!("新しい版に入れ替えられませんでした（次に開いたときにもう一度試します）: {e}"));
            }
        }
        settle(&ctx);
    }
    if let Err(e) = main_window(&app, !ctx.tray_only) {
        log(&format!("FAIL 窓を作れません: {e}"));
    }
    let src = ctx.clone();
    ctx.updater.run(move || src.update_source(), log);
}

/// この PC のアプリで動いているときの片付け: ショートカットを直す・古い写しを消す・前の形の常駐を移す・常駐の指す先を直す。
fn settle(ctx: &Arc<Ctx>) {
    let ctx = ctx.clone();
    std::thread::spawn(move || {
        let p = &ctx.paths;
        for f in install::maintain(p, &lnk::places(), &lnk::pinned(), &lnk::OsLinks, &ctx.names()) {
            log(&format!("SHORTCUT {f}"));
        }
        update::cleanup_copies(p, &ctx.me);
        let name = &brand().name;
        // 前の形（Flask 版）がスタートアップに置いた .vbs を外し、exe の常駐に置き換える
        for vbs in locate::legacy_startups().into_iter().filter(|f| f.is_file()) {
            match std::fs::remove_file(&vbs).map_err(|e| e.to_string()).and_then(|_| autostart::set(name, true, &ctx.entry_exe())) {
                Ok(()) => log(&format!("AUTOSTART 前の形の {} を外し、exe の常駐に置き換えました", vbs.display())),
                Err(e) => log(&format!("AUTOSTART 前の形の常駐を移せません: {e}")),
            }
        }
        // 常駐が前の場所（共有の exe など）を指していれば、この PC の入口に直す
        if autostart::registered(name).is_some_and(|c| !autostart::points_to(&c, &ctx.entry_exe())) {
            let _ = autostart::set(name, true, &ctx.entry_exe());
            log("AUTOSTART 常駐の指す先をこの PC の入口に直しました");
        }
    });
}

/// 自己診断の結果に窓の側の確かめを足して書き、終わる（PONSTAMP_SELFTEST が無ければ何もしない）。
pub fn selftest_finish(app: &AppHandle, ctx: &Ctx, mut result: Value) {
    let Some(path) = &ctx.selftest else { return };
    // 保存した PNG に解像度が入っているか（画面からは読めないので、ここで読む）
    let mut ok = result["ok"] == true;
    if let Some(saved) = result["saved"].as_array_mut() {
        for s in saved {
            let file = s["path"].as_str().unwrap_or("");
            let dpi = std::fs::read(file).ok().and_then(|b| ps_core::pngx::dpi_of(&b));
            let want = s["dpi"].as_f64().unwrap_or(0.0);
            let good = dpi.is_some_and(|d| (d - want).abs() < 0.5);
            s["fileDpi"] = json!(dpi);
            s["ok"] = json!(good);
            ok &= good;
        }
    }
    // 更新の係が確かめ終わるのを待つ（この PC のアプリのとき。通しの確かめ verify.py が状態を読む）
    if ctx.installed {
        for _ in 0..240 {
            let st = ctx.updater.status()["state"].clone();
            if !matches!(st.as_str(), Some("idle" | "checking" | "staging")) {
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    }
    result["ok"] = json!(ok);
    result["shell"] = json!({
        "version": ctx.version, "installed": ctx.installed, "exe": ctx.me, "root": ctx.paths.root, "update": ctx.updater.status(),
        "notes": ctx.notes.lock().unwrap().clone(), "autostart": ctx.autostart_status(), "source": ctx.update_source(),
        "install": install::status(&ctx.paths, &lnk::places(), &lnk::OsLinks, &ctx.names(), ctx.installed),
    });
    let _ = std::fs::write(path, serde_json::to_vec_pretty(&result).unwrap_or_default());
    log(&format!("SELFTEST ok={ok}"));
    app.exit(if ok { 0 } else { 1 });
}

fn main() {
    let me = std::env::current_exe().unwrap_or_default();
    let paths = Paths::new(&locate::local_root());
    if let Some(pid) = arg_u32("--wait-pid") {
        proc::wait_gone(pid, Duration::from_secs(30));
    }
    let dev = dev_mode(&me);
    let mut notes = vec![];
    if !dev && hand_off(&paths, &me, &mut notes) {
        return;
    }
    let b = brand();
    let installed = update::running_installed(&paths, &me, &b.exe);
    // 動いている版: この PC のアプリなら名乗り（app\app.json）、ほかはこの exe の版
    let current =
        if installed { update::dist_version(&paths.app()).unwrap_or_else(|| version().to_string()) } else { version().to_string() };
    let store = Store::new(&paths.state(), &locate::default_output());
    if let Some(from) = store.import_legacy(&locate::legacy_states()) {
        log(&format!("START 前の形の設定と登録した印を引き継ぎました（{}）", from.display()));
    }
    log(&format!(
        "START 版 {current}・{}・exe {}",
        if installed {
            "この PC のアプリ"
        } else if dev {
            "開発"
        } else {
            "写していない形"
        },
        me.display()
    ));
    let selftest = std::env::var_os("PONSTAMP_SELFTEST").map(PathBuf::from);
    let ctx = Arc::new(Ctx {
        updater: Updater::new(paths.clone(), installed, current.clone()),
        paths,
        store,
        me,
        installed,
        dev,
        tray_only: (has_arg(autostart::TRAY_ARG) || copy_arg().is_some()) && selftest.is_none(),
        version: current,
        notes: Mutex::new(notes),
        selftest,
        pending_copy: Mutex::new(copy_arg()),
    });

    let app = tauri::Builder::default()
        // 2 つめを起こしたら、前の窓を前に出すだけ（常駐で起こされた 2 つめは何もしない。
        // 右クリックのメニューから起こされた 2 つめは、前の窓にコピーを頼む。窓は出さない）
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(which) = shellmenu::copy_target(&args) {
                let _ = app.emit_to("main", "ps:copy", which);
            } else if !args.iter().any(|a| a == autostart::TRAY_ARG) {
                show_main(app);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ctx.clone())
        .invoke_handler(tauri::generate_handler![
            commands::load,
            commands::save_last,
            commands::save_presets,
            commands::set_settings,
            commands::save_png,
            commands::copy_png,
            commands::open_folder,
            commands::reveal,
            commands::pick_folder,
            commands::set_autostart,
            commands::update_status,
            commands::update_check,
            commands::update_apply,
            commands::probe_source,
            commands::shortcut_make,
            commands::shortcut_decline,
            commands::release_view,
            commands::release_place,
            commands::release_distribute,
            commands::release_remove,
            commands::page_ready,
            commands::notify,
            commands::hide_window,
            commands::quit,
            commands::selftest_done,
        ])
        .on_window_event(|w, e| {
            // 窓の ×: 閉じずに隠す（通知領域に常駐を続ける）
            if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                if w.label() == "main" {
                    api.prevent_close();
                    hide_main(w.app_handle());
                }
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            tray::create(&handle)?;
            let ctx = handle.state::<Arc<Ctx>>().inner().clone();
            ctx.sync_shell_menu();
            // 更新の状態が変わったら、画面へ知らせ、トレイのメニューを作り直す
            let h = handle.clone();
            ctx.updater.listen(move |st| {
                let _ = h.emit("ps:update", st);
                tray::refresh(&h);
            });
            if ctx.selftest.is_some() {
                let h = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(SELFTEST_LIMIT);
                    let ctx = h.state::<Arc<Ctx>>().inner().clone();
                    selftest_finish(
                        &h,
                        &ctx,
                        json!({"ok": false, "error": format!("{} 秒で終わりませんでした", SELFTEST_LIMIT.as_secs())}),
                    );
                });
            }
            std::thread::spawn(move || start(handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("起動できません");
    app.run(|app, e| match e {
        // 窓をすべて閉じても終わらない（常駐）。終わるのはトレイ・画面の「終了」（app.exit）だけ
        tauri::RunEvent::ExitRequested { api, code: None, .. } => api.prevent_exit(),
        // 終わるとき: 右クリックのメニューを外す（常駐している間だけ出す）
        tauri::RunEvent::Exit => {
            let ctx = app.state::<Arc<Ctx>>();
            if (ctx.installed || ctx.dev) && ctx.selftest.is_none() {
                if let Err(e) = shellmenu::remove(&brand().name) {
                    log(&format!("MENU {e}"));
                }
            }
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toast_text_is_url_safe() {
        assert_eq!(encode("コピー済み a/b"), "%E3%82%B3%E3%83%94%E3%83%BC%E6%B8%88%E3%81%BF%20a%2Fb");
    }

    #[test]
    fn the_work_tree_is_dev() {
        assert!(dev_mode(Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join("debug").join("PonStamp").as_path()));
        assert!(!dev_mode(Path::new("/home/u/.local/share/PonStamp/app/PonStamp")));
    }
}
