//! エクスプローラー・デスクトップの右クリックのメニュー（常駐している間だけ）。
//!
//! - 何も無い所を右クリックすると「電子印をコピー（<名前>）」の段が出て、その下に登録した印が並ぶ。押すとそのままコピーされる
//!   （"<この PC の入口の exe>" --copy <番号> が、動いている窓へ渡る。窓は開かず、右下に知らせが出る）
//! - Windows: HKCU\Software\Classes\Directory\Background\shell\<名前>（管理者の権限は要らない。デスクトップの地もここを読む）。
//!   Windows 11 では「その他のオプションを確認」（Shift+F10）の中に出る
//! - 起動したとき・登録した印が変わったときに書き直し、終了で外す（常駐していない間に押されても、開いてコピーする）
//! - ほかの OS（試験・開発）: PONSTAMP_SHELLMENU_FILE があれば、書く中身をそのファイルへ写す（無ければ何もしない）

use std::path::Path;

/// 押されたときの引数（--copy <番号 | last>）。
pub const COPY_ARG: &str = "--copy";

/// メニューの 1 行。key はレジストリのキー（並びの順に名前を付ける）。
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub key: String,
    pub label: String,
    pub command: String,
}

/// メニューの見出し（段の名前）。
pub fn title(app: &str) -> String {
    format!("電子印をコピー（{app}）")
}

/// 並べる行: いま作っている印（あれば）→ 登録した印（上限まで）。& はメニューの字の下線の印なので && にする。
pub fn entries(exe: &Path, last: bool, presets: &[String], max: usize) -> Vec<Entry> {
    let cmd = |which: &str| format!("\"{}\" {COPY_ARG} {which}", exe.display());
    let label = |s: &str| s.replace('&', "&&");
    let mut out = vec![];
    if last {
        out.push(Entry { key: "00".into(), label: "いま作っている印".into(), command: cmd("last") });
    }
    for (i, name) in presets.iter().take(max).enumerate() {
        out.push(Entry { key: format!("{:02}", i + 1), label: label(name), command: cmd(&i.to_string()) });
    }
    out
}

/// 引数から「--copy <何を>」を読む。
pub fn copy_target<S: AsRef<str>>(args: &[S]) -> Option<String> {
    let i = args.iter().position(|a| a.as_ref() == COPY_ARG)?;
    let v = args.get(i + 1)?.as_ref();
    (v == "last" || v.parse::<usize>().is_ok()).then(|| v.to_string())
}

/// 書き直す（前の行は消してから）。
pub fn sync(app: &str, icon: &Path, items: &[Entry]) -> Result<(), String> {
    imp::remove(app)?;
    if items.is_empty() {
        return Ok(());
    }
    let rows: Vec<(&str, &str, &str)> = items.iter().map(|e| (e.key.as_str(), e.label.as_str(), e.command.as_str())).collect();
    imp::write(app, &title(app), icon, &rows)
}

/// 外す（無くてもよい）。
pub fn remove(app: &str) -> Result<(), String> {
    imp::remove(app)
}

#[cfg(windows)]
mod imp {
    use std::path::Path;
    use windows::core::HSTRING;
    use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
    use windows::Win32::System::Registry::{RegCloseKey, RegCreateKeyW, RegDeleteTreeW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, REG_SZ};

    const BASE: &str = r"Software\Classes\Directory\Background\shell";

    fn create(path: &str) -> Result<HKEY, String> {
        let mut key = HKEY::default();
        let r = unsafe { RegCreateKeyW(HKEY_CURRENT_USER, &HSTRING::from(path), &mut key) };
        if r.is_err() {
            return Err(format!("右クリックのメニュー（レジストリ）を書けません: {}", r.to_hresult().message()));
        }
        Ok(key)
    }

    fn set(key: HKEY, name: &str, value: &str) -> Result<(), String> {
        let wide: Vec<u16> = value.encode_utf16().chain([0]).collect();
        let bytes: Vec<u8> = wide.iter().flat_map(|c| c.to_le_bytes()).collect();
        let r = unsafe { RegSetValueExW(key, &HSTRING::from(name), None, REG_SZ, Some(&bytes)) };
        if r.is_err() {
            return Err(format!("右クリックのメニュー（レジストリ）を書けません: {}", r.to_hresult().message()));
        }
        Ok(())
    }

