//! 画面（app/js/backend.js）から呼ぶ命令。名前と引数は backend.js と同じ。
//!
//! 置き場・保存先に触る重い物（共有・BOX は遅い）は別の糸で動かし、窓の動きを止めない（async + spawn_blocking）。
//! 失敗は利用者に見せる日本語の文で返す。

use crate::{autostart, clip, Ctx};
use ps_core::brand::brand;
use ps_core::{files, install, pngx};
use serde_json::{json, Map, Value};
use std::sync::Arc;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager, State};

type Ctxs<'a> = State<'a, Arc<Ctx>>;

/// 別の糸で動かす（共有・BOX に触る物）。
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// 生のバイト列（PNG・ZIP）と見出しの値。
fn body<'a>(req: &'a Request<'_>) -> Result<&'a [u8], String> {
    match req.body() {
        InvokeBody::Raw(b) => Ok(b),
        _ => Err("中身（バイト列）がありません".into()),
    }
}

fn header(req: &Request<'_>, name: &str) -> String {
    let v = req.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("");
    percent_decode(v)
}

/// encodeURIComponent の逆（見出しには ASCII しか入れられないので、名前は画面が符号にして渡す）。
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            if let Some(v) = s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn dpi_of(req: &Request<'_>) -> Result<u32, String> {
    header(req, "x-dpi").parse::<u32>().ok().filter(|d| (72..=4800).contains(d)).ok_or("解像度（dpi）の値が違います".into())
}

/// 起動のときに画面が読む物（設定・登録した印・アプリの様子）。
#[tauri::command]
pub fn load(ctx: Ctxs) -> Value {
    let mut st = ctx.store.load();
    let b = brand();
    st["autostart"] = ctx.autostart_status();
    st["info"] = json!({
        "shell": "tauri", "name": b.name, "version": ctx.version, "installed": ctx.installed, "exe": ctx.me, "root": ctx.paths.root,
        "commit": env!("PONSTAMP_BUILD_COMMIT"), "dev": ctx.dev,
    });
    st["shortcut"] = if ctx.installed {
        install::status(&ctx.paths, &crate::lnk::places(), &crate::lnk::OsLinks, &ctx.names(), true)["shortcut"].clone()
    } else {
        json!({"ask": false})
    };
    st["update"] = ctx.updater.status();
    st["updateSourceUsed"] = json!(ctx.update_source());
    st["notes"] = json!(ctx.notes.lock().unwrap().clone());
    st
}

#[tauri::command]
pub fn save_last(ctx: Ctxs, value: Value) -> Result<(), String> {
    ctx.store.set_last(value)
}

#[tauri::command]
pub fn save_presets(app: AppHandle, ctx: Ctxs, value: Value) -> Result<(), String> {
    ctx.store.set_presets(value)?;
    crate::tray::refresh(&app);
    Ok(())
}

#[tauri::command]
pub fn set_settings(ctx: Ctxs, patch: Map<String, Value>) -> Result<Value, String> {
    let st = ctx.store.set_settings(&patch)?;
    if patch.contains_key("updateSource") {
        ctx.updater.wake();
    }
    Ok(st)
}

/// 印を PNG で保存する（解像度を書いてから）。→ {path}
#[tauri::command]
pub async fn save_png(req: Request<'_>, ctx: Ctxs<'_>) -> Result<Value, String> {
    let png = pngx::with_dpi(body(&req)?, dpi_of(&req)?)?;
    let (folder, name) = (ctx.output_dir(), header(&req, "x-name"));
    let path = blocking(move || files::save(&folder, &name, &png)).await?;
    Ok(json!({"path": path}))
}

/// 印をクリップボードへ（Windows は Rust が解像度つきで置く）。→ {native}（false なら画面がブラウザの仕組みで置く）
#[tauri::command]
pub fn copy_png(req: Request<'_>) -> Result<Value, String> {
    let dpi = dpi_of(&req)?;
    if !cfg!(windows) {
        return Ok(json!({"native": false}));
    }
    let png = pngx::with_dpi(body(&req)?, dpi)?;
    let dib = pngx::dibv5(&pngx::decode(&png)?, dpi);
    Ok(json!({"native": clip::put(&png, &dib)?}))
}

#[tauri::command]
pub async fn open_folder(app: AppHandle, ctx: Ctxs<'_>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = ctx.output_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("保存先のフォルダを作れません（{}）: {e}", dir.display()))?;
    app.opener().open_path(dir.display().to_string(), None::<&str>).map_err(|e| e.to_string())
}

/// 保存したファイルのフォルダを開き、そのファイルを選んだ状態にする。
#[tauri::command]
pub fn reveal(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if path.is_empty() || !std::path::Path::new(&path).exists() {
        return Err("そのファイルが見つかりません（移したか消したかもしれません）".into());
    }
    app.opener().reveal_item_in_dir(&path).map_err(|e| e.to_string())
}

