#!/usr/bin/env node
/**
 * خراط‌کد — تبدیل خروجی Vite به یک فایل HTML خودبسنده و کاملاً آفلاین
 *
 * همهٔ CSS، JavaScript و فونت‌ها داخل خودِ HTML قرار می‌گیرند (فونت‌ها به‌صورت
 * base64 و بایت‌به‌بایت همان فایل‌های اصلی Vazirmatn / Lalezar / JetBrains Mono).
 * نتیجه: هیچ درخواست شبکه‌ای، هیچ مسیر نسبی و هیچ وابستگی به مرورگر بیرونی
 * وجود ندارد؛ فایل روی file:// هم بدون خطا اجرا می‌شود.
 *
 * استفاده:  node tools/bundle-html.mjs <dist-dir> <out-file>
 */

import fs from "node:fs";
import path from "node:path";

const distDir = path.resolve(process.argv[2] ?? "dist");
const outFile = path.resolve(process.argv[3] ?? "build/app/index.html");

const MIME = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

const stats = { fonts: 0, images: 0, css: 0, js: 0 };
const seen = new Set();

/** مسیر محلی داخل dist را می‌خواند و به data URI تبدیل می‌کند */
function toDataUri(ref) {
  const clean = decodeURIComponent(ref.split("#")[0].split("?")[0]);
  const file = path.join(distDir, clean.replace(/^\/+/, ""));
  if (!fs.existsSync(file)) {
    throw new Error(`فایل ارجاع‌شده پیدا نشد: ${ref} → ${file}`);
  }
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`نوع فایل پشتیبانی نمی‌شود: ${ref}`);
  const buf = fs.readFileSync(file);
  seen.add(file);
  if (ext === ".woff2" || ext === ".woff" || ext === ".ttf" || ext === ".otf") stats.fonts++;
  else stats.images++;
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** همهٔ url(...) داخل CSS را با data URI جایگزین می‌کند */
function inlineCssUrls(css, base = "") {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, _q, ref) => {
    if (/^(data:|https?:|blob:|#)/i.test(ref)) return all;
    let target = ref;
    if (base && !ref.startsWith("/")) target = path.posix.join(base, ref);
    return `url("${toDataUri(target)}")`;
  });
}

function inlineCssFile(absFile) {
  const base = "/" + path.posix.dirname(path.relative(distDir, absFile)).replace(/\\/g, "/");
  const css = fs.readFileSync(absFile, "utf8");
  return inlineCssUrls(css, base);
}

/** اسکریپت را برای قرار گرفتن داخل HTML ایمن می‌کند */
function safeScript(js) {
  return js
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "<\\!--");
}

let html = fs.readFileSync(path.join(distDir, "index.html"), "utf8");

// ۱) استایل‌ها
html = html.replace(
  /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi,
  (tag) => {
    const m = tag.match(/href=["']([^"']+)["']/i);
    if (!m) return "";
    if (/^https?:/i.test(m[1])) return ""; // هیچ منبع بیرونی مجاز نیست
    const file = path.join(distDir, m[1].replace(/^\/+/, "").split("?")[0]);
    if (!fs.existsSync(file)) throw new Error(`CSS پیدا نشد: ${m[1]}`);
    stats.css++;
    return `<style>\n${inlineCssFile(file)}\n</style>`;
  }
);

// ۲) اسکریپت‌ها — به‌صورت اسکریپت کلاسیک (IIFE) در انتهای body
//    دلیل: ماژول ES روی همهٔ نسخه‌های WebView2 و روی file:// رفتار یکسان ندارد؛
//    اسکریپت کلاسیک در همه‌جا بدون خطا اجرا می‌شود و چون در انتهای body است،
//    DOM کاملاً آماده است.
const collectedScripts = [];
html = html.replace(
  /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi,
  (all, pre, src, post) => {
    if (/^https?:/i.test(src)) return "";
    const file = path.join(distDir, src.replace(/^\/+/, "").split("?")[0]);
    if (!fs.existsSync(file)) throw new Error(`JS پیدا نشد: ${src}`);
    collectedScripts.push(fs.readFileSync(file, "utf8"));
    stats.js++;
    return "";
  }
);

// ۳) تصاویر/آیکن‌های محلی که در HTML مانده‌اند
html = html.replace(/\b(src|href)=["'](\/[^"']+\.(?:png|jpe?g|svg|webp|gif|ico))["']/gi, (all, attr, ref) => {
  try {
    return `${attr}="${toDataUri(ref)}"`;
  } catch {
    return all;
  }
});

// ۴) بررسی نهایی: هیچ ارجاع بیرونی/نسبی باقی نماند
const leftovers = [...html.matchAll(/\s(?:src|href)=["']([^"']+)["']/gi)]
  .map((m) => m[1])
  .filter((v) => !/^(data:|#|javascript:|mailto:)/i.test(v));
if (leftovers.length) {
  console.warn("هشدار: ارجاع‌های باقی‌مانده:", leftovers.slice(0, 10));
}

// ۲٫۵) اسکریپت‌ها را به انتهای body منتقل می‌کنیم
if (collectedScripts.length) {
  const wrapped = collectedScripts
    .map((js) => `<script>\n/* خراط‌کد — بستهٔ اجرایی */\n(function () {\n"use strict";\n${safeScript(js)}\n})();\n</script>`)
    .join("\n");
  // نکته: جایگزینی با تابع انجام می‌شود تا الگوهای $& و $' داخل JS
  // به‌اشتباه تفسیر و متن تکرار نشوند
  if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, () => `${wrapped}\n</body>`);
  else html += wrapped;
}

// ۵) پشتیبان امن برای localStorage (در برخی تنظیمات سخت‌گیرانه file:// غیرفعال است)
const shim = `<script>
/* پشتیبان ایمن: اگر مرورگر ذخیره‌سازی محلی را مسدود کرده باشد، برنامه باز هم
   بدون خطا اجرا می‌شود (فقط تنظیمات میان نشست‌ها نگه داشته نمی‌شوند). */
(function(){
  try { localStorage.setItem("__kc_probe__","1"); localStorage.removeItem("__kc_probe__"); return; } catch (e) {}
  var mem = {};
  try {
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem: function(k){ return Object.prototype.hasOwnProperty.call(mem,String(k)) ? mem[String(k)] : null; },
      setItem: function(k,v){ mem[String(k)] = String(v); },
      removeItem: function(k){ delete mem[String(k)]; },
      clear: function(){ mem = {}; },
      key: function(i){ return Object.keys(mem)[i] || null; },
      get length(){ return Object.keys(mem).length; }
    }});
  } catch (e) {}
})();
</script>`;

html = html.replace("</head>", () => `${shim}\n</head>`);

// ۶) نشانه‌گذاری نسخه برای عیب‌یابی
const buildStamp = `<meta name="kharraatcode-build" content="${new Date().toISOString()}">\n</head>`;
html = html.replace("</head>", () => buildStamp);

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html, "utf8");

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log("✔ HTML خودبسنده ساخته شد:", outFile);
console.log(
  `  اندازه: ${kb(Buffer.byteLength(html))}  |  فونت: ${stats.fonts}  تصویر: ${stats.images}  CSS: ${stats.css}  JS: ${stats.js}`
);
if (leftovers.length) process.exitCode = 1;
