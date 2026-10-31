#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
خراط‌کد — ساخت نسخهٔ دسکتاپ ویندوز (فایل EXE + بستهٔ ZIP آفلاین)
=================================================================

نتیجهٔ این اسکریپت یک فایل ZIP است که کاربر فقط آن را استخراج می‌کند و روی
KharraatCode.exe دوبار کلیک می‌کند؛ بدون نصب، بدون Node.js، بدون مرورگر و
بدون نیاز به اینترنت.

پیش‌نیازها (فقط برای ساخت، نه برای کاربر نهایی):
  • Node.js + بسته‌های پروژه  (npm install --legacy-peer-deps)
  • zig (از طریق pip:  pip install ziglang)   → کامپایل EXE ویندوز
  • Pillow (ساخت ICO)                          → pip install pillow

نمونهٔ اجرا:
  python3 desktop/tools/build-windows.py \
      --app-dir "خراط_کد-—-شبیه_ساز-و-تولید-جی_کد-خراطی-cnc (2)" \
      --out desktop/out
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

DESKTOP = Path(__file__).resolve().parent.parent
HOST_DIR = DESKTOP / "host"
ASSETS = DESKTOP / "assets"
VENDOR = DESKTOP / "vendor"

APP_NAME = "KharraatCode"
WIN_W, WIN_H = 1440, 880          # ناحیهٔ نمایش؛ پنجره اندازهٔ ثابت دارد
SOURCES = "sources"               # نام پوشهٔ کد منبع داخل ZIP


# -----------------------------------------------------------------------------
#  ابزارها
# -----------------------------------------------------------------------------
def log(msg: str) -> None:
    print(f"[build] {msg}", flush=True)


def run(cmd: list[str], cwd: Path | None = None, env: dict | None = None) -> None:
    log(" ".join(str(c) for c in cmd))
    proc = subprocess.run(cmd, cwd=str(cwd) if cwd else None, env=env)
    if proc.returncode != 0:
        raise SystemExit(f"فرمان ناموفق بود (کد {proc.returncode}): {' '.join(map(str, cmd))}")


def find_zig() -> str:
    for name in ("zig",):
        p = shutil.which(name)
        if p:
            return p
    try:
        import ziglang  # type: ignore

        cand = Path(ziglang.__file__).parent / "zig"
        if cand.exists():
            return str(cand)
    except Exception:
        pass
    raise SystemExit("zig پیدا نشد.  pip install ziglang  (یا PATH=...)")


def zip_write_dir(zf: zipfile.ZipFile, src: Path, prefix: str) -> None:
    for root, dirs, files in os.walk(src):
        dirs.sort()
        for f in sorted(files):
            full = Path(root) / f
            rel = full.relative_to(src)
            zf.write(full, f"{prefix}/{rel.as_posix()}")


def human(n: int) -> str:
    return f"{n / 1024 / 1024:.1f} MB"


# -----------------------------------------------------------------------------
#  مراحل ساخت
# -----------------------------------------------------------------------------
def build_web(app_dir: Path, workdir: Path) -> Path:
    """ساخت رابط کاربری با Vite و سپس یکپارچه‌سازی در یک فایل HTML آفلاین."""
    log("۱) ساخت رابط کاربری (vite build) …")
    if not (app_dir / "node_modules").exists():
        run(["npm", "install", "--legacy-peer-deps", "--no-audit", "--no-fund"], cwd=app_dir)
    run(["npx", "vite", "build", "--logLevel", "warn"], cwd=app_dir)

    dist = app_dir / "dist"
    if not (dist / "index.html").exists():
        raise SystemExit("خروجی vite پیدا نشد (dist/index.html)")

    log("۲) یکپارچه‌سازی همهٔ فایل‌ها در یک HTML خودبسنده …")
    out_html = workdir / "app" / "index.html"
    run(["node", str(DESKTOP / "tools/bundle-html.mjs"), str(dist), str(out_html)])
    return out_html


def make_icon(workdir: Path) -> Path:
    log("۳) ساخت آیکن‌ها (ICO چند‌اندازه‌ای) …")
    run([sys.executable, str(DESKTOP / "tools/make-icons.py")])
    ico = ASSETS / "kharraatcode.ico"
    if not ico.exists():
        raise SystemExit("ساخت آیکن ناموفق بود")
    return ico


