# -*- coding: utf-8 -*-
"""
電子印メーカー (DenshiIn)
  - Flask で UI を提供し、タスクバー（通知領域）に常駐する電子印作成ツール
  - 必要パッケージ: flask のみ（トレイ常駐は Windows API を ctypes で直接使用）
  - 起動: start.bat（または pythonw app.py）
          pythonw app.py --tray-only … 常駐のみ（Windows 起動時用）
"""
import base64
import json
import os
import re
import subprocess
import sys
import threading
import urllib.request
import webbrowser
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from werkzeug.serving import make_server

APP_NAME = "DenshiIn"
APP_TITLE = "電子印メーカー"
HOST = "127.0.0.1"
PORT = int(os.environ.get("DENSHIIN_PORT", "8765"))

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("APPDATA") or Path.home()) / APP_NAME
DATA_DIR.mkdir(parents=True, exist_ok=True)
STATE_FILE = DATA_DIR / "state.json"
LOG_FILE = DATA_DIR / "app.log"
DEFAULT_OUT = Path.home() / "Pictures" / "電子印"

STARTUP_DIR = Path(os.environ.get("APPDATA") or Path.home()) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
STARTUP_FILE = STARTUP_DIR / "DenshiIn.vbs"

# pythonw で起動すると stdout/stderr が無いため、ログファイルへ逃がす
if sys.stdout is None or sys.stderr is None:
    _log = open(LOG_FILE, "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stdout or _log
    sys.stderr = sys.stderr or _log

# ---------------------------------------------------------------- 状態保存
_lock = threading.Lock()


def load_state():
    try:
        st = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        if not isinstance(st, dict):
            st = {}
    except Exception:
        st = {}
    st.setdefault("presets", [])
    st.setdefault("last", None)
    st.setdefault("outputDir", str(DEFAULT_OUT))
    return st


def save_state(st):
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(STATE_FILE)


def update_state(**kw):
    with _lock:
        st = load_state()
        st.update(kw)
        save_state(st)
        return st


def out_dir():
    return Path(load_state()["outputDir"])


def open_folder(path):
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    if os.name == "nt":
        os.startfile(str(path))
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


def safe_name(name):
    name = re.sub(r'[\\/:*?"<>|\s]+', "_", str(name or "stamp")).strip("._")
    return (name or "stamp")[:80]


# ---------------------------------------------------------------- Flask
app = Flask(__name__, template_folder=str(BASE_DIR / "templates"), static_folder=str(BASE_DIR / "static"))
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
app.config["MAX_CONTENT_LENGTH"] = 30 * 1024 * 1024


@app.get("/")
def index():
    return render_template("index.html", title=APP_TITLE)


@app.get("/api/ping")
def ping():
    return "denshiin"


@app.get("/api/state")
def get_state():
    return jsonify(load_state())


@app.post("/api/last")
def post_last():
    update_state(last=request.get_json(silent=True))
    return jsonify(ok=True)


@app.post("/api/presets")
def post_presets():
    data = request.get_json(silent=True)
    if not isinstance(data, list):
        return jsonify(ok=False, error="形式が不正です"), 400
    update_state(presets=data[:50])
    return jsonify(ok=True)


@app.post("/api/config")
def post_config():
    data = request.get_json(silent=True) or {}
    d = str(data.get("outputDir", "")).strip().strip('"')
    if not d:
        return jsonify(ok=False, error="保存先が空です"), 400
    try:
        Path(d).mkdir(parents=True, exist_ok=True)
    except Exception as e:
        return jsonify(ok=False, error=f"フォルダを作成できません: {e}"), 400
    update_state(outputDir=d)
    return jsonify(ok=True, outputDir=d)


@app.post("/api/save")
def post_save():
    data = request.get_json(silent=True) or {}
    url = str(data.get("data", ""))
    if not url.startswith("data:image/png;base64,"):
        return jsonify(ok=False, error="画像データが不正です"), 400
    try:
        raw = base64.b64decode(url.split(",", 1)[1])
        folder = out_dir()
        folder.mkdir(parents=True, exist_ok=True)
        base = safe_name(data.get("name"))
        path = folder / f"{base}.png"
        i = 2
        while path.exists():
            path = folder / f"{base}_{i}.png"
            i += 1
        path.write_bytes(raw)
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500
    return jsonify(ok=True, path=str(path))


@app.post("/api/open-folder")
def post_open_folder():
    try:
        open_folder(out_dir())
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500
    return jsonify(ok=True)


# ---------------------------------------------------------------- ウィンドウ
def find_edge():
    for k in ("PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA"):
        base = os.environ.get(k)
        if base:
            p = Path(base) / "Microsoft" / "Edge" / "Application" / "msedge.exe"
            if p.exists():
                return str(p)
    return None


def open_window():
    url = f"http://{HOST}:{PORT}/"
    edge = find_edge()
    if edge:
        # アプリモード（アドレスバー無しの専用ウィンドウ）で開く
        subprocess.Popen([edge, f"--app={url}", "--window-size=1100,780"])
    else:
        webbrowser.open(url)


# ---------------------------------------------------------------- スタートアップ登録
def pythonw_path():
    exe = Path(sys.executable)
    w = exe.with_name("pythonw.exe")
    return str(w if w.exists() else exe)


def startup_enabled():
    return STARTUP_FILE.exists()


def set_startup(on):
    if on:
        STARTUP_DIR.mkdir(parents=True, exist_ok=True)
        script = BASE_DIR / "app.py"
        vbs = (
            'Set sh = CreateObject("WScript.Shell")\r\n'
            f'sh.CurrentDirectory = "{BASE_DIR}"\r\n'
            f'sh.Run """{pythonw_path()}"" ""{script}"" --tray-only", 0, False\r\n'
        )
        # 日本語パス対策として UTF-16(BOM付) で保存（VBScript が解釈可能）
        STARTUP_FILE.write_text(vbs, encoding="utf-16")
    elif STARTUP_FILE.exists():
        STARTUP_FILE.unlink()


# ---------------------------------------------------------------- トレイ（ctypes / Win32 API）
def message_box(msg):
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, msg, APP_TITLE, 0x10)
    except Exception:
        print(msg, file=sys.stderr)


