//! 設定と登録した印（作業場所の state.json）。画面が読む形（キーの名前）は旧 Flask 版と同じ。
//!
//! ```text
//! { presets: [{name, s}], last: {…最後の印…}, outputDir: "保存先", updateSource: "更新の置き場", … }
//! ```
//! - 1 つの錠の下で「読む → 当てる → 一時ファイル → 名前の付け替え」（途中で止まっても前か後のどちらか）
//! - 初めての起動で、前の形（Flask 版）の state.json を引き継ぐ（import_legacy）

use crate::paths::{read_json, write_json};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 登録できる印の数の上限（トレイのメニューに並ぶので、多すぎないように）。
pub const MAX_PRESETS: usize = 50;
/// 画面が書いてよい設定のキー（ほかは断る。画面の不具合で state.json を壊さない）。
pub const SETTINGS: &[&str] = &["outputDir", "updateSource"];

pub struct Store {
    path: PathBuf,
    default_out: PathBuf,
    lock: Mutex<()>,
}

impl Store {
    pub fn new(path: &Path, default_out: &Path) -> Store {
        Store { path: path.to_path_buf(), default_out: default_out.to_path_buf(), lock: Mutex::new(()) }
    }

    /// 既定を入れた中身。
    pub fn load(&self) -> Value {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        self.read()
    }

    fn read(&self) -> Value {
        let mut st = read_json(&self.path).filter(Value::is_object).unwrap_or_else(|| json!({}));
        let o = st.as_object_mut().expect("object");
        if !o.get("presets").is_some_and(Value::is_array) {
            o.insert("presets".into(), json!([]));
        }
        o.entry("last").or_insert(Value::Null);
        if !o.get("outputDir").and_then(Value::as_str).is_some_and(|s| !s.trim().is_empty()) {
            o.insert("outputDir".into(), json!(self.default_out));
        }
        if !o.get("updateSource").is_some_and(Value::is_string) {
            o.insert("updateSource".into(), json!(""));
        }
        st
    }

    /// 当てて書く → 新しい中身。
    pub fn update(&self, f: impl FnOnce(&mut Map<String, Value>) -> Result<(), String>) -> Result<Value, String> {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut st = self.read();
        f(st.as_object_mut().expect("object"))?;
        write_json(&self.path, &st)?;
        Ok(st)
    }

    pub fn set_last(&self, v: Value) -> Result<(), String> {
        if !(v.is_object() || v.is_null()) {
            return Err("最後の印の形が違います".into());
        }
        self.update(|o| {
            o.insert("last".into(), v);
            Ok(())
        })
        .map(|_| ())
    }

    /// 登録した印を置き換える（{name, s} の並び。名前の無い物は落とす・上限まで）。
    pub fn set_presets(&self, v: Value) -> Result<Value, String> {
        let list = v.as_array().ok_or("登録した印の形が違います")?;
        let clean: Vec<Value> = list
            .iter()
            .filter(|p| p["name"].as_str().is_some_and(|n| !n.trim().is_empty()) && p["s"].is_object())
            .take(MAX_PRESETS)
            .cloned()
            .collect();
        self.update(|o| {
            o.insert("presets".into(), json!(clean));
            Ok(())
        })
    }

    /// 設定を変える（SETTINGS のキーだけ）。保存先は作れるか確かめてから。
    pub fn set_settings(&self, patch: &Map<String, Value>) -> Result<Value, String> {
        if let Some(k) = patch.keys().find(|k| !SETTINGS.contains(&k.as_str())) {
            return Err(format!("変えられない設定です: {k}"));
        }
        let mut clean = Map::new();
        for (k, v) in patch {
            let s = v.as_str().ok_or_else(|| format!("{k} は文字で渡してください"))?.trim().trim_matches('"').trim().to_string();
            if k == "outputDir" {
                if s.is_empty() {
                    return Err("保存先が空です".into());
                }
                std::fs::create_dir_all(&s).map_err(|e| format!("保存先のフォルダを作れません（{s}）: {e}"))?;
            }
            clean.insert(k.clone(), json!(s));
        }
        self.update(|o| {
            o.extend(clean);
            Ok(())
        })
    }

