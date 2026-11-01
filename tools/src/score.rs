//! 改良案の評価関数（決め方は CLAUDE.md の「改良するときは、別のエージェントが現物を撮って採点し、合格点以上の案に決める」）。
//!
//! ```text
//! cargo tools score tools/ui-proposals/比較.json
//! ```
//! 採点は、案を作った者ではない別のエージェントが付ける。採点する者は自分で画面を撮り（ui-variants.mjs・ui-check.mjs）、画像を直接見てから付ける。
//! 採点のファイル（JSON）:
//! ```text
//! {"title": "…", "rule": "2026-10-17", "evaluator": "だれが・どう撮って採点したか",
//!  "rounds": [{"name": "1 回目", "images": "…", "self_check": "案を作った者が渡す前に自分で確かめたこと",
//!              "proposals": {"A 案の名前": {"score": {"order": 8, …（11 項目。0〜10）}, "minus": [{"kind": "cut", "where": "…"}], "seen": "…"}},
//!              "baseline": {"今": {同じ形}}}, …],
//!  "built": {"name": "作った後", "images": "…", "result": {同じ形}}}
//! ```
//! "baseline" は比べるための今の画面（順位に入れない）。"built" は決めた案を作った後の本物の画面の採点。
//! "applies": "決めた採点のファイル名" … ほかの比較で決めた形を当てただけのとき（"rounds" は空。今と作った後だけを採点する）。
//! 案の値が 7 つの数の並び（list）のファイルは、旧い決まり（7 基準）の記録として読む（判定はしない）。
//!
//! 点: 加点（4 分類・11 項目を 0〜10・重みを掛けて 100 点満点）から、減点（見つけた所ごと）を引く。
//! 決め方: 1 回 5 案以上。1 位が合格点以上なら決める（同じ点なら重い分類の点が高い方）。合格点は回によらず 80 点（"rule": "2026-10-17"）。
//! 案を作った者は、採点に渡す前に自分で画像を見て確かめ、回の "self_check" に書く。"rule" が無いファイルは前の決まり（95・90・80 点）。
//! 届かなければ案出しからやり直す（新しい案 3 案以上）。3 回で届かなければ、いちばん高い案に決めて足りない点と理由を伝える。

use serde_json::Value;
use std::path::Path;

/// 加点（分類, 鍵, 名前, 重み）。並びは重い分類の順。
pub const CRITERIA: &[(&str, &str, &str, u32)] = &[
    ("わかりやすさ", "order", "順序（目と手が使う順に流れる）", 8),
    ("わかりやすさ", "chunk", "チャンク（まとまりが一目で分かれる）", 8),
    ("わかりやすさ", "hierarchy", "階層化（最初に見る物が 1 つ・主と従の差）", 8),
    ("わかりやすさ", "visual", "視覚化（数・状態を形・色・位置で見せる）", 8),
    ("使いやすさ", "steps", "ステップ数（目的までの手が少ない）", 10),
    ("使いやすさ", "effortless", "考えさせない（探させない・思い出させない・推測させない）", 10),
    ("使いやすさ", "intuitive", "直感的（見た目どおりに動く・慣れた型）", 10),
    ("統一感", "form", "形と色（同じ物は同じ形・同じ色）", 10),
    ("統一感", "place", "言葉と置き場（同じ物は同じ言葉・同じ場所）", 10),
    ("美しさ", "layout", "整列・余白・釣り合い", 9),
    ("美しさ", "tone", "色と文字の調子（色数・強弱・読みやすさ）", 9),
];
pub const GROUPS: &[&str] = &["わかりやすさ", "使いやすさ", "統一感", "美しさ"];

