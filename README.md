# 微记账本 (mycal)

[![Release](https://img.shields.io/github/v/release/warrenop/weiCal?label=release&color=ec4899)](https://github.com/warrenop/weiCal/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/warrenop/weiCal/release.yml?label=build)](https://github.com/warrenop/weiCal/actions/workflows/release.yml)
[![License](https://img.shields.io/github/license/warrenop/weiCal?color=violet)](LICENSE)

本地单机的微信账单可视化记账。pywebview 原生窗口 + FastAPI（同进程线程内），数据 AES-256 加密存 SQLite (SQLCipher)，密钥放系统 Keychain / Credential Manager / Secret Service。**全程本地，零网络上传**。

> 包名 `mycal`，应用显示名「微记账本」。

---

## 下载

普通用户**不用装 Python，直接下载用**：

| 平台 | 下载 | 安装 |
|---|---|---|
| **macOS** (Apple Silicon) | [weiCal-macos-arm64.zip](https://github.com/warrenop/weiCal/releases/latest/download/weiCal-macos-arm64.zip) | 解压 → 拖「微记账本.app」到「应用程序」→ **首次右键 → 打开**（绕过 Gatekeeper） |
| **Windows 10/11** | [weiCal-windows-x64.zip](https://github.com/warrenop/weiCal/releases/latest/download/weiCal-windows-x64.zip) | 解压到任意目录 → 双击 `mycal.exe` → Defender 弹窗选「仍要运行」 |
| **Linux** | 暂未稳定 | 见 [本地构建](#本地构建可分发-app) |
| **macOS** (Intel) | 暂未发布 | 见 [本地构建](#本地构建可分发-app) |

> 首次打开会自动在 `~/Library/Application Support/mycal/`（macOS）创建加密数据库，密钥写入 Keychain。

---

## 截图

### 首次启动 · 欢迎引导

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/02-welcome-dark.png">
  <img src="docs/screenshots/01-welcome-light.png" alt="Welcome screen">
</picture>

### 总览 · 深浅双主题

| Light | Dark |
|---|---|
| ![Overview Light](docs/screenshots/04-overview-light.png) | ![Overview Dark](docs/screenshots/03-overview-dark.png) |

### 分类 · 玫瑰图

![Categories rose chart](docs/screenshots/06-categories-light.png)

### 收入 · 月度现金流

![Income cashflow](docs/screenshots/05-income-light.png)

### 引导导览（首次启动自动触发，「?」按钮可重新开启）

![Tour spotlight](docs/screenshots/07-tour-spotlight.png)

### 多文档（多账户）— 个人 / 家庭 / 工作各一份独立加密库

| 下拉切换 | 集中管理 |
|---|---|
| ![Doc switcher](docs/screenshots/13-doc-switcher.png) | ![Doc manage](docs/screenshots/14-doc-manage.png) |

### 应用内更新提示（启动时检查 Github Releases，每 24h 一次）

![Update notifier](docs/screenshots/08-update-toast.png)

### 预算 / 提醒（按分类设月预算，超 70% 黄、超 100% 红）

![Budgets](docs/screenshots/10-budgets.png)

总览页本月支出 KPI 下方自动浮一个超支徽章，点击直达预算页：

![Overview with budget alert](docs/screenshots/09-overview-with-budget-alert.png)

### 预算按月覆盖（旅行 / 应酬月单独调高，不影响默认）

支持「默认（每月生效）」+「仅某月覆盖」两个独立的预算层。卡片底部「本月覆盖」紫色 pill + 「默认 ¥X / 撤销本月覆盖」副行：

| 预算页带覆盖 | 编辑弹窗 |
|---|---|
| ![Budgets with override](docs/screenshots/11-budgets-override.png) | ![Budget edit modal](docs/screenshots/12-budget-edit-modal.png) |

---

## 功能

- **微信 + 支付宝账单导入**：CSV / xlsx 上传**自动识别来源**，按交易号去重，关键字自动分类（餐饮 / 交通 / 购物 / 生活缴费 / 娱乐 / 医疗 / 教育 / 转账 / 理财 / 收入 / 其它）。支付宝额外利用「交易来源地」提升分类准确度，自动跳过「不计收支」和未完成交易
- **多文档支持**：一台 mycal 内开任意多本账（个人/家庭/工作/夫妻分账…），每本**独立加密库 + 独立 Keychain 密钥**。头部下拉一秒切换
- **6 个视图**：总览 / 明细 / 分类 / **预算** / 收入 / 导入历史
- **预算管理**：按分类（含总预算）设月度默认上限 + 单月覆盖（旅行月调高不影响其它月），超 70% 黄色提醒，超 100% 红色超支提醒；总览页自动浮徽章
- **可视化**：KPI 卡片 + 每日柱图 + 分类环形图 + Top 商户 + 月度现金流 + 收入来源玫瑰图
- **手动录入**：现金 / 其它支付方式手动加条目
- **查询**：按年 / 月 / 日 / 分类 / 方向 / 关键字筛选
- **深浅模式**：跟随系统 + 手动切换
- **5 步引导导览**：右上角「?」按钮触发
- **三层空态设计**：首次启动欢迎页 / 期内空 / 视图内空
- **加密 + Keychain**：AES-256，密钥由 OS 钥匙串保管，无密码 prompt 体验

---

## 数据 / 隐私

- 数据存系统标准应用数据目录，**与代码仓完全独立**
- AES-256 加密，密钥放系统钥匙串
- 默认监听 `127.0.0.1` 随机端口，对外不可见
- 零网络上传，零第三方 SDK

| OS | 路径 |
|---|---|
| macOS | `~/Library/Application Support/mycal/{documents.json, *.db}` |
| Linux | `$XDG_DATA_HOME/mycal/{documents.json, *.db}`（默认 `~/.local/share/mycal/`） |
| Windows | `%LOCALAPPDATA%\mycal\{documents.json, *.db}` |

> 0.6.0 起每个**文档**对应一个独立 `<id>.db` 文件 + 一个 Keychain key。`documents.json` 是注册表（id / name / file 映射）。升级老用户时旧 `mycal.db` 会自动迁移成名为「默认」的文档。

环境变量 `MYCAL_DATA_DIR` 可覆盖（多设备同步、外置盘等）：

```bash
export MYCAL_DATA_DIR="$HOME/Dropbox/mycal"
```

- **备份**：复制 `mycal.db` 即可（同时 Keychain 里的密钥要在同一台机器上才能解开）
- **重置**：删 `mycal.db` 文件 → 下次启动自动重建空库；或调 `POST /api/admin/reset`

---

## 导入账单（微信 / 支付宝）

上传时**自动识别来源**，无需手动选择。

- **微信**：我 → 服务 → 钱包 → 账单 → 常见问题 → **下载账单**（按月申请）
- **支付宝**：我 → 账单 → 右上角 ⚙️ → 开具交易流水证明 → **用于个人对账**

邮件收到 zip → 解压得到 `.csv` 或 `.xlsx` → 应用右上角「刷新数据」→ 选择文件 → 上传。

按交易号自动去重，反复上传同一文件也没事。支付宝的「不计收支」（账户间转移）和未完成交易会自动跳过。

---

## 手机端访问（LAN + PWA）

让 Mac 当后端、手机当浏览器（**同一 WiFi**）。

终端启动：

```bash
python -m mycal --lan
```

或在 .app 内置无 GUI 启动后端的方式不便（双击的 .app 默认会开窗口）。如要手机访问，建议从源码运行 `--lan` 模式。

终端打印 LAN URL：

```
  微记账本  →  http://127.0.0.1:8765
  局域网    →  http://192.168.1.23:8765   ← 手机浏览器输入这个
```

- iOS Safari：分享 → **添加到主屏幕**
- Android Chrome：菜单 → **安装应用**

> 数据**只在 Mac 上**，手机只是远程查看。

**离线缓存（v0.5.2+）**：手机端开过一次后，Service Worker 会缓存 app shell + 最近的查询结果。Mac 关机/休眠时手机仍能打开 app 看到**上次访问的数据**（只读，写操作会提示离线）。顶部小圆点显示连接状态：🟢 在线 / 🟡 离线（缓存）。

---

## 从源码运行（开发者）

```bash
git clone https://github.com/warrenop/weiCal.git
cd weiCal
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
python -m mycal                # 默认：原生窗口
python -m mycal --server       # 只开后端：127.0.0.1:8765
python -m mycal --lan          # 只开后端：0.0.0.0:8765（手机可访问）
```

Linux 额外依赖（pywebview 需要 webkit2gtk）：

```bash
sudo apt-get install -y libwebkit2gtk-4.1-0 gir1.2-webkit2-4.1 \
  libgirepository1.0-dev libcairo2-dev pkg-config
pip install PyGObject pycairo
```

---

## 本地构建可分发 App

PyInstaller spec 已写好：[`mycal.spec`](mycal.spec)。在**目标平台**上跑：

```bash
pip install -e ".[build]"      # 装 pyinstaller
pyinstaller mycal.spec --noconfirm
```

| 平台 | 输出 |
|---|---|
| macOS | `dist/微记账本.app`（~36 MB），可 `create-dmg dist/微记账本.app` 打 .dmg |
| Windows | `dist/mycal/mycal.exe` 加同目录依赖 |
| Linux | `dist/mycal/mycal` 单二进制 |

> **跨平台构建**：必须**在目标 OS 上各跑一次** PyInstaller。它打的是当前系统的原生二进制，不能交叉编译。这个 repo 用 [Github Actions matrix](.github/workflows/release.yml) 自动跑三平台。

### 添加自定义图标

```bash
# SVG → PNG → .icns（macOS）
mkdir -p icon.iconset
for size in 16 32 64 128 256 512; do
  rsvg-convert -w $size -h $size web/logo.svg -o icon.iconset/icon_${size}x${size}.png
done
iconutil -c icns icon.iconset -o icon.icns
```

改 [`mycal.spec`](mycal.spec) 里的 `ICON_PATH`（Windows 用 `.ico`），重新 build。

---

## 自动发版

push `v*` tag 即触发 [Github Actions](.github/workflows/release.yml)，并行 build macOS / Windows / Linux 并自动创建 Release：

```bash
git tag -a v0.5.0 -m "v0.5.0 — what's new"
git push origin v0.5.0
```

约 12 分钟后 Release 页面会出现下载链接。

---

## 命令行参数

```
python -m mycal [--server | --lan] [--port PORT]
```

- 无参数：原生窗口（pywebview）
- `--server`：只跑后端，绑 `127.0.0.1:8765`
- `--lan`：只跑后端，绑 `0.0.0.0:8765`，打印 LAN URL
- `--port`：覆盖 `--server` / `--lan` 端口

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `MYCAL_PORT` | 8765 | server / lan 模式端口 |
| `MYCAL_DATA_DIR` | OS 标准位置 | 数据库 + key 文件存放位置 |

---

## 平台兼容

| 平台 | 状态 | 备注 |
|---|---|---|
| macOS 12+ (Apple Silicon) | ✅ 已验证 | Release 提供 .app |
| macOS 12+ (Intel) | ⚠️ 可本地 build | Github runner 队列紧张未自动发 |
| Windows 10/11 | ✅ 已验证 | Release 提供 .exe |
| Linux (GNOME/KDE) | ⚠️ 可本地 build | webkit2gtk 运行时依赖较散 |
| iOS Safari | ✅ 浏览 | LAN 模式 + 加到主屏当 PWA |
| Android Chrome | ✅ 浏览 | 同上 |
| iOS / Android 离线 | ❌ | 需原生重写，超出范围 |

---

## 项目结构

```
weiCal/
├── pyproject.toml
├── mycal.spec                 # PyInstaller config
├── .github/workflows/         # 自动发版 CI
├── mycal/
│   ├── __main__.py           # 入口：原生窗口 / --server / --lan
│   ├── app.py                # FastAPI 装配
│   ├── db.py                 # SQLCipher + Keychain
│   ├── models.py             # Pydantic
│   ├── categorizer.py        # 关键字 → 分类
│   ├── importer.py           # CSV / xlsx 解析 + 去重
│   └── routes/               # transactions / summary / imports
└── web/                       # 前端：HTML + 原生 JS + ECharts
    ├── index.html
    ├── app.js / tour.js
    ├── styles.css
    ├── logo.svg / favicon.svg
    └── manifest.json
```

---

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | [pywebview](https://pywebview.flowrl.com/) (WKWebView / EdgeWebView2 / WebKit2GTK) |
| 后端 | Python 3.10+ · FastAPI · uvicorn |
| 存储 | SQLite + [SQLCipher](https://www.zetetic.net/sqlcipher/) (AES-256) |
| 密钥 | [keyring](https://github.com/jaraco/keyring) → macOS Keychain / Win Credential Manager / Linux Secret Service |
| 前端 | 原生 JS · [ECharts](https://echarts.apache.org/) · Tailwind (CDN) |
| 打包 | [PyInstaller](https://pyinstaller.org/) · Github Actions matrix |

---

## Roadmap

- [ ] 修 Linux CI 构建（webkit2gtk-4.1 包名 / 运行时依赖打包）
- [ ] 给 .app 做 Apple Developer 代码签名（取消 Gatekeeper 右键开）
- [x] PWA 端 service worker 离线缓存（v0.5.2+）
- [x] 预算 / 提醒（v0.5.0+）
- [x] 多账户 = 多文档（v0.6.0+，每份独立加密库 + Keychain key）
- [x] 应用内更新提示（v0.4.3+）

---

## License

[MIT](LICENSE)
