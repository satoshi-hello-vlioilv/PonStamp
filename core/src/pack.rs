//! 配る ZIP を作る（読む側は update::extract_zip）。道具（tools/ の配る ZIP）と試験が使う。
//!
//! root の中のファイルを `<top>/<root からの道>` として入れる。並びは道の名前順（同じ中身なら同じ ZIP）。区切りは「/」。
//! 実行の許可（Unix）は残す（Linux の通しの確かめで、取り出した exe を動かすため。Windows には無い考え）。

use std::io::Write;
use std::path::{Path, PathBuf};

/// root の中のファイル（下のフォルダも）を、root からの道の名前順に。
fn files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut out = vec![];
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for e in std::fs::read_dir(&dir).map_err(|e| format!("{} を読めません: {e}", dir.display()))? {
            let p = e.map_err(|e| e.to_string())?.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.is_file() {
                out.push(p);
            }
        }
    }
    out.sort_by_key(|p| rel_name(root, p));
    Ok(out)
}

fn rel_name(root: &Path, p: &Path) -> String {
    let rel = p.strip_prefix(root).unwrap_or(p);
    rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/")
}

/// root の中身を `<top>/…` として out に ZIP にする（縮める・いちばん小さく）。→ 入れたファイルの数
pub fn zip_dir(root: &Path, top: &str, out: &Path) -> Result<usize, String> {
    let list = files(root)?;
    let f = std::fs::File::create(out).map_err(|e| format!("{} を作れません: {e}", out.display()))?;
    let mut z = zip::ZipWriter::new(f);
    for p in &list {
        let mut opt =
            zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).compression_level(Some(9));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(m) = std::fs::metadata(p) {
                opt = opt.unix_permissions(m.permissions().mode() & 0o777);
            }
        }
        z.start_file(format!("{top}/{}", rel_name(root, p)), opt).map_err(|e| format!("ZIP に入れられません: {e}"))?;
        let body = std::fs::read(p).map_err(|e| format!("{} を読めません: {e}", p.display()))?;
        z.write_all(&body).map_err(|e| format!("ZIP に書けません: {e}"))?;
    }
    z.finish().map_err(|e| format!("ZIP を閉じられません: {e}"))?;
    Ok(list.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::tmp;

    #[test]
    fn packs_in_name_order_under_one_top_folder_and_extracts_back() {
        let d = tmp("pack");
        let root = d.join("stage");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("b.txt"), "b").unwrap();
        std::fs::write(root.join("a.exe"), "exe").unwrap();
        std::fs::write(root.join("sub").join("c.json"), "{}").unwrap();
        let out = d.join("x.zip");
        assert_eq!(zip_dir(&root, "App", &out).unwrap(), 3);
        let z = zip::ZipArchive::new(std::fs::File::open(&out).unwrap()).unwrap();
        let names_of = |z: &zip::ZipArchive<std::fs::File>| z.file_names().map(|n| n.unwrap().to_string()).collect::<Vec<String>>();
        let names = names_of(&z);
        let mut sorted = names.clone();
        sorted.sort();
        assert_eq!(sorted, ["App/a.exe", "App/b.txt", "App/sub/c.json"], "先頭のフォルダは 1 つ・区切りは /");
        // 取り込む側（extract_zip）で取り出せる
        let back = d.join("back");
        crate::update::extract_zip(&out, &back).unwrap();
        assert_eq!(std::fs::read_to_string(back.join("App").join("sub").join("c.json")).unwrap(), "{}");
        // 同じ中身なら同じ並び（名前順）
        let out2 = d.join("y.zip");
        zip_dir(&root, "App", &out2).unwrap();
        let z2 = zip::ZipArchive::new(std::fs::File::open(&out2).unwrap()).unwrap();
        assert_eq!(names_of(&z2), names);
    }
}
