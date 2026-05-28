#!/usr/bin/env bash
#
# 微记账本 (mycal) uninstaller — macOS / Linux
#
# Removes:
#   1. the per-user data directory (encrypted bills, budgets, registry)
#   2. the encryption keys stored in the system keychain / Secret Service
#
# It does NOT delete the app bundle / binary itself — drag 微记账本.app to the
# Trash (macOS) or delete the extracted folder (Linux) manually.
#
# Usage:
#   ./uninstall.sh          # interactive, asks for confirmation
#   ./uninstall.sh --yes    # skip confirmation (for automation)
#
set -euo pipefail

KEYRING_SERVICE="mycal"
ASSUME_YES=0
[[ "${1:-}" == "--yes" || "${1:-}" == "-y" ]] && ASSUME_YES=1

# ---- resolve data dir (mirrors mycal/paths.py) ----
resolve_data_dir() {
  if [[ -n "${MYCAL_DATA_DIR:-}" ]]; then
    echo "${MYCAL_DATA_DIR/#\~/$HOME}"; return
  fi
  case "$(uname -s)" in
    Darwin) echo "$HOME/Library/Application Support/mycal" ;;
    *)      echo "${XDG_DATA_HOME:-$HOME/.local/share}/mycal" ;;
  esac
}

DATA_DIR="$(resolve_data_dir)"

echo "微记账本 卸载"
echo "──────────────────────────────────────────────"
echo "将删除以下内容（不可恢复）："
echo
if [[ -d "$DATA_DIR" ]]; then
  echo "  • 数据目录: $DATA_DIR"
  du -sh "$DATA_DIR" 2>/dev/null | sed 's/^/      /' || true
else
  echo "  • 数据目录: $DATA_DIR （不存在，跳过）"
fi
echo "  • 系统钥匙串中 service=「$KEYRING_SERVICE」的全部密钥条目"
echo

if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "确认删除？输入大写 YES 继续: " ans
  [[ "$ans" == "YES" ]] || { echo "已取消。"; exit 0; }
fi

# ---- 1. data dir ----
if [[ -d "$DATA_DIR" ]]; then
  rm -rf "$DATA_DIR"
  echo "✓ 已删除数据目录"
else
  echo "· 数据目录不存在，跳过"
fi

# ---- 2. keychain / secret service ----
case "$(uname -s)" in
  Darwin)
    n=0
    # macOS stores one generic-password item per key; loop until none left.
    while security delete-generic-password -s "$KEYRING_SERVICE" >/dev/null 2>&1; do
      n=$((n+1))
    done
    echo "✓ 已删除 $n 个 macOS 钥匙串条目"
    ;;
  Linux)
    if command -v secret-tool >/dev/null 2>&1; then
      # best-effort: python keyring's SecretService backend stores items with
      # a "service" attribute. clear by that attribute.
      secret-tool clear service "$KEYRING_SERVICE" 2>/dev/null || true
      echo "✓ 已尝试清理 Secret Service（如有）"
    else
      echo "· 未找到 secret-tool；若用过桌面钥匙串，请在 seahorse/KWallet 中搜「$KEYRING_SERVICE」手动删除"
    fi
    echo "  （headless 环境的密钥文件已随数据目录一并删除）"
    ;;
esac

echo
echo "✓ 卸载完成。"
echo "  提示：app 本体请手动删除——"
case "$(uname -s)" in
  Darwin) echo "        将「应用程序」中的「微记账本.app」拖到废纸篓。" ;;
  *)      echo "        删除解压出来的 mycal 目录即可。" ;;
esac