    /// 初めての起動（state.json がまだ無い）: 前の形の state.json を引き継ぐ。→ 引き継いだ元
    pub fn import_legacy(&self, candidates: &[PathBuf]) -> Option<PathBuf> {
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        if self.path.exists() {
            return None;
        }
        let (from, old) = candidates.iter().find_map(|c| read_json(c).filter(Value::is_object).map(|v| (c.clone(), v)))?;
        let mut st = json!({});
        for k in ["presets", "last", "outputDir"] {
            if let Some(v) = old.get(k) {
                st[k] = v.clone();
            }
        }
        write_json(&self.path, &st).ok().map(|_| from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::tmp;

    #[test]
    fn defaults_and_round_trip() {
        let d = tmp("store");
        let s = Store::new(&d.join("state.json"), &d.join("out"));
        let st = s.load();
        assert_eq!((st["presets"].as_array().map(Vec::len), st["outputDir"].as_str()), (Some(0), d.join("out").to_str()));
        s.set_last(json!({"type": "date"})).unwrap();
        assert!(s.set_last(json!("x")).is_err());
        let st = s.set_presets(json!([{"name": "認印", "s": {}}, {"name": " ", "s": {}}, {"s": {}}, {"name": "x", "s": 1}])).unwrap();
        assert_eq!(st["presets"].as_array().unwrap().len(), 1, "名前の無い物・形の違う物は落とす");
        let many: Vec<Value> = (0..80).map(|i| json!({"name": format!("{i}"), "s": {}})).collect();
        assert_eq!(s.set_presets(json!(many)).unwrap()["presets"].as_array().unwrap().len(), MAX_PRESETS);
        assert_eq!(s.load()["last"]["type"], "date", "前に書いた物は残る");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn settings_are_checked() {
        let d = tmp("store-set");
        let s = Store::new(&d.join("state.json"), &d.join("out"));
        let mut m = Map::new();
        m.insert("outputDir".into(), json!(format!("\"{}\"", d.join("新しい 保存先").display())));
        let st = s.set_settings(&m).unwrap();
        assert_eq!(st["outputDir"], json!(d.join("新しい 保存先").display().to_string()), "エクスプローラーの「パスのコピー」の \" は外す");
        assert!(d.join("新しい 保存先").is_dir(), "保存先は作っておく");
        m.clear();
        m.insert("outputDir".into(), json!("  "));
        assert!(s.set_settings(&m).unwrap_err().contains("空"));
        m.clear();
        m.insert("presets".into(), json!([]));
        assert!(s.set_settings(&m).unwrap_err().contains("変えられない"), "設定以外は画面から書かせない");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn the_flask_version_is_taken_over_once() {
        let d = tmp("store-legacy");
        let old = d.join("DenshiIn").join("state.json");
        std::fs::create_dir_all(old.parent().unwrap()).unwrap();
        std::fs::write(
            &old,
            r#"{"presets":[{"name":"認印 山田","s":{"type":"mitome"}}],"last":{"type":"date"},"outputDir":"D:\\印","junk":1}"#,
        )
        .unwrap();
        let s = Store::new(&d.join("new").join("state.json"), &d.join("out"));
        assert_eq!(s.import_legacy(&[d.join("none.json"), old.clone()]), Some(old.clone()));
        let st = s.load();
        assert_eq!((st["presets"][0]["name"].as_str(), st["outputDir"].as_str()), (Some("認印 山田"), Some("D:\\印")));
        assert!(st.get("junk").is_none(), "知っている物だけ引き継ぐ");
        assert_eq!(s.import_legacy(&[old]), None, "2 回目は引き継がない（今の設定を上書きしない）");
        let _ = std::fs::remove_dir_all(&d);
    }
}
