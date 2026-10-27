//! 置き場所を探す: この PC の作業場所・保存先の既定・前の形（Flask 版）の置き場。と、記録。

use ps_core::brand::brand;
use std::io::Write;
use std::path::PathBuf;

fn var(k: &str) -> Option<PathBuf> {
    std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from)
}

fn home() -> PathBuf {
    var("USERPROFILE").or_else(|| var("HOME")).unwrap_or_else(|| PathBuf::from("."))
}

/// この PC の作業場所: PONSTAMP_LOCAL_ROOT（試験・開発）→ %LOCALAPPDATA%\<data_dir> → ~/.local/share/<data_dir>。
pub fn local_root() -> PathBuf {
    if let Some(p) = var("PONSTAMP_LOCAL_ROOT") {
        return p;
    }
    let base = var("LOCALAPPDATA").or_else(|| var("XDG_DATA_HOME")).unwrap_or_else(|| home().join(".local").join("share"));
    base.join(&brand().data_dir)
}

/// PNG の保存先の既定（ピクチャ\電子印。前の形と同じ）。
pub fn default_output() -> PathBuf {
    home().join("Pictures").join("電子印")
}

/// 前の形（Flask 版）の state.json（%APPDATA%\<名前>\state.json）。
pub fn legacy_states() -> Vec<PathBuf> {
    let Some(appdata) = var("APPDATA") else { return vec![] };
    brand().legacy_state.iter().map(|n| appdata.join(n).join("state.json")).collect()
}

/// 前の形が Windows 起動時の常駐に使っていたスタートアップの .vbs。
pub fn legacy_startups() -> Vec<PathBuf> {
    let Some(appdata) = var("APPDATA") else { return vec![] };
    let dir = appdata.join("Microsoft").join("Windows").join("Start Menu").join("Programs").join("Startup");
    brand().legacy_startup.iter().map(|n| dir.join(n)).collect()
}

/// 記録（作業場所の logs\app.log）。1 MB を超えたら app.old.log へ回す。
pub fn log(line: &str) {
    let dir = local_root().join("logs");
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join("app.log");
    if std::fs::metadata(&file).is_ok_and(|m| m.len() > 1 << 20) {
        let _ = std::fs::rename(&file, dir.join("app.old.log"));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(file) {
        let _ = writeln!(f, "{} [{}] {line}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), std::process::id());
    }
}