/// 減点（種類, 名前, 点）。1 か所ごとに引く。
pub const DEDUCTIONS: &[(&str, &str, u32)] = &[
    ("lost", "機能が消える・届かなくなる", 10),
    ("cut", "見切れ・はみ出し（字・ボタンが切れる、枠から出る）", 5),
    ("overlap", "重なり（部品・字が被る）", 5),
    ("wrap", "想定外の折り返し（1 段のはずが 2 段、ボタンの字が折れる）", 3),
    ("unreadable", "読みにくい字（11px 未満・コントラスト 4.5 未満の本文）", 3),
    ("scroll", "要らないスクロール（横に送る・二重のスクロール）", 3),
    ("hidden_state", "状態が見えない（何が効いているか・待っているか）", 3),
    ("more_steps", "前より手が増える（1 手ごと）", 2),
    ("color_only", "色だけで区別している", 2),
];

/// 決まり: 回ごとの合格点（最後の値が以降も続く）と、採点に渡す前の自分の確かめが要るか。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rule {
    pub pass: &'static [u32],
    pub self_check: bool,
}
pub const RULE_OLD: Rule = Rule { pass: &[95, 90, 80], self_check: false }; // "rule" が無いファイル
pub const RULE_NOW: Rule = Rule { pass: &[80], self_check: true }; // 2026-10-17: 回によらず 80 点・渡す前に自分で画像を見る
pub const CURRENT_RULE: &str = "2026-10-17";
pub const MIN_PROPOSALS: usize = 5;
pub const MIN_NEW: usize = 3;
pub const MAX_ROUNDS: usize = 3;
const LEGACY_WEIGHTS: [f64; 7] = [20.0, 15.0, 15.0, 15.0, 15.0, 10.0, 10.0];

fn deduction(kind: &str) -> Option<(&'static str, u32)> {
    DEDUCTIONS.iter().find(|(k, _, _)| *k == kind).map(|(_, n, p)| (*n, *p))
}

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/// 加点（100 点満点）
pub fn plus(entry: &Value) -> Result<f64, String> {
    let score = &entry["score"];
    let missing: Vec<&str> = CRITERIA.iter().map(|c| c.1).filter(|k| score.get(k).and_then(Value::as_f64).is_none()).collect();
    if !missing.is_empty() || CRITERIA.iter().any(|c| !(0.0..=10.0).contains(&score[c.1].as_f64().unwrap_or(-1.0))) {
        return Err(format!("加点は {} 項目を 0〜10 で（足りない: {missing:?}）: {score}", CRITERIA.len()));
    }
    Ok(CRITERIA.iter().map(|c| c.3 as f64 * score[c.1].as_f64().unwrap() / 10.0).sum())
}

/// 減点（見つけた所ごと）
pub fn minus(entry: &Value) -> Result<f64, String> {
    let mut total = 0;
    for m in entry["minus"].as_array().into_iter().flatten() {
        let kind = m["kind"].as_str().unwrap_or("");
        let (name, points) = deduction(kind)
            .ok_or(format!("減点の種類が無い: {kind}（{} のどれか）", DEDUCTIONS.iter().map(|d| d.0).collect::<Vec<_>>().join("・")))?;
        if m["where"].as_str().unwrap_or("").is_empty() {
            return Err(format!("減点「{name}」に、どの画像のどこで見たか（where）が無い"));
        }
        total += points;
    }
    Ok(total as f64)
}

/// 加点 − 減点（0〜100 点）。旧い決まりの記録（数の並び）は重みで足すだけ
pub fn total(entry: &Value) -> Result<f64, String> {
    if let Some(list) = entry.as_array() {
        return Ok(round1(LEGACY_WEIGHTS.iter().zip(list).map(|(w, s)| w * s.as_f64().unwrap_or(0.0) / 10.0).sum()));
    }
    Ok(round1((plus(entry)? - minus(entry)?).max(0.0)))
}

/// 分類ごとの加点（重い分類の順）。同じ点のときの並べ替えに使う
pub fn group_points(entry: &Value) -> Vec<f64> {
    if let Some(list) = entry.as_array() {
        return list.iter().map(|v| v.as_f64().unwrap_or(0.0)).collect();
    }
    GROUPS
        .iter()
        .map(|g| CRITERIA.iter().filter(|c| c.0 == *g).map(|c| c.3 as f64 * entry["score"][c.1].as_f64().unwrap_or(0.0) / 10.0).sum())
        .collect()
}

