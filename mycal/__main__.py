"""Entrypoint: `python -m mycal`.

Three modes:

1. **App mode (default)** — opens a native window via pywebview, with
   uvicorn running in a background thread on a random localhost port.
   This is the "double-click .app" experience.

2. **--lan** — server only, binds 0.0.0.0:8765, prints LAN URL. No native
   window. Use this when you want phones on the same WiFi to access the
   data via browser/PWA.

3. **--server** — server only on 127.0.0.1:8765, no native window. Useful
   for headless/dev work.
"""
import argparse
import os
import socket
import sys
import threading
import time
from urllib.request import urlopen

import uvicorn


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def _lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def _wait_ready(url: str, timeout: float = 10.0) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        try:
            urlopen(url, timeout=0.5)
            return True
        except Exception:
            time.sleep(0.1)
    return False


def _serve(host: str, port: int, *, blocking: bool = True):
    """Run uvicorn. When `blocking=False` it's expected to be the target of a
    threading.Thread, so install_signal_handlers is disabled.

    Pass the FastAPI app *object* (not a string) so uvicorn doesn't try to
    `importlib.import_module("mycal.app")` — that fails inside a frozen
    PyInstaller bundle where module discovery is different.
    """
    from mycal.app import app as fastapi_app
    config = uvicorn.Config(
        fastapi_app, host=host, port=port, log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)
    if not blocking:
        # Signal handling only works on the main thread.
        server.install_signal_handlers = lambda: None
    server.run()


def run_app_mode():
    """Default: native window via pywebview + uvicorn in background thread."""
    import webview  # imported lazily so --lan / --server don't pay the cost

    port = _free_port()
    url = f"http://127.0.0.1:{port}"

    t = threading.Thread(
        target=_serve, args=("127.0.0.1", port),
        kwargs={"blocking": False}, daemon=True,
    )
    t.start()

    if not _wait_ready(url):
        print("后端启动失败，请检查日志", file=sys.stderr)
        sys.exit(1)

    window = webview.create_window(
        title="微记账本",
        url=url,
        width=1280, height=820,
        min_size=(960, 640),
        text_select=True,
    )
    # Pick the right native engine per OS automatically.
    webview.start()


def run_server_mode(host: str, port: int, *, announce_lan: bool = False):
    print()
    print(f"  微记账本  →  http://127.0.0.1:{port}")
    if announce_lan:
        print(f"  局域网    →  http://{_lan_ip()}:{port}  (手机/其它设备同 WiFi 可访问)")
        print(f"  数据仍只存在本机，加密 + Keychain 锁定。")
    print()
    _serve(host, port, blocking=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="微记账本 (mycal)")
    g = parser.add_mutually_exclusive_group()
    g.add_argument("--lan", action="store_true",
                   help="只跑后端，绑定 0.0.0.0:8765，供同 WiFi 手机访问")
    g.add_argument("--server", action="store_true",
                   help="只跑后端，绑定 127.0.0.1:8765，不开窗口")
    parser.add_argument(
        "--port", type=int,
        default=int(os.environ.get("MYCAL_PORT", "8765")),
        help="--lan / --server 下使用的端口（app 模式自动选随机端口）",
    )
    args = parser.parse_args()

    if args.lan:
        run_server_mode("0.0.0.0", args.port, announce_lan=True)
    elif args.server:
        run_server_mode("127.0.0.1", args.port)
    else:
        run_app_mode()


if __name__ == "__main__":
    main()
