//! 自己診断の結果（PONSTAMP_SELFTEST に窓が書く JSON）を読んで出す（CI の Linux・Windows が使う）。
//!
//! ```text
//! cargo tools selftest <結果のファイル>   → PASS/FAIL を 1 行ずつ。すべて通れば終了コード 0
//! ```

use serde_json::Value;

/// 結果を行にする。→ (行, すべて通ったか)
pub fn report(r: &Value) -> (Vec<String>, bool) {
    let mark = |ok: bool| if ok { "PASS" } else { "FAIL" };
    let s = |v: &Value| match v {
        Value::String(t) => t.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    };
    let mut lines: Vec<String> = r["results"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|x| format!("{}: {} -- {}", mark(x["ok"] == true), s(&x["name"]), s(&x["info"])))
        .collect();
    lines.extend(
        r["saved"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|x| format!("{}: 保存した PNG の解像度 {} {}", mark(x["ok"] == true), s(&x["type"]), s(&x["fileDpi"]))),
    );
    if !s(&r["error"]).is_empty() {
        lines.push(format!("ERROR: {}", s(&r["error"])));
    }
    (lines, r["ok"] == true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn every_row_and_the_overall_result() {
        let r = json!({"ok": false, "results": [{"name": "描ける", "ok": true, "info": "640px"}, {"name": "コピー", "ok": false, "info": "x"}],
                       "saved": [{"type": "mitome", "ok": true, "fileDpi": 600.0}], "error": "時間切れ"});
        let (lines, ok) = report(&r);
        assert!(!ok);
        assert_eq!(lines, ["PASS: 描ける -- 640px", "FAIL: コピー -- x", "PASS: 保存した PNG の解像度 mitome 600.0", "ERROR: 時間切れ"]);
        assert!(report(&json!({"ok": true, "results": []})).1);
        assert!(!report(&json!({})).1, "結果の無いファイルは通らない");
    }
}
