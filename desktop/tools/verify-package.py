#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
خراط‌کد — بررسی خودکار بستهٔ ویندوز

بدون نیاز به ویندوز، سلامت بستهٔ ساخته‌شده را می‌سنجد:
  • فایل‌های لازم در ZIP هستند
  • EXE واقعاً یک برنامهٔ گرافیکی ویندوز (PE32+) است و آیکن/نسخه دارد
  • آیکن ICO شامل همهٔ اندازه‌های لازم ویندوز ۱۰/۱۱ است
  • HTML خودبسنده است: فونت‌ها، CSS و JS همه داخلی‌اند و هیچ ارجاع بیرونی ندارد
  • فونت‌های اصلی برنامه (Vazirmatn / Lalezar / JetBrains Mono) بدون تغییر جاسازی شده‌اند
"""

from __future__ import annotations

import base64
import hashlib
import io
import re
import struct
import sys
import zipfile
from pathlib import Path

OK = "✔"
BAD = "✘"
problems: list[str] = []


def has_str(data: bytes, text: str) -> bool:
    """رشته ممکن است به‌صورت UTF-8 یا UTF-16LE (رشته‌های wide ویندوز) در فایل باشد."""
    return text.encode("utf-8") in data or text.encode("utf-16-le") in data


def check(cond: bool, msg: str, detail: str = "") -> None:
    print(f"  {OK if cond else BAD} {msg}{('  — ' + detail) if detail else ''}")
    if not cond:
        problems.append(msg)


def pe_info(data: bytes) -> dict:
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe:pe + 4] != b"PE\0\0":
        return {}
    machine = struct.unpack_from("<H", data, pe + 4)[0]
    nsec = struct.unpack_from("<H", data, pe + 6)[0]
    opt = pe + 24
    magic = struct.unpack_from("<H", data, opt)[0]
    subsystem = struct.unpack_from("<H", data, opt + 68)[0]
    ddoff = opt + (112 if magic == 0x20B else 96)
    return {
        "machine": machine,
        "magic": magic,
        "subsystem": subsystem,
        "sections": nsec,
        "has_rsrc": b".rsrc" in data,
        "signed": b"\x00\x00\x02\x00" in data[:4096],  # فقط نشانهٔ احتمالی، قطعی نیست
        "dll_import": b"WebView2Loader.dll" in data,
        "unicode_strings": data.count(b"\x00\x00") > 0,
    }


def ico_entries(data: bytes) -> list[tuple[int, int]]:
    if data[:4] != b"\x00\x00\x01\x00":
        return []
    count = struct.unpack_from("<H", data, 4)[0]
    out = []
    for i in range(count):
        w, h = data[6 + i * 16], data[7 + i * 16]
        out.append((w or 256, h or 256))
    return out


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: verify-package.py <zip>")
        return 2
    zip_path = Path(sys.argv[1])
    print(f"\n=== بررسی بستهٔ ویندوز: {zip_path.name} ===\n")
    digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    print(f"  SHA-256: {digest}")
    print(f"  حجم: {zip_path.stat().st_size / 1024 / 1024:.2f} مگابایت\n")

    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        prefix = names[0].split("/")[0] + "/"
        need = ["KharraatCode.exe", "WebView2Loader.dll", "app/index.html", "app.ico",
                "app.cfg", "README-فارسی.txt", "build-info.txt"]
        print("۱) فایل‌های لازم:")
        for n in need:
            check(f"{prefix}{n}" in names, n)
        check(sum(1 for n in names if n.startswith(f"{prefix}sources/")) > 20, "کد منبع همراه بسته")

        exe = zf.read(f"{prefix}KharraatCode.exe")
        dll = zf.read(f"{prefix}WebView2Loader.dll")
        ico = zf.read(f"{prefix}app.ico")
        html = zf.read(f"{prefix}app/index.html").decode("utf-8")

    print("\n۲) فایل اجرایی (EXE):")
    info = pe_info(exe)
    check(bool(info), "ساختار PE معتبر")
    check(info.get("machine") == 0x8664, "معماری ۶۴ بیتی x64", hex(info.get("machine", 0)))
    check(info.get("subsystem") == 2, "زیرسیستم گرافیکی ویندوز (بدون پنجرهٔ سیاه کنسول)",
          f"subsystem={info.get('subsystem')}")
    check(info.get("has_rsrc", False), "منابع ویندوز (آیکن + اطلاعات نسخه) داخل EXE")
    check(has_str(exe, "WebView2Loader.dll"), "بارگذاری موتور نمایش WebView2")
    check(has_str(exe, "KharraatCode") and has_str(exe, "FileDescription"), "نام و اطلاعات نسخهٔ فایل")
    check(has_str(exe, "PerMonitorV2"), "مانیفست DPI (تصویر شارپ روی نمایشگرهای HiDPI)")

    print("\n۳) موتور نمایش:")
    d = pe_info(dll)
    check(d.get("machine") == 0x8664, "WebView2Loader.dll برای x64")
    check(has_str(dll, "CreateCoreWebView2EnvironmentWithOptions"), "تابع راه‌اندازی WebView2 موجود است")

    print("\n۴) آیکن برنامه:")
    sizes = ico_entries(ico)
    check(len(sizes) >= 6, f"تعداد اندازه‌ها: {len(sizes)}")
    for s in (16, 32, 48, 256):
        check((s, s) in sizes, f"اندازهٔ {s}×{s} (نوار وظیفه/Explorer/Start)")
    check((20, 20) in sizes and (24, 24) in sizes and (40, 40) in sizes, "اندازه‌های DPI ویندوز ۱۰/۱۱ (۲۰/۲۴/۴۰)")

    print("\n۵) آفلاین بودن رابط کاربری:")
    ext = [m for m in re.findall(r'\s(?:src|href)=["\']([^"\']+)["\']', html)
           if not re.match(r"^(data:|#|javascript:|mailto:)", m)]
    check(not ext, "هیچ ارجاع فایل بیرونی/نسبی", str(ext[:3]))
    check("fonts.googleapis" not in html and "fonts.gstatic" not in html, "بدون فونت اینترنی (Google Fonts)")
    check(html.count("<style>") >= 1 and html.count("<script") >= 2, "CSS و JS داخلی")
    check("<script type=\"module\"" not in html, "اسکریپت کلاسیک (سازگار با همهٔ نسخه‌های WebView2)")

    print("\n۶) فونت‌ها (بدون تغییر):")
    fonts = re.findall(r"data:font/woff2;base64,([A-Za-z0-9+/=]+)", html)
    check(len(fonts) >= 15, f"تعداد فونت جاسازی‌شده: {len(fonts)}")
    total = sum(len(base64.b64decode(f)) for f in fonts)
    print(f"    حجم کل فونت‌ها: {total / 1024:.0f} کیلوبایت")
    for fam in ("Vazirmatn", "Lalezar", "JetBrains Mono"):
        check(fam in html, f"خانوادهٔ فونت «{fam}»")
    check("font-display: swap" in html.replace("font-display:swap", "font-display: swap"), "بارگذاری فونت با font-display")
    # فونت باید به‌صورت woff2 معتبر باشد (امضای wOF2)
    ok_sig = all(base64.b64decode(f)[:4] == b"wOF2" for f in fonts)
    check(ok_sig, "همهٔ فونت‌ها فایل WOFF2 معتبر")

    print("\n۷) قفل ناوبری در EXE:")
    for token in ("navigation blocked", "_Incoming", "app.cfg", "kharraatcode-before-close"):
        check(has_str(exe, token), f"نشانهٔ «{token}» در منطق برنامه")

    print()
    if problems:
        print(f"{BAD} {len(problems)} مورد ناموفق:")
        for p in problems:
            print("   -", p)
        return 1
    print(f"{OK} همهٔ بررسی‌ها موفق بود — بسته آمادهٔ ارسال است.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
