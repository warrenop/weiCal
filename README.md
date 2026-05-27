# 微记账本 (mycal)

本地单机的微信账单可视化记账。pywebview 原生窗口 + FastAPI 后端（同进程线程内），数据 AES-256 加密存 SQLite (SQLCipher)，密钥放系统 Keychain / Credential Manager / Secret Service。**全程本地，零网络上传**。

> 包名 `mycal`（命令行 `python -m mycal`、内部模块、Keychain 条目都用这个）。
> 应用显示名「微记账本」。

---

## 平台兼容

| 平台 | 状态 | 说明 |
|---|---|---|
| macOS 12+ | ✅ 已验证 | Keychain 管钥匙；打包成 `.app`，双击即用 |
| Windows 10/11 | ✅ 支持 | Windows Credential Manager；打包成 `.exe`；用 EdgeWebView2 渲染 |
| Linux (GNOME/KDE) | ✅ 支持 | Secret Service；打包成单二进制；需要 webkit2gtk |
| iOS Safari | ✅ 浏览 | 通过 LAN 模式访问 Mac，可「添加到主屏幕」当 PWA |
| Android Chrome | ✅ 浏览 | 同上 |
| iOS / Android 离线 | ❌ | 本地 Python 服务跑不动，需要原生重写 |

---

## 三种运行模式

```
python -m mycal            # 默认：原生窗口（双击 .app 效果一致）
python -m mycal --server   # 只跑后端，绑 127.0.0.1:8765，不开窗口
python -m mycal --lan      # 只跑后端，绑 0.0.0.0:8765，打印 LAN URL 供手机访问
```

环境变量：`MYCAL_PORT`、`MYCAL_DATA_DIR`。

---

## 安装并运行（开发 / 未打包）

### macOS / Linux

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
python -m mycal
```

### Windows

```powershell
py -3 -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -e .
python -m mycal
```

---

## 打包成可分发的 App

PyInstaller spec 已写好：[`mycal.spec`](mycal.spec)。在**目标平台**上构建对应的产物。

```bash
pip install -e ".[build]"      # 装 pyinstaller
pyinstaller mycal.spec --noconfirm
```

产物：

| 平台 | 输出 |
|---|---|
| macOS | `dist/微记账本.app` (~36 MB)，可直接双击；也可 `create-dmg dist/微记账本.app` 打 .dmg |
| Windows | `dist/mycal/mycal.exe` 加同目录依赖；用 [Inno Setup](https://jrsoftware.org/isinfo.php) 打安装程序 |
| Linux | `dist/mycal/mycal` 单二进制；可用 `appimagetool` 打成 .AppImage |

> 跨平台构建：必须**在目标 OS 上各跑一次** PyInstaller。它打的是当前系统的原生二进制，不能交叉编译。Github Actions 跑 matrix 是常见做法。

### 添加自定义图标

把 SVG 转成对应格式：

```bash
# macOS: SVG → PNG → .icns
mkdir -p icon.iconset
for size in 16 32 64 128 256 512; do
  rsvg-convert -w $size -h $size web/logo.svg -o icon.iconset/icon_${size}x${size}.png
done
iconutil -c icns icon.iconset -o icon.icns
```

然后改 [`mycal.spec`](mycal.spec) 里的 `ICON_PATH = "icon.icns"`（Windows 用 `.ico`），重新 build。

---

## 手机端访问（LAN + PWA）

让 Mac 当后端、手机当浏览器，两端**同一 WiFi**。

```bash
python -m mycal --lan
```

终端会打印：

```
  微记账本  →  http://127.0.0.1:8765
  局域网    →  http://192.168.1.23:8765   ← 手机浏览器输入这个
```

- iOS Safari：分享 → **添加到主屏幕**，从此像 app 一样独立窗口打开
- Android Chrome：菜单 → **安装应用**，同上

> 数据**只在 Mac 上**，手机只是远程查看。Mac 关机/休眠手机就连不上。

---

## 数据存放位置

| OS | 路径 |
|---|---|
| macOS | `~/Library/Application Support/mycal/mycal.db` |
| Linux | `$XDG_DATA_HOME/mycal/mycal.db`（默认 `~/.local/share/mycal/`） |
| Windows | `%LOCALAPPDATA%\mycal\mycal.db` |

环境变量覆盖（多设备同步、外置盘等）：

```bash
export MYCAL_DATA_DIR="$HOME/Dropbox/mycal"
python -m mycal
```

- **备份**：复制 `mycal.db` 文件即可（同时 Keychain 里的密钥要在同一台机器上才能解开）
- **重置**：删 `mycal.db` 文件 → 下次启动自动重建空库；或网页调 `POST /api/admin/reset`

---

## 导入微信账单

1. 微信 → 我 → 服务 → 钱包 → 账单 → 常见问题 → 下载账单（按月申请）
2. 邮箱收到 zip，解压得到 `.csv` 或 `.xlsx`
3. 网页右上角「刷新数据」→ 选择文件 → 上传（按交易单号自动去重）

## 手动录入

「明细」页 → 「+ 新增一条」

---

## 项目结构

```
mycal/
├── pyproject.toml
├── mycal.spec                 # PyInstaller config
├── README.md
├── mycal/
│   ├── __main__.py           # 入口：原生窗口 / --server / --lan
│   ├── app.py                # FastAPI 装配
│   ├── db.py                 # SQLCipher + Keychain
│   ├── models.py             # Pydantic
│   ├── categorizer.py        # 关键字 → 分类
│   ├── importer.py           # CSV/xlsx 解析 + 去重
│   └── routes/               # transactions / summary / imports
└── web/                       # 前端：HTML + 原生 JS + ECharts
    ├── index.html
    ├── app.js
    ├── tour.js
    ├── styles.css
    ├── logo.svg / favicon.svg
    └── manifest.json
```
