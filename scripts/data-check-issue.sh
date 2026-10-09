#!/usr/bin/env bash
# 讀 sync 產生的 report.json，把要人看的地方同步成一張 issue（改寫自 g0v/AI-Monday 的同名腳本）：
#   有問題、沒有開著的 issue → 開一張
#   有問題、內容跟上次不同   → 改內文並留一則 comment（改內文不會通知 watcher，comment 才會）
#   有問題、內容跟上次相同   → 不動，免得每天洗版
#   沒問題、有開著的 issue   → 自動關閉
# 用 label 認「是不是那張」，不靠標題，所以人可以改標題。
#
# 本機試跑：DRY_RUN=1 GH_REPO=g0v/community-calendar bash scripts/data-check-issue.sh
set -euo pipefail

REPORT=${REPORT:-report.json}
LABEL='資料檢查'
SITE=${SITE_URL:-https://g0v.github.io/community-calendar}
run() { if [ -n "${DRY_RUN:-}" ]; then echo "[dry-run] $1 $2 $3"; printf '  ‹%s›\n' "${@:4}"; else "$@"; fi; }

jq -e '.counts and (.errors | type == "array") and (.warnings | type == "array")' "$REPORT" >/dev/null \
  || { echo "::error::$REPORT 不是檢查報告"; exit 1; }
errors=$(jq '.errors | length' "$REPORT")
warnings=$(jq '.warnings | length' "$REPORT")
total=$((errors + warnings))
existing=$(gh issue list --label "$LABEL" --state open --json number --jq '.[0].number // empty' 2>/dev/null || true)

if [ "$total" -eq 0 ]; then
  [ -n "$existing" ] && run gh issue close "$existing" --comment '最新一次檢查沒有問題了，自動關閉。'
  echo "✓ 沒有要看的地方"
  exit 0
fi

body=$(jq -r --arg site "$SITE" '
  def items: map("- **\(.where)**：\(.msg)" + (if .id then "（[看這筆](\($site)/events/\(.id)/)）" else "" end)) | join("\n");
  "[活動共筆](\(.source)) 與同步結果有 \((.errors | length) + (.warnings | length)) 個地方要人看一下。",
  "",
  "這張 issue 由每天台灣時間 04:30 的自動同步產生，**處理好之後下一次同步會自動關閉**，不用手動關。",
  (if (.errors | length) > 0 then
    "", "### 🔴 錯誤（\(.errors | length)）：資料停在上一版，處理好才會恢復更新", "", (.errors | items)
  else empty end),
  (if (.warnings | length) > 0 then
    "", "### 🟡 提醒（\(.warnings | length)）：資料照常更新", "", (.warnings | items)
  else empty end),
  "", "---",
  "「共筆第 N 行」指的是共筆原始 Markdown 的行號。揪松主辦的確認、下架、修正欄位都寫在 `overrides/`，見 README。"
' "$REPORT")
title="活動資料有 ${total} 個地方要看"
[ "$errors" -gt 0 ] && title="活動資料同步失敗，網站停在上一版（共 ${total} 個地方要看）"

if [ -z "$existing" ]; then
  run gh label create "$LABEL" --color D93F0B --description '活動資料自動檢查' --force
  run gh issue create --title "$title" --label "$LABEL" --body "$body"
elif [ "$(gh issue view "$existing" --json body --jq .body)" != "$body" ]; then
  run gh issue edit "$existing" --title "$title" --body "$body"
  run gh issue comment "$existing" --body "檢查結果有變動，現在共 ${total} 個地方要看（錯誤 ${errors}、提醒 ${warnings}），內文已更新。"
else
  echo "#$existing 內容沒變，不動"
fi
