//! アプリの名前と版（`app/brand.json`・`app/version.json` の 1 か所の定義を、作るときに取り込む）。
//!
//! 名前（`name`・`subtitle`・`exe`）は窓の題名・トレイ・ショートカット・記録に使う。`app_id` は変えない目印
//! （更新の置き場で「このアプリの版」を見分ける・Tauri の identifier）。画面と Python の道具も同じファイルを読む。

use serde::Deserialize;
use std::sync::OnceLock;

const BRAND: &str = include_str!("../../app/brand.json");
const VERSION: &str = include_str!("../../app/version.json");

#[derive(Debug, Deserialize)]
pub struct Brand {
    pub name: String,
    pub subtitle: String,
    pub exe: String,
    pub app_id: String,
    pub data_dir: String,
    /// 前の形（Flask 版）の設定の置き場（%APPDATA%\<名前>）。初めての起動で引き継ぐ
    #[serde(default)]
    pub legacy_state: Vec<String>,
    /// 前の形が Windows 起動時の常駐に使っていたスタートアップの .vbs
    #[serde(default)]
    pub legacy_startup: Vec<String>,
    /// 更新の置き場の既定（配る人が決める。空なら設定で書いた場所・配る入口の場所）
    #[serde(default)]
    pub update_source: String,
}

pub fn brand() -> &'static Brand {
    static B: OnceLock<Brand> = OnceLock::new();
    B.get_or_init(|| serde_json::from_str(BRAND).expect("app/brand.json が読めません"))
}

/// この exe の版（`app/version.json` の version）。配る形の名乗り（app.json）も同じ版を書く（tools/bundle.py）
pub fn version() -> &'static str {
    static V: OnceLock<String> = OnceLock::new();
    V.get_or_init(|| {
        let v: serde_json::Value = serde_json::from_str(VERSION).expect("app/version.json が読めません");
        v["version"].as_str().unwrap_or("0.0.0").to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agrees_with_the_build_tools() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let b = brand();
        assert_eq!(conf["identifier"], b.app_id.as_str(), "Tauri の identifier は変えない目印（WebView の保存先が変わらない）");
        assert_eq!(conf["productName"], b.name.as_str());
        assert_eq!(format!("{}.exe", conf["mainBinaryName"].as_str().unwrap()), b.exe, "exe の名前");
        let cargo = include_str!("../Cargo.toml");
        assert!(cargo.contains(&format!("name = \"{}\"", b.exe.trim_end_matches(".exe"))), "Cargo.toml の [[bin]] name も exe と同じ");
        assert!(!b.data_dir.is_empty() && !b.subtitle.is_empty());
    }

    #[test]
    fn one_version_everywhere() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["version"], version(), "tauri.conf.json の version を app/version.json にそろえる");
        assert_eq!(env!("CARGO_PKG_VERSION"), version(), "Cargo.toml の version を app/version.json にそろえる");
        assert!(crate::release::parse_version(version()).is_some(), "版は X.Y.Z");
    }
}
