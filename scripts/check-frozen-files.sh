#!/bin/bash
# 检查暂存的文件中是否有被冻结保护的文件
# 冻结清单: .trae/frozen-files.yaml
# 如果有冻结文件被暂存，拒绝提交

set -uo pipefail

# 获取项目根目录
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")
FROZEN_YAML="$ROOT/.trae/frozen-files.yaml"
FROZEN_JSON="$ROOT/.trae/frozen-files.json"

# 没有冻结配置，直接通过
if [ ! -f "$FROZEN_YAML" ] && [ ! -f "$FROZEN_JSON" ]; then
  exit 0
fi

# 获取暂存文件列表
STAGED=$(git diff --cached --name-only 2>/dev/null || echo "")
if [ -z "$STAGED" ]; then
  exit 0
fi

# glob 转正则（与 freeze-guard.sh 中相同逻辑）
glob_to_regex() {
  local pattern="$1"
  local regex=""
  local i=0
  local len=${#pattern}
  while [ $i -lt $len ]; do
    local char="${pattern:$i:1}"
    case "$char" in
      '*')
        local next_char="${pattern:$((i+1)):1}"
        if [ "$next_char" = "*" ]; then
          regex="${regex}.*"
          i=$((i+1))
        else
          regex="${regex}[^/]*"
        fi
        ;;
      '?') regex="${regex}[^/]" ;;
      '.') regex="${regex}\." ;;
      '/') regex="${regex}/" ;;
      '+'|'('|')'|'{'|'}'|'^'|'$'|'|'|'\\'|'['|']') regex="${regex}\\${char}" ;;
      *) regex="${regex}${char}" ;;
    esac
    i=$((i+1))
  done
  printf '%s' "^${regex}$"
}

# 读取冻结规则
FROZEN_RULES=""
if [ -f "$FROZEN_YAML" ]; then
  FROZEN_RULES=$(node --input-type=module - "$FROZEN_YAML" <<'NODE'
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const filePath = process.argv[2];
const data = parse(readFileSync(filePath, "utf8")) ?? {};
for (const item of data.frozen ?? []) {
  const path = item.path ?? "";
  const test = item.testPath ?? "";
  console.log(`${path}\t${test}`);
}
NODE
)
  if [ $? -ne 0 ]; then
    echo "冻结文件保护: 无法解析 $FROZEN_YAML，拒绝提交。" >&2
    exit 1
  fi
elif [ -f "$FROZEN_JSON" ]; then
  FROZEN_RULES=$(jq -r '.frozen[]? | [.path // "", .testPath // ""] | @tsv' "$FROZEN_JSON" 2>/dev/null || echo "")
fi

if [ -z "$FROZEN_RULES" ]; then
  exit 0
fi

# 检查每个暂存文件
VIOLATIONS=""
while IFS= read -r staged_file; do
  [ -z "$staged_file" ] && continue

  while IFS=$'\t' read -r src_pattern test_pattern; do
    [ -z "$src_pattern" ] && [ -z "$test_pattern" ] && continue

    for pattern in "$src_pattern" "$test_pattern"; do
      [ -z "$pattern" ] && continue
      regex=$(glob_to_regex "$pattern")
      if printf '%s' "$staged_file" | grep -qE "$regex" 2>/dev/null; then
        if [ -n "$VIOLATIONS" ]; then
          VIOLATIONS="$VIOLATIONS\n  $staged_file (matches: $pattern)"
        else
          VIOLATIONS="  $staged_file (matches: $pattern)"
        fi
        break
      fi
    done
  done <<< "$FROZEN_RULES"
done <<< "$STAGED"

if [ -n "$VIOLATIONS" ]; then
  echo ""
  echo "❌ 冻结文件保护: 以下被冻结的文件出现在暂存区，禁止提交:"
  printf '%b\n' "$VIOLATIONS"
  echo ""
  echo "如需提交，请先手动编辑 .trae/frozen-files.yaml 移除对应条目。"
  echo ""
  exit 1
fi

exit 0