pub type Row = (f64, String, Value);

/// 高い順に（同じ点なら、重い分類の点が高い方。それも同じなら名前の順）
pub fn rank(proposals: &serde_json::Map<String, Value>) -> Result<Vec<Row>, String> {
    let mut rows: Vec<Row> = proposals.iter().map(|(n, e)| total(e).map(|t| (t, n.clone(), e.clone()))).collect::<Result<_, _>>()?;
    rows.sort_by(|a, b| {
        b.0.partial_cmp(&a.0)
            .unwrap()
            .then_with(|| {
                let (ga, gb) = (group_points(&a.2), group_points(&b.2));
                gb.partial_cmp(&ga).unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| a.1.cmp(&b.1))
    });
    Ok(rows)
}

/// ファイルの決まり（"rule" が無ければ前の決まり）
pub fn rule_of(data: &Value) -> Result<Rule, String> {
    match data.get("rule").and_then(Value::as_str) {
        None => Ok(RULE_OLD),
        Some(CURRENT_RULE) => Ok(RULE_NOW),
        Some("2026-10") => Ok(RULE_OLD),
        Some(other) => Err(format!("決まりの名前が無い: {other}（2026-10・{CURRENT_RULE} のどれか）")),
    }
}

/// i 回目（0 から）の合格点
pub fn pass_mark(i: usize, rule: Rule) -> u32 {
    rule.pass[i.min(rule.pass.len() - 1)]
}

/// 回の組み方が決まりどおりか（違えば理由の文）。before: 前の回までに出た案の名前
fn check_round(i: usize, rnd: &Value, before: &[String], rule: Rule) -> Option<String> {
    let proposals = rnd["proposals"].as_object().cloned().unwrap_or_default();
    if proposals.len() < MIN_PROPOSALS {
        return Some(format!("案は {MIN_PROPOSALS} 案以上（いま {} 案）", proposals.len()));
    }
    let blind: Vec<&String> = proposals.iter().filter(|(_, e)| e["seen"].as_str().unwrap_or("").is_empty()).map(|(n, _)| n).collect();
    if !blind.is_empty() {
        return Some(format!("画像で見えたこと（seen）が無い案: {}", blind.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("・")));
    }
    if rule.self_check && rnd["self_check"].as_str().unwrap_or("").trim().is_empty() {
        return Some("採点に渡す前に、案を作った者が自分で画像を見て確かめたこと（self_check）が無い".into());
    }
    let new = proposals.keys().filter(|n| !before.contains(n)).count();
    if i > 0 && new < MIN_NEW {
        return Some(format!("やり直しの回は、案出しからやり直す（新しい案を {MIN_NEW} 案以上。いま {new} 案）"));
    }
    None
}

/// 回を順に判定する。→ ("選ぶ" | "届かずに選ぶ" | "出し直す" | "記録" | "当てた" | "直す", 名前, 順位)
pub fn decide(data: &Value) -> Result<(&'static str, String, Vec<Row>), String> {
    if let Some(applies) = data.get("applies").and_then(Value::as_str) {
        let built = &data["built"];
        let t = if built["result"].is_object() { total(&built["result"])? } else { 0.0 };
        let mark = *rule_of(data)?.pass.last().unwrap() as f64;
        let kind = if t >= mark { "当てた" } else { "直す" };
        return Ok((kind, applies.to_string(), vec![(t, built["name"].as_str().unwrap_or("").to_string(), built["result"].clone())]));
    }
    let rounds = data["rounds"].as_array().cloned().unwrap_or_default();
    if rounds.iter().any(|r| r["proposals"].as_object().is_some_and(|p| p.values().any(Value::is_array))) {
        let rows = rank(rounds.last().unwrap()["proposals"].as_object().unwrap())?;
        return Ok(("記録", rows[0].1.clone(), rows));
    }
    if data["evaluator"].as_str().unwrap_or("").is_empty() {
        return Err("採点した者（evaluator）が無い。採点は、案を作った者ではない別のエージェントが、自分で撮った画像を見て付ける".into());
    }
    if rounds.len() > MAX_ROUNDS {
        return Err(format!("回は {MAX_ROUNDS} 回まで（{MAX_ROUNDS} 回目で必ず決める。いま {} 回）", rounds.len()));
    }
    let rule = rule_of(data)?;
    let mut before: Vec<String> = vec![];
    let mut last = vec![];
    for (i, rnd) in rounds.iter().enumerate() {
        let name = rnd["name"].as_str().unwrap_or("");
        if let Some(problem) = check_round(i, rnd, &before, rule) {
            return Err(format!("{name}: {problem}"));
        }
        let rows = rank(rnd["proposals"].as_object().unwrap())?;
        if rows[0].0 >= pass_mark(i, rule) as f64 {
            if i < rounds.len() - 1 {
                return Err(format!("{name} で {} 点に届いて決まっているのに、後の回がある", pass_mark(i, rule)));
            }
            return Ok(("選ぶ", rows[0].1.clone(), rows));
        }
        if i == MAX_ROUNDS - 1 {
            return Ok(("届かずに選ぶ", rows[0].1.clone(), rows));
        }
        before.extend(rnd["proposals"].as_object().unwrap().keys().cloned());
        last = rows;
    }
    let who = last.first().map(|r| r.1.clone()).unwrap_or_default();
    Ok(("出し直す", who, last))
}

/// 1 案の点の内訳（分類ごとの加点と減点）
pub fn describe(entry: &Value) -> String {
    if entry.is_array() {
        return entry.to_string();
    }
    let parts: Vec<String> = GROUPS.iter().zip(group_points(entry)).map(|(g, p)| format!("{g} {p:.1}")).collect();
    let cuts: Vec<String> = entry["minus"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let (name, points) = deduction(m["kind"].as_str()?)?;
            Some(format!("{} −{points}（{}）", name.split('（').next().unwrap_or(name), m["where"].as_str().unwrap_or("")))
        })
        .collect();
    format!("{}{}", parts.join("・"), if cuts.is_empty() { String::new() } else { format!("／減点: {}", cuts.join("、")) })
}