def run_tray():
    import ctypes
    from ctypes import wintypes as W

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    shell32 = ctypes.WinDLL("shell32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    LRESULT = ctypes.c_ssize_t
    WNDPROC = ctypes.WINFUNCTYPE(LRESULT, W.HWND, W.UINT, W.WPARAM, W.LPARAM)

    class WNDCLASSW(ctypes.Structure):
        _fields_ = [("style", W.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
                    ("cbWndExtra", ctypes.c_int), ("hInstance", W.HINSTANCE), ("hIcon", W.HICON),
                    ("hCursor", W.HANDLE), ("hbrBackground", W.HBRUSH), ("lpszMenuName", W.LPCWSTR),
                    ("lpszClassName", W.LPCWSTR)]

    class GUID(ctypes.Structure):
        _fields_ = [("Data1", W.DWORD), ("Data2", W.WORD), ("Data3", W.WORD), ("Data4", ctypes.c_ubyte * 8)]

    class NOTIFYICONDATAW(ctypes.Structure):
        _fields_ = [("cbSize", W.DWORD), ("hWnd", W.HWND), ("uID", W.UINT), ("uFlags", W.UINT),
                    ("uCallbackMessage", W.UINT), ("hIcon", W.HICON), ("szTip", W.WCHAR * 128),
                    ("dwState", W.DWORD), ("dwStateMask", W.DWORD), ("szInfo", W.WCHAR * 256),
                    ("uVersion", W.UINT), ("szInfoTitle", W.WCHAR * 64), ("dwInfoFlags", W.DWORD),
                    ("guidItem", GUID), ("hBalloonIcon", W.HICON)]

    user32.DefWindowProcW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
    user32.DefWindowProcW.restype = LRESULT
    user32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASSW)]
    user32.RegisterClassW.restype = W.ATOM
    user32.CreateWindowExW.argtypes = [W.DWORD, W.LPCWSTR, W.LPCWSTR, W.DWORD, ctypes.c_int, ctypes.c_int,
                                       ctypes.c_int, ctypes.c_int, W.HWND, W.HMENU, W.HINSTANCE, W.LPVOID]
    user32.CreateWindowExW.restype = W.HWND
    user32.LoadImageW.argtypes = [W.HINSTANCE, W.LPCWSTR, W.UINT, ctypes.c_int, ctypes.c_int, W.UINT]
    user32.LoadImageW.restype = W.HANDLE
    user32.LoadIconW.argtypes = [W.HINSTANCE, ctypes.c_void_p]
    user32.LoadIconW.restype = W.HICON
    user32.RegisterWindowMessageW.argtypes = [W.LPCWSTR]
    user32.RegisterWindowMessageW.restype = W.UINT
    user32.CreatePopupMenu.restype = W.HMENU
    user32.AppendMenuW.argtypes = [W.HMENU, W.UINT, ctypes.c_size_t, W.LPCWSTR]
    user32.SetMenuDefaultItem.argtypes = [W.HMENU, W.UINT, W.UINT]
    user32.TrackPopupMenu.argtypes = [W.HMENU, W.UINT, ctypes.c_int, ctypes.c_int, ctypes.c_int, W.HWND, W.LPVOID]
    user32.TrackPopupMenu.restype = ctypes.c_int
    user32.DestroyMenu.argtypes = [W.HMENU]
    user32.GetCursorPos.argtypes = [ctypes.POINTER(W.POINT)]
    user32.SetForegroundWindow.argtypes = [W.HWND]
    user32.PostMessageW.argtypes = [W.HWND, W.UINT, W.WPARAM, W.LPARAM]
    user32.DestroyWindow.argtypes = [W.HWND]
    user32.GetMessageW.argtypes = [ctypes.POINTER(W.MSG), W.HWND, W.UINT, W.UINT]
    user32.TranslateMessage.argtypes = [ctypes.POINTER(W.MSG)]
    user32.DispatchMessageW.argtypes = [ctypes.POINTER(W.MSG)]
    shell32.Shell_NotifyIconW.argtypes = [W.DWORD, ctypes.POINTER(NOTIFYICONDATAW)]
    kernel32.GetModuleHandleW.argtypes = [W.LPCWSTR]
    kernel32.GetModuleHandleW.restype = W.HMODULE

    WM_DESTROY, WM_CLOSE, WM_NULL = 0x0002, 0x0010, 0x0000
    WM_LBUTTONUP, WM_RBUTTONUP = 0x0202, 0x0205
    WM_TRAY = 0x0400 + 20
    NIM_ADD, NIM_DELETE = 0, 2
    NIF_MESSAGE, NIF_ICON, NIF_TIP = 1, 2, 4
    MF_STRING, MF_CHECKED, MF_SEPARATOR = 0x0, 0x8, 0x800
    TPM_RIGHTBUTTON, TPM_NONOTIFY, TPM_RETURNCMD = 0x2, 0x80, 0x100
    ID_OPEN, ID_FOLDER, ID_STARTUP, ID_QUIT = 1, 2, 3, 9

    hinst = kernel32.GetModuleHandleW(None)
    ico = BASE_DIR / "static" / "stamp.ico"
    hicon = None
    if ico.exists():
        hicon = user32.LoadImageW(None, str(ico), 1, 0, 0, 0x10 | 0x40)  # IMAGE_ICON, LR_LOADFROMFILE|LR_DEFAULTSIZE
    if not hicon:
        hicon = user32.LoadIconW(None, ctypes.c_void_p(32512))  # IDI_APPLICATION
    msg_taskbar = user32.RegisterWindowMessageW("TaskbarCreated")

    nid = NOTIFYICONDATAW()
    nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
    nid.uID = 1
    nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
    nid.uCallbackMessage = WM_TRAY
    nid.hIcon = hicon
    nid.szTip = APP_TITLE

    def add_icon():
        shell32.Shell_NotifyIconW(NIM_ADD, ctypes.byref(nid))

    def show_menu(hwnd):
        m = user32.CreatePopupMenu()
        user32.AppendMenuW(m, MF_STRING, ID_OPEN, "開く")
        user32.AppendMenuW(m, MF_STRING, ID_FOLDER, "保存フォルダを開く")
        user32.AppendMenuW(m, MF_SEPARATOR, 0, None)
        user32.AppendMenuW(m, MF_STRING | (MF_CHECKED if startup_enabled() else 0), ID_STARTUP, "Windows 起動時に常駐する")
        user32.AppendMenuW(m, MF_SEPARATOR, 0, None)
        user32.AppendMenuW(m, MF_STRING, ID_QUIT, "終了")
        user32.SetMenuDefaultItem(m, ID_OPEN, 0)
        pt = W.POINT()
        user32.GetCursorPos(ctypes.byref(pt))
        user32.SetForegroundWindow(hwnd)
        cmd = user32.TrackPopupMenu(m, TPM_RIGHTBUTTON | TPM_NONOTIFY | TPM_RETURNCMD, pt.x, pt.y, 0, hwnd, None)
        user32.PostMessageW(hwnd, WM_NULL, 0, 0)
        user32.DestroyMenu(m)
        try:
            if cmd == ID_OPEN:
                open_window()
            elif cmd == ID_FOLDER:
                open_folder(out_dir())
            elif cmd == ID_STARTUP:
                set_startup(not startup_enabled())
            elif cmd == ID_QUIT:
                user32.DestroyWindow(hwnd)
        except Exception as e:
            message_box(str(e))

    def wndproc(hwnd, msg, wparam, lparam):
        if msg == WM_TRAY:
            ev = lparam & 0xFFFF
            if ev == WM_LBUTTONUP:
                open_window()
            elif ev == WM_RBUTTONUP:
                show_menu(hwnd)
            return 0
        if msg_taskbar and msg == msg_taskbar:  # エクスプローラー再起動時にアイコンを再登録
            add_icon()
            return 0
        if msg == WM_CLOSE:
            user32.DestroyWindow(hwnd)
            return 0
        if msg == WM_DESTROY:
            shell32.Shell_NotifyIconW(NIM_DELETE, ctypes.byref(nid))
            user32.PostQuitMessage(0)
            return 0
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    proc = WNDPROC(wndproc)  # GC されないよう参照を保持
    wc = WNDCLASSW()
    wc.lpfnWndProc = proc
    wc.hInstance = hinst
    wc.lpszClassName = "DenshiInTrayWindow"
    user32.RegisterClassW(ctypes.byref(wc))
    hwnd = user32.CreateWindowExW(0, wc.lpszClassName, APP_TITLE, 0, 0, 0, 0, 0, None, None, hinst, None)
    if not hwnd:
        raise OSError(f"トレイ用ウィンドウを作成できません (code {ctypes.get_last_error()})")
    nid.hWnd = hwnd
    add_icon()

    msg = W.MSG()
    while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
        user32.TranslateMessage(ctypes.byref(msg))
        user32.DispatchMessageW(ctypes.byref(msg))
    _ = proc


def already_running():
    try:
        with urllib.request.urlopen(f"http://{HOST}:{PORT}/api/ping", timeout=0.8) as r:
            return r.read().decode() == "denshiin"
    except Exception:
        return False


def main():
    tray_only = "--tray-only" in sys.argv

    # 二重起動防止：既に常駐していればウィンドウだけ開いて終了
    if already_running():
        if not tray_only:
            open_window()
        return

    try:
        server = make_server(HOST, PORT, app, threaded=True)
    except OSError as e:
        message_box(f"ポート {PORT} を使用できません。\n他のアプリが使用中の可能性があります。\n\n{e}")
        return
    threading.Thread(target=server.serve_forever, daemon=True).start()

    if not tray_only:
        open_window()

    if os.name == "nt":
        try:
            run_tray()
        except Exception as e:
            message_box(f"常駐アイコンを作成できませんでした。\n{e}")
    else:
        print(f"{APP_TITLE}: http://{HOST}:{PORT}/  (Ctrl+C で終了)")
        try:
            threading.Event().wait()
        except KeyboardInterrupt:
            pass
    server.shutdown()


if __name__ == "__main__":
    main()