def build_host(workdir: Path, log_build: bool = True) -> Path:
    """کامپایل میزبان بومی ویندوز با zig و منابع (آیکن، نسخه، مانیفست)."""
    zig = find_zig()
    log(f"۴) کامپایل میزبان ویندوز با zig ({zig}) …")

    # آرکایو ایمپورت DLL
    lib = workdir / "WebView2Loader.lib"
    run(
        [
            zig,
            "dlltool",
            "-m",
            "i386:x86-64",
            "-d",
            str(VENDOR / "WebView2Loader.def"),
            "-l",
            str(lib),
            "-D",
            "WebView2Loader.dll",
        ]
    )

    # منابع: آیکن + اطلاعات نسخه + مانیفست
    rc = HOST_DIR / "app.rc"
    res = workdir / "app.res"
    run([zig, "rc", f"/fo{res}", f"/i{HOST_DIR}", str(rc)], cwd=HOST_DIR)

    exe = workdir / f"{APP_NAME}.exe"
    run(
        [
            zig,
            "c++",
            "-target",
            "x86_64-windows-gnu",
            "-municode",
            "-std=c++17",
            "-O2",
            "-DUNICODE",
            "-D_UNICODE",
            f"-I{HOST_DIR / 'sdk'}",
            str(HOST_DIR / "main.cpp"),
            str(res),
            str(lib),
            "-lole32",
            "-loleaut32",
            "-ladvapi32",
            "-lshell32",
            "-lshlwapi",
            "-lcomdlg32",
            "-luuid",
            "-lgdi32",
            "-luser32",
            "-lkernel32",
            "-Wl,--subsystem,windows",
            "-o",
            str(exe),
        ]
    )
    if not exe.exists():
        raise SystemExit("ساخت EXE ناموفق بود")

    # بررسی: باید برنامهٔ گرافیکی ویندوز باشد (نه کنسول)
    data = exe.read_bytes()
    import struct

    pe = struct.unpack_from("<I", data, 0x3C)[0]
    subsystem = struct.unpack_from("<H", data, pe + 24 + 68)[0]
    if subsystem != 2:
        raise SystemExit(f"EXE باید زیرسیستم گرافیکی باشد، اما {subsystem} است")
    if b".rsrc" not in data:
        raise SystemExit("منابع (آیکن/نسخه) در EXE قرار نگرفتند")
    log(f"   EXE آماده: {exe.name}  ({human(exe.stat().st_size)})")
    return exe