    /// キーを作って値を書き、閉じる（name が空なら既定の値）。
    fn put(path: &str, values: &[(&str, &str)]) -> Result<(), String> {
        let key = create(path)?;
        let r = values.iter().try_for_each(|(n, v)| set(key, n, v));
        unsafe {
            let _ = RegCloseKey(key);
        }
        r
    }

    /// items: (キー, 見出し, 起動の文)
    pub fn write(app: &str, title: &str, icon: &Path, items: &[(&str, &str, &str)]) -> Result<(), String> {
        let root = format!(r"{BASE}\{app}");
        let icon = icon.display().to_string();
        // SubCommands を空で置くと、下の shell の行が段（入れ子のメニュー）になる
        put(&root, &[("MUIVerb", title), ("Icon", &icon), ("SubCommands", "")])?;
        for (key, label, command) in items {
            let item = format!(r"{root}\shell\{key}");
            put(&item, &[("MUIVerb", label), ("Icon", &icon)])?;
            put(&format!(r"{item}\command"), &[("", command)])?;
        }
        Ok(())
    }

    pub fn remove(app: &str) -> Result<(), String> {
        let r = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(format!(r"{BASE}\{app}"))) };
        if r.is_err() && r != ERROR_FILE_NOT_FOUND {
            return Err(format!("右クリックのメニュー（レジストリ）を外せません: {}", r.to_hresult().message()));
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    use std::path::{Path, PathBuf};

    fn file() -> Option<PathBuf> {
        std::env::var_os("PONSTAMP_SHELLMENU_FILE").map(PathBuf::from)
    }

    pub fn write(_app: &str, title: &str, icon: &Path, items: &[(&str, &str, &str)]) -> Result<(), String> {
        let Some(f) = file() else { return Ok(()) };
        let rows: Vec<_> = items.iter().map(|(k, l, c)| serde_json::json!({"key": k, "label": l, "command": c})).collect();
        let body = serde_json::json!({"title": title, "icon": icon, "items": rows});
        std::fs::write(&f, serde_json::to_vec_pretty(&body).unwrap_or_default()).map_err(|e| format!("{} を書けません: {e}", f.display()))
    }

    pub fn remove(_app: &str) -> Result<(), String> {
        match file().map(std::fs::remove_file) {
            Some(Err(e)) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn rows_follow_the_presets_and_point_at_the_entry() {
        let exe = PathBuf::from(r"C:\Users\山田\AppData\Local\PonStamp\app\PonStamp.exe");
        let names: Vec<String> = ["認印 山田", "R&D 部"].iter().map(|s| s.to_string()).collect();
        let rows = entries(&exe, true, &names, 10);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].command, format!("\"{}\" --copy last", exe.display()), "空白のある場所でも動くよう \" で囲む");
        assert_eq!(rows[1].label, "認印 山田");
        assert_eq!(rows[2].label, "R&&D 部", "& はメニューで消えないよう && にする");
        assert!(rows[2].command.ends_with("--copy 1"));
        let keys: Vec<_> = rows.iter().map(|r| r.key.clone()).collect();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted, "キーの名前の順がメニューの並び");
        assert_eq!(entries(&exe, false, &names, 1).len(), 1, "上限まで");
    }

    #[test]
    fn the_copy_argument_is_read() {
        assert_eq!(copy_target(&["PonStamp.exe", "--copy", "3"]), Some("3".into()));
        assert_eq!(copy_target(&["PonStamp.exe", "--copy", "last"]), Some("last".into()));
        assert_eq!(copy_target(&["PonStamp.exe", "--copy", "x;y"]), None, "番号と last のほかは受けない");
        assert_eq!(copy_target(&["PonStamp.exe", "--tray"]), None);
    }

    #[cfg(not(windows))]
    #[test]
    fn sync_and_remove() {
        let f = std::env::temp_dir().join(format!("ps-shellmenu-{}.json", std::process::id()));
        std::env::set_var("PONSTAMP_SHELLMENU_FILE", &f);
        let exe = PathBuf::from("/x/PonStamp");
        sync("PonStampTest", Path::new("/x/i.ico"), &entries(&exe, true, &["a".into()], 10)).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(&f).unwrap()).unwrap();
        assert_eq!(v["items"].as_array().unwrap().len(), 2);
        remove("PonStampTest").unwrap();
        remove("PonStampTest").unwrap();
        assert!(!f.exists(), "外すのは何度でもよい");
    }
}
