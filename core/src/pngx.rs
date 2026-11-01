//! PNG の解像度（pHYs）と、クリップボードへ渡す絵（DIB）。
//!
//! 画面（canvas）が作る PNG には解像度が無いので、Word・Excel などは 96 dpi と見なして貼り付ける。600 dpi で作った 10.5mm の印
//! （248px）は 65.6mm になってしまう。そこで保存・コピーのときに pHYs（1 m あたりの画素の数）を書き、貼り付け先で指定の mm になるようにする。

/// PNG の頭。
const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

/// CRC-32（PNG の塊の確かめ）。
fn crc32(parts: &[&[u8]]) -> u32 {
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    let t = TABLE.get_or_init(|| {
        let mut t = [0u32; 256];
        for (i, v) in t.iter_mut().enumerate() {
            let mut c = i as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            }
            *v = c;
        }
        t
    });
    let mut c = 0xFFFF_FFFFu32;
    for p in parts {
        for &b in *p {
            c = t[((c ^ b as u32) & 0xFF) as usize] ^ (c >> 8);
        }
    }
    c ^ 0xFFFF_FFFF
}

/// 1 インチあたりの点（dpi）→ 1 m あたりの点（pHYs の単位）。
pub fn dots_per_meter(dpi: u32) -> u32 {
    (dpi as f64 / 0.0254).round() as u32
}

/// PNG の塊（種類, 中身）。
type Chunk<'a> = (&'a [u8], &'a [u8]);

/// PNG の塊の並び。形が違えば理由。
fn chunks(png: &[u8]) -> Result<Vec<Chunk<'_>>, String> {
    if !png.starts_with(SIGNATURE) {
        return Err("PNG ではありません".into());
    }
    let mut out = vec![];
    let mut i = SIGNATURE.len();
    while i + 12 <= png.len() {
        let len = u32::from_be_bytes(png[i..i + 4].try_into().unwrap()) as usize;
        let end = i + 12 + len;
        if end > png.len() {
            return Err("PNG が途中で切れています".into());
        }
        out.push((&png[i + 4..i + 8], &png[i + 8..i + 8 + len]));
        i = end;
        if out.last().is_some_and(|(k, _)| *k == b"IEND") {
            return Ok(out);
        }
    }
    Err("PNG の終わり（IEND）がありません".into())
}

fn push_chunk(out: &mut Vec<u8>, kind: &[u8], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    out.extend_from_slice(&crc32(&[kind, data]).to_be_bytes());
}

/// PNG に解像度を書く（前の pHYs は外し、IHDR の直後に置く）。
pub fn with_dpi(png: &[u8], dpi: u32) -> Result<Vec<u8>, String> {
    if !(1..=100_000).contains(&dpi) {
        return Err(format!("解像度が範囲の外です: {dpi}"));
    }
    let list = chunks(png)?;
    if list.first().map(|(k, _)| *k) != Some(b"IHDR".as_slice()) {
        return Err("PNG の始まり（IHDR）がありません".into());
    }
    let ppm = dots_per_meter(dpi).to_be_bytes();
    let phys: Vec<u8> = ppm.iter().chain(ppm.iter()).copied().chain([1u8]).collect(); // 単位 1 = メートル
    let mut out = SIGNATURE.to_vec();
    for (i, (k, d)) in list.iter().enumerate() {
        if *k == b"pHYs" {
            continue;
        }
        push_chunk(&mut out, k, d);
        if i == 0 {
            push_chunk(&mut out, b"pHYs", &phys);
        }
    }
    Ok(out)
}

/// PNG の解像度（pHYs がメートルで書いてあれば dpi。無ければ None）。
pub fn dpi_of(png: &[u8]) -> Option<f64> {
    let list = chunks(png).ok()?;
    let (_, d) = list.iter().find(|(k, _)| *k == b"pHYs")?;
    (d.len() == 9 && d[8] == 1).then(|| u32::from_be_bytes(d[0..4].try_into().unwrap()) as f64 * 0.0254)
}

/// 画素（幅・高さ・RGBA）。
pub struct Pixels {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// PNG を RGBA の画素に戻す（パレット・灰色・16 bit も 8 bit の RGBA にそろえる）。
pub fn decode(png: &[u8]) -> Result<Pixels, String> {
    let mut d = png::Decoder::new(std::io::Cursor::new(png));
    d.set_transformations(png::Transformations::normalize_to_color8() | png::Transformations::ALPHA);
    let mut r = d.read_info().map_err(|e| format!("PNG を読めません: {e}"))?;
    let mut buf = vec![0; r.output_buffer_size().ok_or("PNG が大きすぎます")?];
    let info = r.next_frame(&mut buf).map_err(|e| format!("PNG を読めません: {e}"))?;
    buf.truncate(info.buffer_size());
    let (w, h) = (info.width, info.height);
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::GrayscaleAlpha => buf.chunks_exact(2).flat_map(|p| [p[0], p[0], p[0], p[1]]).collect(),
        other => return Err(format!("この色の形の PNG は扱えません: {other:?}")),
    };
    Ok(Pixels { width: w, height: h, rgba })
}

