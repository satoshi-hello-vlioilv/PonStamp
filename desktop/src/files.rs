//! 印を PNG で保存する（名前を安全にし、同じ名前があれば番号を付ける）。

use crate::paths::write_atomic;
use std::path::{Path, PathBuf};

/// ファイル名に使えない字・空白を「_」にし、前後の「.」「_」を外して 80 字まで（空なら stamp）。
pub fn safe_name(name: &str) -> String {
    let mut out = String::new();
    let mut last_bad = false;
    for c in name.chars() {
        let bad = matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_whitespace() || c.is_control();
        if bad {
            if !last_bad {
                out.push('_');
            }
        } else {
            out.push(c);
        }
        last_bad = bad;
    }
    let trimmed: String = out.trim_matches(['.', '_']).chars().take(80).collect();
    // Windows が使わせない名前（CON・PRN・AUX・NUL・COM1〜9・LPT1〜9）は前に「_」を付ける
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&trimmed.to_ascii_uppercase().as_str())
        || (trimmed.len() == 4
            && ["COM", "LPT"].contains(&trimmed[..3].to_ascii_uppercase().as_str())
            && trimmed.as_bytes()[3].is_ascii_digit());
    match trimmed {
        t if t.is_empty() => "stamp".into(),
        t if reserved => format!("_{t}"),
        t => t,
    }
}

/// folder の中の使っていない名前（base.png・base_2.png・…）。
pub fn unique_path(folder: &Path, base: &str, ext: &str) -> PathBuf {
    let first = folder.join(format!("{base}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..).map(|i| folder.join(format!("{base}_{i}.{ext}"))).find(|p| !p.exists()).expect("番号は尽きない")
}

/// 保存する → 置いた場所。
pub fn save(folder: &Path, name: &str, body: &[u8]) -> Result<PathBuf, String> {
    std::fs::create_dir_all(folder).map_err(|e| format!("保存先のフォルダを作れません（{}）: {e}", folder.display()))?;
    let path = unique_path(folder, &safe_name(name), "png");
    write_atomic(&path, body)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_made_safe() {
        assert_eq!(safe_name("認印_山田"), "認印_山田");
        assert_eq!(safe_name("日付印 総務課/山田:2026"), "日付印_総務課_山田_2026");
        assert_eq!(safe_name(" ..a  b.. "), "a_b");
        assert_eq!(safe_name("\\/:*?"), "stamp");
        assert_eq!(safe_name("con"), "_con");
        assert_eq!(safe_name("LPT1"), "_LPT1");
        assert_eq!(safe_name("COMPANY"), "COMPANY");
        assert_eq!(safe_name(&"字".repeat(100)).chars().count(), 80);
    }

    #[test]
    fn same_names_get_numbers() {
        let d = crate::paths::tmp("files");
        let a = save(&d.join("出力"), "認印 山田", b"1").unwrap();
        let b = save(&d.join("出力"), "認印 山田", b"2").unwrap();
        assert_eq!(a.file_name().unwrap(), "認印_山田.png");
        assert_eq!(b.file_name().unwrap(), "認印_山田_2.png");
        assert_eq!(std::fs::read(&a).unwrap(), b"1", "前の物を上書きしない");
        let _ = std::fs::remove_dir_all(&d);
    }
}