fn s(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}

/// 判定と内訳を出す（file: 採点のファイル。applies の元を同じフォルダから読む）
pub fn report(file: &Path, data: &Value) -> Result<String, String> {
    let mut o = vec![format!("# {}", s(&data["title"]))];
    if data.get("applies").is_some() {
        return report_applied(file, data, o);
    }
    let (kind, who, rows) = decide(data)?;
    if kind == "記録" {
        o.push("（旧い決まり〈7 基準・80 点・7 案〉の記録。いまの決まりでは判定しない）".into());
        o.extend(rows.iter().map(|(t, n, _)| format!("  {n:16} {t:5.1}")));
        o.push(format!("→ 記録の 1 位: {who}"));
        return Ok(o.join("\n"));
    }
    o.push(format!("採点: {}", s(&data["evaluator"])));
    let rule = rule_of(data)?;
    let when = if rule.pass.len() == 1 {
        format!("回によらず {}", rule.pass[0])
    } else {
        format!(
            "{} 点（以降も {}）",
            rule.pass.iter().enumerate().map(|(i, p)| format!("{} 回目 {p}", i + 1)).collect::<Vec<_>>().join("・"),
            rule.pass.last().unwrap()
        )
    };
    o.push(format!(
        "決めてよい点 {when} 点・1 回 {MIN_PROPOSALS} 案以上・{MAX_ROUNDS} 回まで{}",
        if rule.self_check { "・渡す前に自分で画像を確かめる" } else { "（前の決まり）" }
    ));
    let rounds = data["rounds"].as_array().cloned().unwrap_or_default();
    let mark = pass_mark(rounds.len().saturating_sub(1), rule);
    for rnd in &rounds {
        let n = rnd["proposals"].as_object().map(|p| p.len()).unwrap_or(0);
        o.push(format!(
            "== {}（{n} 案）{}",
            s(&rnd["name"]),
            if s(&rnd["images"]).is_empty() { String::new() } else { format!("  画像: {}", s(&rnd["images"])) }
        ));
        if !s(&rnd["self_check"]).is_empty() {
            o.push(format!("  渡す前の自分の確かめ: {}", s(&rnd["self_check"])));
        }
        for (t, name, e) in rank(rnd["proposals"].as_object().unwrap())? {
            o.push(format!("  {name}\n      {t:5.1} 点  {}\n      見えたこと: {}", describe(&e), s(&e["seen"])));
        }
        for (name, e) in rnd["baseline"].as_object().into_iter().flatten() {
            o.push(format!("  （{name}）\n      {:5.1} 点  {}\n      見えたこと: {}", total(e)?, describe(e), s(&e["seen"])));
        }
    }
    let top = rows.first().map(|r| r.0).unwrap_or(0.0);
    match kind {
        "選ぶ" => o.push(format!("→ 選ぶ: {who}（{top:.1} 点）")),
        "届かずに選ぶ" => o.push(format!(
            "→ {MAX_ROUNDS} 回で合格点 {mark} 点に届かなかった。いちばん高い {who}（{top:.1} 点）に決め、足りない {:.1} 点とその理由（減点・低い項目）を利用者に伝える",
            mark as f64 - top
        )),
        _ => o.push(format!(
            "→ まだ選ばない（1 位 {top:.1} 点 < この回の合格点 {mark} 点。次の回は {} 点）。低い項目と減点を見直し、案出しからやり直す\
             （{MIN_PROPOSALS} 案以上・新しい案 {MIN_NEW} 案以上）。採点はまた別のエージェントが、撮り直した画像で付ける",
            pass_mark(rounds.len(), rule)
        )),
    }
    if let Some(built) = data.get("built").filter(|b| b["result"].is_object()) {
        let t = total(&built["result"])?;
        o.push(format!(
            "== {}（作った後の本物の画面）  {t:.1} 点  {}\n      見えたこと: {}",
            s(&built["name"]),
            describe(&built["result"]),
            s(&built["result"]["seen"])
        ));
        o.push(if t >= mark as f64 {
            format!("→ 作った後も {mark} 点以上（決めた回の合格点）")
        } else {
            format!("→ 作った後も {mark} 点（決めた回の合格点）に届かない。減点の所を直して撮り直し、採点し直す")
        });
    }
    Ok(o.join("\n"))
}

