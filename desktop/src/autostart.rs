//! Windows 起動時の常駐（サインインしたら、窓を出さずに通知領域へ常駐する）。
//!
//! - Windows: HKCU\Software\Microsoft\Windows\CurrentVersion\Run の値（名前 = アプリ名、中身 = "<この PC の入口の exe>" --tray）。
//!   管理者の権限は要らない。VBScript（スタートアップの .vbs）は Windows で廃止が予定され、対策ソフトにも止められやすいので使わない
//! - ほかの OS（試験・開発）: ~/.config/autostart/<名前>.desktop（PONSTAMP_AUTOSTART_DIR で差し替えられる）
//!
//! 指す先は版ごとの写しではなく、いつもこの PC の入口（app\<exe>）。写しは更新のたびに場所が変わるため。

use std::path::{Path, PathBuf};

/// 常駐で起こすときの引数（窓を出さない）。
pub const TRAY_ARG: &str = "--tray";

/// 登録してある起動の文（無ければ None）。
pub fn registered(name: &str) -> Option<String> {
    imp::read(name)
}

/// 登録の文が exe を指しているか。
pub fn points_to(command: &str, exe: &Path) -> bool {
    let want = exe.to_string_lossy().to_lowercase();
    command.to_lowercase().contains(&want)
}

/// 起動の文（"<exe>" --tray）。
pub fn command_for(exe: &Path) -> String {
    format!("\"{}\" {TRAY_ARG}", exe.display())
}

/// 常駐を入れる・外す。
pub fn set(name: &str, on: bool, exe: &Path) -> Result<(), String> {
    if on {
        imp::write(name, &command_for(exe))
    } else {
        imp::remove(name)
    }
}

#[cfg(windows)]
mod imp {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE,
        KEY_SET_VALUE, REG_SAM_FLAGS, REG_SZ,
    };

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

    fn open(access: REG_SAM_FLAGS) -> Result<HKEY, String> {
        let mut key = HKEY::default();
        let r = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, &HSTRING::from(RUN), None, access, &mut key) };
        if r.is_err() {
            return Err(format!("起動時の設定（レジストリ）を開けません: {}", r.to_hresult().message()));
        }
        Ok(key)
    }

    pub fn read(name: &str) -> Option<String> {
        let key = open(KEY_QUERY_VALUE).ok()?;
        let n = HSTRING::from(name);
        let mut size = 0u32;
        let out = unsafe {
            let r = RegQueryValueExW(key, PCWSTR(n.as_ptr()), None, None, None, Some(&mut size));
            if r.is_err() || size == 0 {
                None
            } else {
                let mut buf = vec![0u16; (size as usize).div_ceil(2)];
                let r = RegQueryValueExW(key, PCWSTR(n.as_ptr()), None, None, Some(buf.as_mut_ptr().cast()), Some(&mut size));
                r.is_ok().then(|| {
                    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
                    String::from_utf16_lossy(&buf[..end])
                })
            }
        };
        unsafe {
            let _ = RegCloseKey(key);
        }
        out
    }

    pub fn write(name: &str, command: &str) -> Result<(), String> {
        let key = open(KEY_SET_VALUE)?;
        let wide: Vec<u16> = command.encode_utf16().chain([0]).collect();
        let bytes: Vec<u8> = wide.iter().flat_map(|c| c.to_le_bytes()).collect();
        let r = unsafe { RegSetValueExW(key, &HSTRING::from(name), None, REG_SZ, Some(&bytes)) };
        unsafe {
            let _ = RegCloseKey(key);
        }
        if r.is_err() {
            return Err(format!("起動時の設定（レジストリ）を書けません: {}", r.to_hresult().message()));
        }
        Ok(())
    }

    pub fn remove(name: &str) -> Result<(), String> {
        let key = open(KEY_SET_VALUE)?;
        let r = unsafe { RegDeleteValueW(key, &HSTRING::from(name)) };
        unsafe {
            let _ = RegCloseKey(key);
        }
        if r.is_err() && r != ERROR_FILE_NOT_FOUND {
            return Err(format!("起動時の設定（レジストリ）を外せません: {}", r.to_hresult().message()));
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;

    fn file(name: &str) -> PathBuf {
        let dir = std::env::var_os("PONSTAMP_AUTOSTART_DIR").map(PathBuf::from).unwrap_or_else(|| {
            let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
            home.join(".config").join("autostart")
        });
        dir.join(format!("{name}.desktop"))
    }

    pub fn read(name: &str) -> Option<String> {
        let text = std::fs::read_to_string(file(name)).ok()?;
        text.lines().find_map(|l| l.strip_prefix("Exec=")).map(str::to_string)
    }

    pub fn write(name: &str, command: &str) -> Result<(), String> {
        let f = file(name);
        if let Some(d) = f.parent() {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        let body = format!("[Desktop Entry]\nType=Application\nName={name}\nExec={command}\nX-GNOME-Autostart-enabled=true\n");
        std::fs::write(&f, body).map_err(|e| format!("{} を書けません: {e}", f.display()))
    }

    pub fn remove(name: &str) -> Result<(), String> {
        match std::fs::remove_file(file(name)) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_points_at_the_entry_with_the_tray_flag() {
        let exe = PathBuf::from(r"C:\Users\山田\AppData\Local\PonStamp\app\PonStamp.exe");
        let c = command_for(&exe);
        assert!(c.starts_with('"') && c.ends_with(" --tray"), "空白のある場所でも動くよう \" で囲む: {c}");
        assert!(points_to(&c, &exe));
        assert!(!points_to(&c, Path::new(r"C:\Users\山田\AppData\Local\PonStamp\desktop\1-2\PonStamp.exe")), "版ごとの写しは指さない");
    }

    #[cfg(not(windows))]
    #[test]
    fn set_read_remove() {
        let d = std::env::temp_dir().join(format!("ps-autostart-{}", std::process::id()));
        std::env::set_var("PONSTAMP_AUTOSTART_DIR", &d);
        let exe = d.join("app").join("PonStamp");
        assert_eq!(registered("PonStampTest"), None);
        set("PonStampTest", true, &exe).unwrap();
        assert!(registered("PonStampTest").is_some_and(|c| points_to(&c, &exe)));
        set("PonStampTest", false, &exe).unwrap();
        set("PonStampTest", false, &exe).unwrap();
        assert_eq!(registered("PonStampTest"), None, "外すのは何度でもよい");
        let _ = std::fs::remove_dir_all(&d);
    }
}
