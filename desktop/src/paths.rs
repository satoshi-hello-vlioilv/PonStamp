//! この PC の作業場所の中の置き場と、JSON の読み書き。
//!
//! ```text
//! <作業場所>\                 %LOCALAPPDATA%\PonStamp（試験・開発は PONSTAMP_LOCAL_ROOT で差し替える）
//!   state.json               設定・登録した印・最後の印（store.rs）
//!   app\                     この PC のアプリ（<exe>・app.json・README.md）。ショートカットと常駐はここの exe（入口）を指す
//!   desktop\<印>\<exe>       版ごとに写した exe。窓として動くのはこちら（動いている窓が app を掴まないので、app を入れ替えられる）
//!   update\stage\            裏で取り込み、確かめ終えた次の版（stage.json がその記録）
//!   update\old\              直前の版の控え
//!   update\applied.json      入れ替えた直後の印（画面が出たら消す。出ないまま次の起動になれば控えへ戻す）
//!   update\FAILED.json       起動できなかった版（もう取り込まない）
//!   update\source.json       更新の置き場の控え（次の起動の最初に確かめる）
//!   install.json             ショートカットの記録（「今後たずねない」）
//!   entry.json               配る入口から入れた PC が控えた、入口の置き場（更新の置き場の候補になる）
//!   want.json                配る版（置き場の distribute.json の写し）
//!   icon\<指紋>.ico          ショートカットが指すアイコン
//!   logs\app.log             記録
//! ```

use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Paths {
    pub root: PathBuf,
}

impl Paths {
    pub fn new(root: &Path) -> Paths {
        Paths { root: root.to_path_buf() }
    }
    pub fn app(&self) -> PathBuf {
        self.root.join("app")
    }
    pub fn desktop(&self) -> PathBuf {
        self.root.join("desktop")
    }
    pub fn work(&self) -> PathBuf {
        self.root.join("update")
    }
    pub fn stage(&self) -> PathBuf {
        self.work().join("stage")
    }
    pub fn stage_record(&self) -> PathBuf {
        self.work().join("stage.json")
    }
    pub fn old(&self) -> PathBuf {
        self.work().join("old")
    }
    pub fn applied(&self) -> PathBuf {
        self.work().join("applied.json")
    }
    pub fn failed(&self) -> PathBuf {
        self.work().join("FAILED.json")
    }
    pub fn source_record(&self) -> PathBuf {
        self.work().join("source.json")
    }
    pub fn want(&self) -> PathBuf {
        self.root.join("want.json")
    }
    pub fn state(&self) -> PathBuf {
        self.root.join("state.json")
    }
    pub fn logs(&self) -> PathBuf {
        self.root.join("logs")
    }
}

/// JSON を読む（先頭の BOM は外す）。無い・読めなければ None。
pub fn read_json(p: &Path) -> Option<Value> {
    let b = std::fs::read(p).ok()?;
    serde_json::from_slice(b.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&b)).ok()
}

/// JSON を書く（一時ファイル → 名前の付け替え。途中で止まっても前か後のどちらか）。
pub fn write_json(p: &Path, v: &Value) -> Result<(), String> {
    let body = serde_json::to_vec_pretty(v).unwrap_or_default();
    write_atomic(p, &body)
}

/// ファイルを書く（一時ファイル → 名前の付け替え）。
pub fn write_atomic(p: &Path, body: &[u8]) -> Result<(), String> {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| format!("{} を作れません: {e}", d.display()))?;
    }
    let tmp = p.with_extension(format!("tmp-{}", std::process::id()));
    std::fs::write(&tmp, body).map_err(|e| format!("{} を書けません: {e}", tmp.display()))?;
    std::fs::rename(&tmp, p).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{} を書けません: {e}", p.display())
    })
}

/// 記録に書く今の時刻（この PC の暦）。
pub fn now_text() -> String {
    chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

#[cfg(test)]
pub fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("ps-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_round_trip_and_bom() {
        let d = tmp("json");
        let f = d.join("a").join("x.json");
        write_json(&f, &serde_json::json!({"k": "値"})).unwrap();
        assert_eq!(read_json(&f).unwrap()["k"], "値");
        std::fs::write(&f, b"\xEF\xBB\xBF{\"k\":1}").unwrap();
        assert_eq!(read_json(&f).unwrap()["k"], 1, "メモ帳が付ける BOM も読む");
        let left: Vec<_> = std::fs::read_dir(f.parent().unwrap()).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(left.len(), 1, "一時ファイルを残さない: {left:?}");
        let _ = std::fs::remove_dir_all(&d);
    }
}