def write_extras(pkg: Path, app_dir: Path, exe_name: str) -> None:
    log("۵) نوشتن فایل‌های پیکربندی و راهنما …")

    (pkg / "app.cfg").write_text(
        "\ufeff"
        f"title=خراط‌کد — شبیه‌ساز و تولید جی‌کد خراطی CNC\n"
        f"width={WIN_W}\n"
        f"height={WIN_H}\n"
        "fixed=1\n"
        "zoom=0\n"
        "devtools=0\n"
        "downloadnotify=1\n"
        "log=\n",
        encoding="utf-8",
    )

    (pkg / "README-فارسی.txt").write_text(
        """راهنمای اجرای «خراط‌کد» — نسخهٔ دسکتاپ بدون نیاز به اینترنت
==================================================================

چطور اجرا کنم؟
---------------
۱) این فایل ZIP را کامل استخراج کنید (راست‌کلیک → Extract All).
   مهم: برنامه را از داخل خود ZIP اجرا نکنید؛ اجرای فایل‌ها داخل ZIP
   باعث خرابی و بسته‌شدن ناگهانی می‌شود.

۲) روی فایل  KharraatCode.exe  دوبار کلیک کنید.

نه نصب لازم است، نه Node.js، نه مرورگر و نه اینترنت.
همهٔ فونت‌ها (Vazirmatn، Lalezar، JetBrains Mono) داخل خود برنامه هستند و
هیچ چیزی از اینترنت بارگذاری نمی‌شود.

محتویات پوشه
------------
  KharraatCode.exe      برنامهٔ اصلی (ویندوز ۱۰ و ۱۱ — ۶۴ بیتی)
  WebView2Loader.dll    همراه برنامه؛ آن را جابه‌جا یا حذف نکنید
  app\\index.html       رابط کاربری کامل (فایل‌ها به هم چسبیده‌اند)
  app.ico               آیکن برنامه
  app.cfg               تنظیمات پنجره (اندازه، عنوان، ...)
  sources\\              کد منبع برنامه (برای توسعهٔ بعدی)
  _UserData\\            پوشهٔ داده‌ها؛ خودکار ساخته می‌شود (پروژه‌ها و تنظیمات)

اگر ویندوز پیام «WebView2 Runtime» داد
--------------------------------------
این موتور نمایش، جزء خود ویندوز ۱۱ و تقریباً همهٔ نسخه‌های ویندوز ۱۰ است.
اگر روی رایانه‌ای نصب نبود، فقط یک بار بستهٔ رایگان «Microsoft Edge WebView2
Runtime» را از سایت مایکروسافت نصب کنید؛ بعد از آن برنامه بدون اینترنت کار
می‌کند:
   https://developer.microsoft.com/microsoft-edge/webview2/

اگر ویندوز از اجرای برنامه جلوگیری کرد
--------------------------------------
روی فایل راست‌کلیک کنید → Properties → پایین پنجره گزینهٔ Unblock را بزنید
(یا در SmartScreen روی More info → Run anyway بزنید). این پیام فقط به این
دلیل است که فایل روی این رایانه امضای دیجیتال تجاری ندارد.

فایل‌های خروجی (جی‌کد، DXF و پروژه) کجا ذخیره می‌شوند؟
------------------------------------------------------
بار اول: پوشهٔ  Documents\\KharraatCode  به‌صورت خودکار باز می‌شود.
فایل کشیده‌شده روی پنجرهٔ برنامه هم در پوشهٔ  _Incoming  کنار برنامه کپی
می‌شود و صفحهٔ برنامه هرگز عوض نمی‌شود.

کلیدهای مفید
------------
  Ctrl + C / Ctrl + V     کپی و چسباندن (کار می‌کند)
  Ctrl + R / F5           غیرفعال است (صفحه به‌طور تصادفی بارگذاری نمی‌شود)
  Ctrl + چرخ ماوس         بزرگ‌نمایی صفحه قفل است تا چیدمان پنل‌ها به‌هم نریزد
  Esc                     بستن پنجره‌های محاوره‌ای داخل خود برنامه

تنظیم پیشرفته (اختیاری) — فایل app.cfg
---------------------------------------
  width=1440       عرض ناحیهٔ نمایش
  height=880       ارتفاع ناحیهٔ نمایش
  fixed=1          اندازهٔ پنجره ثابت (۱) یا قابل تغییر اندازه (۰)
  zoom=0           قفل بزرگ‌نمایی صفحه
  devtools=0       فعال‌سازی ابزار توسعه‌دهنده (برای عیب‌یابی)
  log=             نام فایل لاگ؛ خالی = بدون لاگ (مثلاً log=debug.log)
  downloaddir=     مسیر ذخیرهٔ خروجی‌ها (خالی = Documents\\KharraatCode)

پشتیبانی
---------
اگر برنامه پیام خطا داد، فایل app.cfg را باز کنید و مقدار  log=debug.log  را
بگذارید، برنامه را اجرا کنید و فایل debug.log را بفرستید.
""",
        encoding="utf-8",
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--app-dir", required=True, help="پوشهٔ پروژهٔ React/Vite")
    ap.add_argument("--out", default=str(DESKTOP / "release"), help="پوشهٔ خروجی")
    ap.add_argument("--no-zip", action="store_true", help="فقط پوشهٔ ساخته‌شده، بدون ZIP")
    args = ap.parse_args()

    app_dir = Path(args.app_dir).resolve()
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    workdir = Path(tempfile.mkdtemp(prefix="kharraat-build-"))
    pkg = workdir / "package"
    (pkg / "app").mkdir(parents=True, exist_ok=True)

    try:
        build_web(app_dir, pkg)
        make_icon(workdir)
        exe = build_host(workdir)

        shutil.copy2(exe, pkg / f"{APP_NAME}.exe")
        shutil.copy2(VENDOR / "WebView2Loader.dll", pkg / "WebView2Loader.dll")
        shutil.copy2(ASSETS / "kharraatcode.ico", pkg / "app.ico")
        write_extras(pkg, app_dir, f"{APP_NAME}.exe")

        # کد منبع (برای توسعهٔ بعدی — بدون node_modules و dist)
        src_root = pkg / SOURCES
        src_root.mkdir(exist_ok=True)
        ignore = shutil.ignore_patterns(
            "node_modules", "dist", ".git", "*.log", "bun.lock", ".env*", "_UserData"
        )
        shutil.copytree(app_dir, src_root / "web", ignore=ignore)
        shutil.copytree(DESKTOP, src_root / "desktop", ignore=shutil.ignore_patterns("out", "release", "vendor", "__pycache__"))

        # خلاصهٔ ساخت
        (pkg / "build-info.txt").write_text(
            f"version: 1.0.0\nbuilt: {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
            f"exe: {APP_NAME}.exe\nwindow: {WIN_W}x{WIN_H} (fixed={1})\n"
            "offline: yes\nfonts: Vazirmatn, Lalezar, JetBrains Mono (embedded)\n",
            encoding="utf-8",
        )

        pkg_name = f"KharraatCode-Windows-Desktop-v1.0.0"
        if args.no_zip:
            final_dir = out_dir / pkg_name
            if final_dir.exists():
                shutil.rmtree(final_dir)
            shutil.copytree(pkg, final_dir)
            log(f"پوشهٔ نهایی: {final_dir}")
            return 0

        zip_path = out_dir / f"{pkg_name}.zip"
        if zip_path.exists():
            zip_path.unlink()

        log("۶) ساخت فایل ZIP …")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
            # همه‌چیز زیر یک پوشهٔ ریشه تا استخراج مرتب باشد
            for root, dirs, files in os.walk(pkg):
                dirs.sort()
                rel_root = Path(root).relative_to(pkg)
                if str(rel_root) != ".":
                    zf.writestr(f"{pkg_name}/{rel_root.as_posix()}/", "")
                for f in sorted(files):
                    full = Path(root) / f
                    rel = full.relative_to(pkg).as_posix()
                    if rel.endswith(".zip"):
                        continue
                    zf.write(full, f"{pkg_name}/{rel}")

        # فایل چکیده برای اطمینان از سالم بودن دانلود
        import hashlib

        digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
        (out_dir / f"{pkg_name}.zip.sha256").write_text(f"{digest}  {zip_path.name}\n", encoding="utf-8")

        log(f"✔ آماده شد: {zip_path}  ({human(zip_path.stat().st_size)})")
        log(f"  SHA-256: {digest}")
        return 0
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
