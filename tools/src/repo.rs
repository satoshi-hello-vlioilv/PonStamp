//! リポジトリの場所と、名前・版の定義（app/brand.json・app/version.json）を読む（道具の共通部）。
//!
//! 道具は作ったときではなく動かしたときのファイルを読む（版を上げた直後に `cargo tools release --release` が新しい版を見るため）。

use serde_json::Value;
use std::path::{Path, PathBuf};

/// リポジトリの最上位（tools/ の 1 つ上）。
pub fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().expect("tools/ の上").to_path_buf()
}

/// JSON のファイルを読む（読めなければ理由の文）。
pub fn read_json(path: &Path) -> Result<Value, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{} を読めません: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("{} が JSON として読めません: {e}", path.display()))
}

/// JSON を書く（字下げ 1・最後に改行。版の記録や名乗りを人が読める形で）。
pub fn write_json(path: &Path, v: &Value) -> Result<(), String> {
    let mut buf = Vec::new();
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, serde_json::ser::PrettyFormatter::with_indent(b" "));
    serde::Serialize::serialize(v, &mut ser).map_err(|e| e.to_string())?;
    buf.push(b'\n');
    std::fs::write(path, buf).map_err(|e| format!("{} を書けません: {e}", path.display()))
}

/// 名前の定義（app/brand.json。「_」で始まる注は除く）。
pub struct Brand {
    pub name: String,
    pub exe: String,
    pub app_id: String,
    pub raw: Value,
}

pub fn brand(repo: &Path) -> Result<Brand, String> {
    let raw = read_json(&repo.join("app").join("brand.json"))?;
    let s = |k: &str| raw[k].as_str().map(str::to_string).ok_or(format!("app/brand.json に {k} がありません"));
    Ok(Brand { name: s("name")?, exe: s("exe")?, app_id: s("app_id")?, raw: raw.clone() })
}

/// 名前の定義の 1 つの値（「_」で始まる注は出さない）。
pub fn brand_value(repo: &Path, key: &str) -> Result<String, String> {
    let b = brand(repo)?;
    match &b.raw[key] {
        _ if key.starts_with('_') => Err(format!("{key} は注です")),
        Value::String(s) => Ok(s.clone()),
        Value::Null => Err(format!("app/brand.json に {key} がありません")),
        v => Ok(v.to_string()),
    }
}

/// 版と更新履歴（app/version.json）。
pub fn version_info(repo: &Path) -> Result<Value, String> {
    read_json(&repo.join("app").join("version.json"))
}

pub fn app_version(repo: &Path) -> Result<String, String> {
    version_info(repo)?["version"].as_str().map(str::to_string).ok_or("app/version.json に version がありません".into())
}

/// 試験と通しの確かめが使う、空の作業フォルダ（前の残りは消す）。
pub fn temp_dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("ps-tools-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).expect("作業フォルダを作れません");
    d
}