/// ほかの比較で決めた形を当てた記録: 決めたファイルの判定を引き、今と作った後だけを採点する
fn report_applied(file: &Path, data: &Value, mut o: Vec<String>) -> Result<String, String> {
    if s(&data["evaluator"]).is_empty() {
        return Err("採点した者（evaluator）が無い".into());
    }
    let src = file.parent().unwrap_or(Path::new(".")).join(s(&data["applies"]));
    let (kind, who, rows) = decide(&crate::repo::read_json(&src)?)?;
    if kind != "選ぶ" && kind != "届かずに選ぶ" {
        return Err(format!("{} はまだ決まっていない（{kind}）", s(&data["applies"])));
    }
    o.push(format!("採点: {}\n当てた形: {} で決めた {who}（{:.1} 点）", s(&data["evaluator"]), s(&data["applies"]), rows[0].0));
    let mark = *rule_of(data)?.pass.last().unwrap();
    for (name, e) in data["baseline"].as_object().into_iter().flatten() {
        o.push(format!("  （{name}）\n      {:5.1} 点  {}\n      見えたこと: {}", total(e)?, describe(e), s(&e["seen"])));
    }
    let built = data.get("built").filter(|b| b["result"].is_object()).ok_or("作った後（built）が無い")?;
    let t = total(&built["result"])?;
    o.push(format!(
        "== {}（作った後の本物の画面）  {t:.1} 点  {}\n      見えたこと: {}",
        s(&built["name"]),
        describe(&built["result"]),
        s(&built["result"]["seen"])
    ));
    o.push(if t >= mark as f64 {
        format!("→ 作った後も {mark} 点以上")
    } else {
        format!("→ 作った後も {mark} 点に届かない。減点の所を直して撮り直し、採点し直す")
    });
    Ok(o.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 全項目 n 点（over で項目ごとに変える）・減点の種類の並び
    fn entry(n: f64, minus: &[&str], over: &[(&str, f64)]) -> Value {
        let score: serde_json::Map<String, Value> =
            CRITERIA.iter().map(|c| (c.1.to_string(), json!(over.iter().find(|o| o.0 == c.1).map(|o| o.1).unwrap_or(n)))).collect();
        json!({"score": score, "minus": minus.iter().map(|k| json!({"kind": k, "where": "画像のどこか"})).collect::<Vec<_>>(), "seen": "見えたこと"})
    }
    fn e(n: f64) -> Value {
        entry(n, &[], &[])
    }
    fn round(name: &str, entries: &[Value], names: &[&str]) -> Value {
        let p: serde_json::Map<String, Value> = entries.iter().enumerate().map(|(i, e)| (names[i].to_string(), e.clone())).collect();
        json!({"name": name, "proposals": p, "self_check": "撮った画像を自分で見て、切れ・重なりを直した"})
    }
    const ABC: &[&str] = &["A", "B", "C", "D", "E", "F", "G"];
    fn data(rounds: &[Value]) -> Value {
        json!({"title": "試し", "rule": CURRENT_RULE, "evaluator": "別のエージェント", "rounds": rounds})
    }
    /// 前の決まり（"rule" が無いファイル。1 回目 95・2 回目 90・3 回目から 80 点）
    fn old(rounds: &[Value]) -> Value {
        let mut d = data(rounds);
        d.as_object_mut().unwrap().remove("rule");
        d
    }
    fn kind(d: &Value) -> &'static str {
        decide(d).unwrap().0
    }
    fn who(d: &Value) -> String {
        decide(d).unwrap().1
    }

    #[test]
    fn points() {
        assert_eq!(CRITERIA.iter().map(|c| c.3).sum::<u32>(), 100, "加点は 100 点満点");
        assert_eq!(GROUPS, ["わかりやすさ", "使いやすさ", "統一感", "美しさ"], "CLAUDE.md の 4 分類");
        assert_eq!(
            (RULE_NOW.pass, MIN_PROPOSALS, MIN_NEW, MAX_ROUNDS),
            (&[80u32][..], 5, 3, 3),
            "CLAUDE.md の合格点（回によらず 80）・5 案以上・新しい案 3 案・3 回"
        );
        assert_eq!((0..5).map(|i| pass_mark(i, RULE_NOW)).collect::<Vec<_>>(), [80; 5], "どの回も 80 点");
        assert_eq!((0..5).map(|i| pass_mark(i, RULE_OLD)).collect::<Vec<_>>(), [95, 90, 80, 80, 80], "前の決まり: 3 回目から先は 80 点");
        assert_eq!(total(&e(10.0)).unwrap(), 100.0);
        assert_eq!(total(&entry(10.0, &["cut", "wrap"], &[])).unwrap(), 92.0, "見切れ −5・折り返し −3");
        assert_eq!(total(&entry(0.0, &["lost"], &[])).unwrap(), 0.0, "0 点より下にはしない");
        assert!(total(&json!({"score": {"order": 5}})).unwrap_err().contains("11 項目"));
        assert!(total(&json!({"score": e(9.0)["score"], "minus": [{"kind": "cut"}]})).unwrap_err().contains("where"));
        assert!(total(&json!({"score": e(9.0)["score"], "minus": [{"kind": "ugly", "where": "x"}]})).unwrap_err().contains("減点の種類"));
    }

    #[test]
    fn winner_at_80_is_chosen_in_any_round() {
        let d = data(&[round("1 回目", &[e(7.0), e(8.0), e(6.0), e(5.0), e(4.0)], ABC)]);
        assert_eq!((kind(&d), who(&d).as_str()), ("選ぶ", "B"), "1 回目でも 80 点で決める");
        let one = round("1 回目", &[e(7.0), entry(7.0, &[], &[("form", 9.0)]), e(6.0), e(5.0), e(4.0)], ABC);
        assert_eq!(kind(&data(&[one])), "出し直す", "79 点では決めない");
        let two = data(&[
            round("1 回目", &[e(8.0), e(7.0), e(6.0), e(5.0), e(4.0)], ABC),
            round("2 回目", &[e(9.0), e(8.0), e(7.0), e(6.0), e(5.0)], &["V", "W", "X", "Y", "Z"]),
        ]);
        assert!(decide(&two).unwrap_err().contains("80 点に届いて決まっている"));
    }

    /// いまの決まり: 採点に渡す前に、案を作った者が自分で画像を確かめたこと（self_check）が要る。前の決まりの記録には要らない
    #[test]
    fn self_check_before_scoring() {
        let mut r = round("1 回目", &[e(9.0), e(8.0), e(7.0), e(6.0), e(5.0)], ABC);
        r.as_object_mut().unwrap().remove("self_check");
        assert!(decide(&data(std::slice::from_ref(&r))).unwrap_err().contains("self_check"));
        assert_eq!(kind(&old(std::slice::from_ref(&r))), "出し直す", "前の決まりは 95 点");
        let mut bad = data(&[r]);
        bad["rule"] = json!("なし");
        assert!(decide(&bad).unwrap_err().contains("決まりの名前"));
    }

    #[test]
    fn old_rule_below_95_starts_over_with_new_proposals() {
        let one = round("1 回目", &[e(9.0), e(8.0), e(7.0), e(6.0), e(5.0)], ABC);
        let d = old(std::slice::from_ref(&one));
        assert_eq!((kind(&d), who(&d).as_str()), ("出し直す", "A"), "前の決まりでは 90 点では決めない");
        // やり直しは新しい案を 3 案以上。前の案を 3 案持ち越して新しい案が 2 案では足りない
        let two = round("2 回目", &[e(9.0), e(8.0), e(7.0), e(10.0), e(9.0)], &["A", "B", "C", "X", "Y"]);
        assert!(decide(&old(&[one.clone(), two])).unwrap_err().contains("新しい案を 3 案以上"));
        let two = round("2 回目", &[e(9.0), e(10.0), e(9.0), e(8.0), e(7.0)], &["A", "X", "Y", "Z", "W"]);
        let d = old(&[one, two]);
        assert_eq!((kind(&d), who(&d).as_str()), ("選ぶ", "X"));
    }

    /// 前の決まり: 合格点は回で下がる（1 回目 95 点・2 回目 90 点・3 回目 80 点）
    #[test]
    fn old_rule_pass_mark_eases_by_round() {
        let one = round("1 回目", &[e(9.0), e(8.0), e(7.0), e(6.0), e(5.0)], ABC);
        let names = ["A", "V", "W", "X", "Y"];
        let two = round("2 回目", &[e(8.0), e(9.0), e(7.0), e(6.0), e(5.0)], &names);
        let d = old(&[one.clone(), two]);
        assert_eq!((kind(&d), who(&d).as_str()), ("選ぶ", "V"), "2 回目は 90 点で決める（1 回目なら決めない点）");
        let two = round("2 回目", &[e(8.0), entry(8.0, &[], &[("form", 9.0)]), e(7.0), e(6.0), e(5.0)], &names);
        assert_eq!(kind(&old(&[one.clone(), two.clone()])), "出し直す", "2 回目の 89 点では決めない");
        let three = round("3 回目", &[e(8.0), e(7.0), e(7.0), e(6.0), e(5.0)], &["P", "Q", "R", "S", "T"]);
        let d = old(&[one.clone(), two, three.clone()]);
        assert_eq!((kind(&d), who(&d).as_str()), ("選ぶ", "P"), "3 回目は 80 点で決める");
        let early = round("2 回目", &[e(9.0), e(8.0), e(7.0), e(6.0), e(5.0)], &names);
        assert!(decide(&old(&[one, early, three])).unwrap_err().contains("90 点に届いて決まっている"));
    }

    #[test]
    fn third_round_decides_even_below_the_mark() {
        let r: Vec<Value> = (0..3)
            .map(|i| {
                let names: Vec<String> = "ABCDE".chars().map(|c| format!("{i}{c}")).collect();
                let refs: Vec<&str> = names.iter().map(String::as_str).collect();
                round(&format!("{} 回目", i + 1), &[e(7.0), e(6.0), e(6.0), e(5.0), e(4.0)], &refs)
            })
            .collect();
        let d = data(&r);
        assert_eq!((kind(&d), who(&d).as_str()), ("届かずに選ぶ", "2A"), "3 回で届かなければ 1 位に決め、足りない点を伝える");
        let mut four = r[..2].to_vec();
        four.push(round("3 回目", &[e(7.0), e(6.0), e(6.0), e(5.0), e(4.0)], &["V", "W", "X", "Y", "Z"]));
        four.push(round("4 回目", &[e(10.0), e(9.0), e(9.0), e(9.0), e(9.0)], &["P", "Q", "R", "S", "T"]));
        assert!(decide(&data(&four)).unwrap_err().contains("3 回まで"));
    }

    #[test]
    fn ties_go_to_the_heavier_group() {
        // どちらも 98 点: A は統一感を、B は使いやすさを 2 点落とす（使いやすさの方が重い分類）
        let a = entry(10.0, &[], &[("form", 8.0)]);
        let b = entry(10.0, &[], &[("steps", 8.0)]);
        assert_eq!(total(&a).unwrap(), total(&b).unwrap());
        assert_eq!(who(&data(&[round("1 回目", &[b, a, e(5.0), e(5.0), e(5.0)], &["B", "A", "C", "D", "E"])])), "A");
    }

    #[test]
    fn rules() {
        assert!(decide(&data(&[round("1 回目", &[e(10.0), e(9.0)], ABC)])).unwrap_err().contains("5 案以上"));
        let mut blind = round("1 回目", &[e(10.0), e(9.0), e(8.0), e(7.0), e(6.0)], ABC);
        blind["proposals"]["C"].as_object_mut().unwrap().remove("seen");
        assert!(decide(&data(&[blind])).unwrap_err().contains("seen"));
        let mut nobody = data(&[round("1 回目", &[e(10.0), e(9.0), e(8.0), e(7.0), e(6.0)], ABC)]);
        nobody.as_object_mut().unwrap().remove("evaluator");
        assert!(decide(&nobody).unwrap_err().contains("別のエージェント"));
    }

    /// ほかの比較で決めた形を当てた記録（applies）: 作った後が 80 点以上なら「当てた」、届かなければ「直す」
    #[test]
    fn applied_record() {
        let good = e(9.0)["score"].clone();
        let mut d = json!({"title": "t", "rule": CURRENT_RULE, "evaluator": "e", "applies": "x.json", "rounds": [],
                           "built": {"name": "作った後", "result": {"score": good, "seen": "s"}}});
        assert_eq!(kind(&d), "当てた");
        d["built"]["result"]["minus"] =
            json!([{"kind": "cut", "where": "w"}, {"kind": "cut", "where": "w"}, {"kind": "cut", "where": "w"}]);
        assert_eq!(kind(&d), "直す");
    }

    /// これまでの採点のファイル（旧い決まりの記録も）がすべて読める
    #[test]
    fn records_in_the_repo_are_read() {
        let dir = crate::repo::root().join("tools").join("ui-proposals");
        let mut n = 0;
        for f in std::fs::read_dir(&dir).unwrap().flatten() {
            let p = f.path();
            if p.extension().is_some_and(|x| x == "json") {
                let d = crate::repo::read_json(&p).unwrap();
                let k = decide(&d).unwrap_or_else(|e| panic!("{}: {e}", p.display())).0;
                assert!(["記録", "選ぶ", "届かずに選ぶ", "出し直す", "当てた"].contains(&k), "{}", p.display());
                report(&p, &d).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
                n += 1;
            }
        }
        assert!(n >= 5, "採点のファイル {n} 個");
    }
}
