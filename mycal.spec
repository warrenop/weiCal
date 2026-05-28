# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for 微记账本.

Build:
  macOS / Linux:   pyinstaller mycal.spec
  Windows:         pyinstaller mycal.spec

Output:
  macOS:           dist/微记账本.app    (also dist/mycal/ raw bundle)
  Windows:         dist/mycal/mycal.exe
  Linux:           dist/mycal/mycal

The app stays as a single .app/.exe — uvicorn runs in a thread, pywebview
opens the native window. No external Python / Docker / browser needed.
"""
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules

PROJECT_ROOT = Path(SPECPATH).resolve()
ICON_PATH = None  # set to absolute path of .icns/.ico to brand the app

# Some libraries pull modules in dynamically — PyInstaller can't find them via
# static analysis, so list them explicitly.
hiddenimports = []
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("keyring.backends")
hiddenimports += ["sqlcipher3", "sqlcipher3.dbapi2"]
hiddenimports += ["pkg_resources"]

# Static assets shipped alongside the binary
datas = [
    (str(PROJECT_ROOT / "web"), "web"),
]


a = Analysis(
    [str(PROJECT_ROOT / "mycal" / "__main__.py")],
    pathex=[str(PROJECT_ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="mycal",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,           # no terminal window when launched
    disable_windowed_traceback=False,
    argv_emulation=True,     # macOS: pass --args from Finder/Open
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=ICON_PATH,
)

coll = COLLECT(
    exe, a.binaries, a.zipfiles, a.datas,
    strip=False, upx=False, name="mycal",
)

# macOS: wrap into a proper .app bundle
if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="微记账本.app",
        icon=ICON_PATH,
        bundle_identifier="com.local.mycal",
        info_plist={
            "CFBundleDisplayName": "微记账本",
            "CFBundleName": "微记账本",
            "CFBundleShortVersionString": "0.5.1",
            "CFBundleVersion": "0.5.1",
            "NSHighResolutionCapable": True,
            "LSMinimumSystemVersion": "11.0",
            "NSHumanReadableCopyright": "Copyright © 2026 mycal",
        },
    )
