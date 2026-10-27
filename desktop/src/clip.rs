//! クリップボードへ印を置く（Windows）。
//!
//! 2 つの形で置く: ① 登録した形「PNG」（透明を保つ。Office・ブラウザなどが読む。解像度 pHYs つき）
//! ② CF_DIBV5（透明つきのビットマップ。PNG を読まない貼り付け先向け。解像度つき・まったく透明な所は白）。
//! WebView の navigator.clipboard は画像を作り直すので解像度が落ちる。そのため Windows では Rust が直に置く。
//! ほかの OS では置かない（画面がブラウザの仕組みで置く）。

/// 置けたら Ok(true)。この OS では置かない（画面が置く）なら Ok(false)。
pub fn put(png: &[u8], dib: &[u8]) -> Result<bool, String> {
    imp::put(png, dib)
}

#[cfg(windows)]
mod imp {
    use windows::core::w;
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::CF_DIBV5;

    /// 中身を写した動かせるメモリ。
    fn global(bytes: &[u8]) -> Result<HGLOBAL, String> {
        unsafe {
            let h = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|e| format!("メモリを取れません: {e}"))?;
            let p = GlobalLock(h);
            if p.is_null() {
                let _ = GlobalFree(Some(h));
                return Err("メモリを使えません".into());
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), p.cast::<u8>(), bytes.len());
            let _ = GlobalUnlock(h);
            Ok(h)
        }
    }

    /// クリップボードを開く（ほかのアプリが一瞬掴んでいることがあるので、少し待ってやり直す）。
    fn open() -> Result<(), String> {
        for _ in 0..20 {
            if unsafe { OpenClipboard(None) }.is_ok() {
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        Err("クリップボードをほかのアプリが使っています。もう一度コピーしてください".into())
    }

    pub fn put(png: &[u8], dib: &[u8]) -> Result<bool, String> {
        open()?;
        let result = (|| unsafe {
            EmptyClipboard().map_err(|e| format!("クリップボードを空にできません: {e}"))?;
            let fmt_png = RegisterClipboardFormatW(w!("PNG"));
            for (fmt, bytes) in [(fmt_png, png), (CF_DIBV5.0 as u32, dib)] {
                let h = global(bytes)?;
                // 置けたらメモリはクリップボードの物（解放しない）。置けなければ自分で解放する
                if let Err(e) = SetClipboardData(fmt, Some(HANDLE(h.0))) {
                    let _ = GlobalFree(Some(h));
                    return Err(format!("クリップボードへ置けません: {e}"));
                }
            }
            Ok(true)
        })();
        unsafe {
            let _ = CloseClipboard();
        }
        result
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn put(_png: &[u8], _dib: &[u8]) -> Result<bool, String> {
        Ok(false)
    }
}
