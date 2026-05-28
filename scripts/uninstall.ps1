# 微记账本 (mycal) uninstaller — Windows
#
# Removes the per-user data directory + credential-manager entries.
# Does NOT delete the extracted app folder — delete that manually.
#
# Usage (PowerShell):
#   .\uninstall.ps1           # interactive
#   .\uninstall.ps1 -Yes      # skip confirmation

param([switch]$Yes)

$ErrorActionPreference = "Stop"

$DataDir = if ($env:MYCAL_DATA_DIR) { $env:MYCAL_DATA_DIR } `
           else { Join-Path $env:LOCALAPPDATA "mycal" }

Write-Host "微记账本 卸载"
Write-Host "----------------------------------------------"
Write-Host "将删除以下内容（不可恢复）："
Write-Host ""
if (Test-Path $DataDir) {
    Write-Host "  - 数据目录: $DataDir"
} else {
    Write-Host "  - 数据目录: $DataDir （不存在，跳过）"
}
Write-Host "  - 凭据管理器中名称含「mycal」的通用凭据"
Write-Host ""

if (-not $Yes) {
    $ans = Read-Host "确认删除？输入大写 YES 继续"
    if ($ans -ne "YES") { Write-Host "已取消。"; exit 0 }
}

# 1. data dir
if (Test-Path $DataDir) {
    Remove-Item -Recurse -Force $DataDir
    Write-Host "[OK] 已删除数据目录"
} else {
    Write-Host "[--] 数据目录不存在，跳过"
}

# 2. credential manager — best effort via cmdkey
$creds = cmdkey /list | Select-String "mycal"
if ($creds) {
    foreach ($line in $creds) {
        if ($line -match "Target:\s*(.+mycal.+)") {
            cmdkey /delete:$($matches[1].Trim()) | Out-Null
        }
    }
    Write-Host "[OK] 已尝试清理凭据管理器条目"
} else {
    Write-Host "[--] 凭据管理器中未发现 mycal 条目"
}

Write-Host ""
Write-Host "[OK] 卸载完成。"
Write-Host "     提示：请手动删除解压出来的 mycal 程序文件夹。"