/// フォルダを選ぶ窓（選ばなければ null）。
#[tauri::command]
pub async fn pick_folder(app: AppHandle, start: Option<String>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut d = app.dialog().file().set_title("保存先のフォルダを選ぶ");
    if let Some(s) = start.filter(|s| std::path::Path::new(s).is_dir()) {
        d = d.set_directory(s);
    }
    let picked = blocking(move || Ok(d.blocking_pick_folder())).await?;
    Ok(picked.and_then(|p| p.into_path().ok()).map(|p| p.display().to_string()))
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, ctx: Ctxs, on: bool) -> Result<Value, String> {
    if !ctx.installed && !ctx.dev {
        return Err("この PC へ写したアプリで開いたときに設定できます（配られた exe から一度開いてください）".into());
    }
    autostart::set(&brand().name, on, &ctx.entry_exe())?;
    crate::tray::refresh(&app);
    Ok(ctx.autostart_status())
}

#[tauri::command]
pub fn update_status(ctx: Ctxs) -> Value {
    ctx.updater.status()
}

#[tauri::command]
pub fn update_check(ctx: Ctxs) -> Result<(), String> {
    if !ctx.installed {
        return Err("この PC へ写したアプリで開いたときに確かめられます".into());
    }
    ctx.updater.wake();
    Ok(())
}

/// 取り込んだ版で開き直す。
#[tauri::command]
pub fn update_apply(app: AppHandle, ctx: Ctxs) -> Result<(), String> {
    let v = ctx.updater.ready().ok_or("開き直して入れ替える版がありません")?;
    crate::locate::log(&format!("UPDATE 開き直して {v} にします"));
    crate::relaunch(&app, &ctx)
}

#[tauri::command]
pub async fn probe_source(value: String) -> Result<Value, String> {
    blocking(move || Ok(crate::updater::Updater::probe(&value))).await
}

#[tauri::command]
pub fn shortcut_make(ctx: Ctxs) -> Result<Value, String> {
    install::make(&ctx.paths, &crate::lnk::places(), &crate::lnk::OsLinks, &ctx.names())
}

#[tauri::command]
pub fn shortcut_decline(ctx: Ctxs) -> Result<Value, String> {
    install::decline(&ctx.paths)
}

#[tauri::command]
pub async fn release_view(ctx: Ctxs<'_>) -> Result<Value, String> {
    let (upd, source) = (ctx.updater.clone(), ctx.update_source());
    blocking(move || Ok(upd.release_view(&source))).await
}

#[tauri::command]
pub async fn release_place(req: Request<'_>, ctx: Ctxs<'_>) -> Result<Value, String> {
    let (upd, source, name, bytes) = (ctx.updater.clone(), ctx.update_source(), header(&req, "x-name"), body(&req)?.to_vec());
    blocking(move || upd.place(&source, &name, &bytes)).await
}

#[tauri::command]
pub async fn release_distribute(ctx: Ctxs<'_>, version: String) -> Result<Value, String> {
    let (upd, source) = (ctx.updater.clone(), ctx.update_source());
    blocking(move || upd.distribute(&source, &version)).await
}

#[tauri::command]
pub async fn release_remove(ctx: Ctxs<'_>, version: String) -> Result<Value, String> {
    let (upd, source) = (ctx.updater.clone(), ctx.update_source());
    blocking(move || upd.remove(&source, &version)).await
}

/// 画面が出た（確かめの合図）: 入れ替えた直後の版を「起動できた」とする。自己診断のときは診断を始める。
#[tauri::command]
pub fn page_ready(app: AppHandle, ctx: Ctxs) {
    if ctx.installed {
        ps_core::update::confirm(&ctx.paths);
    }
    if ctx.selftest.is_some() {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.eval(crate::SELFTEST_JS);
        }
    }
}

/// トレイからコピーした: 小さな知らせを出す（窓が隠れていても分かるように）。
#[tauri::command]
pub fn notify(app: AppHandle, text: String) {
    crate::toast(&app, &text);
}

#[tauri::command]
pub fn hide_window(app: AppHandle) {
    crate::hide_main(&app);
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    crate::locate::log("EXIT 画面の終了");
    app.exit(0);
}

/// 自己診断の結果を受け、窓の側の確かめを足して書き、終わる。
#[tauri::command]
pub async fn selftest_done(app: AppHandle, ctx: Ctxs<'_>, result: Value) -> Result<(), String> {
    let ctx = ctx.inner().clone();
    blocking(move || {
        crate::selftest_finish(&app, &ctx, result);
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn names_come_back_from_the_header() {
        assert_eq!(percent_decode("%E8%AA%8D%E5%8D%B0_%E5%B1%B1%E7%94%B0"), "認印_山田");
        assert_eq!(percent_decode("a%20b%"), "a b%", "壊れた % はそのまま");
        assert_eq!(percent_decode("plain"), "plain");
    }
}
