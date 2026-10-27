//! 通知領域（タスクバーの右下）のアイコンとメニュー。
//!
//! - 左クリック: 窓を出す（隠れていれば前へ）
//! - 右クリック: 開く / 登録した印（押すとそのままコピー。窓を開かない） / 保存フォルダを開く / Windows 起動時に常駐する /
//!   （新しい版があれば）新しい版に更新 / 終了
//! - メニューは登録した印・常駐・更新が変わるたびに作り直す（refresh）

use crate::{autostart, Ctx};
use ps_core::brand::brand;
use std::sync::Arc;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

const ID: &str = "main";
/// メニューに直に並べる登録した印の数（多いときは窓から）。
pub const PRESETS_IN_MENU: usize = 10;

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let icon = tauri::image::Image::from_bytes(include_bytes!("../../app/stamp.ico"))?;
    TrayIconBuilder::with_id(ID)
        .icon(icon)
        .tooltip(format!("{} — {}", brand().name, brand().subtitle))
        .menu(&menu(app)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| on_menu(app, e.id().as_ref()))
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                crate::show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// メニューを作り直す（登録した印・常駐・更新が変わったとき）。
pub fn refresh(app: &AppHandle) {
    if let (Some(t), Ok(m)) = (app.tray_by_id(ID), menu(app)) {
        let _ = t.set_menu(Some(m));
    }
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let ctx = app.state::<Arc<Ctx>>();
    let st = ctx.store.load();
    let mut items: Vec<Box<dyn IsMenuItem<Wry>>> = vec![
        Box::new(MenuItem::with_id(app, "open", format!("{} を開く", brand().name), true, None::<&str>)?),
        Box::new(PredefinedMenuItem::separator(app)?),
        Box::new(MenuItem::with_id(app, "hint", "押すとコピー（貼り付けは Ctrl+V）", false, None::<&str>)?),
    ];
    let presets = st["presets"].as_array().cloned().unwrap_or_default();
    if st["last"].is_object() {
        items.push(Box::new(MenuItem::with_id(app, "copy:last", "  いま作っている印", true, None::<&str>)?));
    }
    for (i, p) in presets.iter().take(PRESETS_IN_MENU).enumerate() {
        let name = p["name"].as_str().unwrap_or("");
        items.push(Box::new(MenuItem::with_id(app, format!("copy:{i}"), format!("  {name}"), true, None::<&str>)?));
    }
    if presets.len() > PRESETS_IN_MENU {
        items.push(Box::new(MenuItem::with_id(
            app,
            "open",
            format!("  ほかの印（{} 件）は窓から…", presets.len() - PRESETS_IN_MENU),
            true,
            None::<&str>,
        )?));
    }
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(app, "folder", "保存フォルダを開く", true, None::<&str>)?));
    let can = ctx.installed || ctx.dev;
    let on = ctx.autostart_status()["on"] == true;
    items.push(Box::new(CheckMenuItem::with_id(app, "autostart", "Windows 起動時に常駐する", can, on, None::<&str>)?));
    if let Some(v) = ctx.updater.ready() {
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
        items.push(Box::new(MenuItem::with_id(app, "update", format!("新しい版 {v} に更新する（開き直す）"), true, None::<&str>)?));
    }
    items.push(Box::new(PredefinedMenuItem::separator(app)?));
    items.push(Box::new(MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?));
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|b| b.as_ref()).collect();
    Menu::with_items(app, &refs)
}

fn on_menu(app: &AppHandle, id: &str) {
    let ctx = app.state::<Arc<Ctx>>().inner().clone();
    match id {
        "open" => crate::show_main(app),
        "folder" => {
            use tauri_plugin_opener::OpenerExt;
            let dir = ctx.output_dir();
            let _ = std::fs::create_dir_all(&dir);
            if let Err(e) = app.opener().open_path(dir.display().to_string(), None::<&str>) {
                crate::toast(app, &format!("保存フォルダを開けません: {e}"));
            }
        }
        "autostart" => {
            let on = ctx.autostart_status()["on"] != true;
            match autostart::set(&brand().name, on, &ctx.entry_exe()) {
                Ok(()) => crate::toast(app, if on { "Windows 起動時に常駐します" } else { "Windows 起動時の常駐をやめました" }),
                Err(e) => crate::toast(app, &e),
            }
            refresh(app);
            let _ = app.emit("ps:settings", ());
        }
        "update" => {
            if let Err(e) = crate::relaunch(app, &ctx) {
                crate::toast(app, &e);
            }
        }
        "quit" => {
            crate::locate::log("EXIT トレイの終了");
            app.exit(0);
        }
        other => {
            if let Some(which) = other.strip_prefix("copy:") {
                // 描くのは画面（隠れていても動いている）。描いて Rust の copy_png を呼び、知らせを出す
                let _ = app.emit_to("main", "ps:copy", which);
            }
        }
    }
}