/// クリップボードの CF_DIBV5 の中身（BITMAPV5HEADER＋下から上の BGRA）。解像度も入れる。
/// 透明を読まない貼り付け先（ペイントなど）で背景が黒くならないよう、まったく透明な画素の色は白にしておく。
pub fn dibv5(px: &Pixels, dpi: u32) -> Vec<u8> {
    let (w, h) = (px.width as usize, px.height as usize);
    let ppm = dots_per_meter(dpi) as i32;
    let mut out = Vec::with_capacity(124 + w * h * 4);
    let i32le = |v: i32| v.to_le_bytes();
    let u32le = |v: u32| v.to_le_bytes();
    out.extend_from_slice(&u32le(124)); // bV5Size
    out.extend_from_slice(&i32le(w as i32)); // bV5Width
    out.extend_from_slice(&i32le(h as i32)); // bV5Height（正 = 下から上）
    out.extend_from_slice(&1u16.to_le_bytes()); // bV5Planes
    out.extend_from_slice(&32u16.to_le_bytes()); // bV5BitCount
    out.extend_from_slice(&u32le(3)); // bV5Compression = BI_BITFIELDS
    out.extend_from_slice(&u32le((w * h * 4) as u32)); // bV5SizeImage
    out.extend_from_slice(&i32le(ppm)); // bV5XPelsPerMeter
    out.extend_from_slice(&i32le(ppm)); // bV5YPelsPerMeter
    out.extend_from_slice(&u32le(0)); // bV5ClrUsed
    out.extend_from_slice(&u32le(0)); // bV5ClrImportant
    for m in [0x00FF_0000u32, 0x0000_FF00, 0x0000_00FF, 0xFF00_0000] {
        out.extend_from_slice(&u32le(m)); // 赤・緑・青・透明の位置
    }
    out.extend_from_slice(&u32le(0x7352_4742)); // bV5CSType = LCS_sRGB
    out.extend_from_slice(&[0u8; 36]); // bV5Endpoints
    out.extend_from_slice(&[0u8; 12]); // bV5GammaRed/Green/Blue
    out.extend_from_slice(&u32le(4)); // bV5Intent = LCS_GM_IMAGES
    out.extend_from_slice(&[0u8; 12]); // bV5ProfileData・ProfileSize・Reserved
    debug_assert_eq!(out.len(), 124);
    for y in (0..h).rev() {
        for p in px.rgba[y * w * 4..(y + 1) * w * 4].chunks_exact(4) {
            let [r, g, b, a] = [p[0], p[1], p[2], p[3]];
            out.extend_from_slice(&if a == 0 { [255, 255, 255, 0] } else { [b, g, r, a] });
        }
    }
    out
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// 試しの PNG（w×h の RGBA。左上の画素だけ赤・ほかは透明）
    pub fn sample(w: u32, h: u32) -> Vec<u8> {
        let mut out = vec![];
        {
            let mut e = png::Encoder::new(&mut out, w, h);
            e.set_color(png::ColorType::Rgba);
            e.set_depth(png::BitDepth::Eight);
            let mut wr = e.write_header().unwrap();
            let mut px = vec![0u8; (w * h * 4) as usize];
            px[..4].copy_from_slice(&[214, 52, 58, 255]);
            wr.write_image_data(&px).unwrap();
        }
        out
    }

    #[test]
    fn crc_matches_the_png_spec() {
        assert_eq!(crc32(&[b"IEND"]), 0xAE42_6082, "IEND の CRC は決まった値");
    }

    #[test]
    fn dpi_is_written_once_and_read_back() {
        let png = sample(248, 248);
        assert_eq!(dpi_of(&png), None, "画面の PNG には解像度が無い（貼り付け先は 96 dpi と見なす）");
        let with = with_dpi(&png, 600).unwrap();
        let dpi = dpi_of(&with).unwrap();
        assert!((dpi - 600.0).abs() < 0.05, "{dpi}");
        let mm = 248.0 / dpi * 25.4;
        assert!((mm - 10.5).abs() < 0.01, "248px を 600 dpi なら 10.5mm: {mm}");
        let again = with_dpi(&with, 1200).unwrap();
        assert_eq!(again.windows(4).filter(|w| *w == b"pHYs").count(), 1, "pHYs は 1 つだけ");
        assert!((dpi_of(&again).unwrap() - 1200.0).abs() < 0.1);
        let px = decode(&again).unwrap();
        assert_eq!((px.width, px.height, &px.rgba[..4]), (248, 248, &[214u8, 52, 58, 255][..]), "画素はそのまま（読み直せる）");
        assert!(with_dpi(b"not a png", 600).is_err());
        assert!(with_dpi(&png, 0).is_err());
        assert!(with_dpi(&png[..png.len() - 6], 600).is_err(), "途中で切れた PNG は断る");
    }

    #[test]
    fn dib_has_the_resolution_and_white_for_transparent() {
        let px = decode(&sample(3, 2)).unwrap();
        let dib = dibv5(&px, 600);
        assert_eq!(dib.len(), 124 + 3 * 2 * 4);
        assert_eq!(i32::from_le_bytes(dib[24..28].try_into().unwrap()), 23622, "600 dpi = 23622 点/m");
        // 下から上: 左上の赤い画素は最後の行の先頭
        let top_left = &dib[124 + 3 * 4..124 + 3 * 4 + 4];
        assert_eq!(top_left, &[58, 52, 214, 255], "BGRA");
        assert_eq!(&dib[124..128], &[255, 255, 255, 0], "透明な画素は白（透明を読まない貼り付け先で黒くならない）");
    }
}
