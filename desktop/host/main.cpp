// =============================================================================
//  خراط‌کد (KharraatCode) — میزبان دسکتاپ ویندوز  |  نسخهٔ ۱.۰.۰
// -----------------------------------------------------------------------------
//  یک پنجرهٔ بومیِ سبک روی Microsoft Edge WebView2:
//    • بدون Node.js، بدون بستهٔ کامل کروم (Chromium) و بدون نیاز به باز کردن مرورگر
//    • رابط کاربری از فایل محلی  app/index.html  بارگذاری می‌شود  →  کاملاً آفلاین
//    • اندازهٔ پنجرهٔ ثابت؛ چیدمان برنامه با تغییر اندازه یا بزرگ‌نمایی تصادفی
//      به‌هم نمی‌ریزد
//    • تک‌نمونه‌ای؛ کلیک دوباره روی آیکن فقط پنجرهٔ موجود را جلو می‌آورد
//    • ناوبری مسدود است: کشیدن فایل روی پنجره یا کلیک روی لینک، صفحهٔ برنامه را
//      عوض نمی‌کند (فایل در پوشهٔ _Incoming ذخیره می‌شود)
//
//  ارتباط با راه‌انداز (اختیاری، از طریق stdin/stdout):
//    فرمان‌ها : reload | exit | title:<متن> | fullscreen:0/1
//    رویدادها: EV:ready | EV:loaded | EV:closing
// =============================================================================

#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX

#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <string>
#include <vector>
#include <mutex>
#include <thread>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <algorithm>

#include "WebView2.h"

#ifndef IFACEMETHODIMP
#define IFACEMETHODIMP HRESULT STDMETHODCALLTYPE
#endif

// -----------------------------------------------------------------------------
//  WebView2 Loader — بارگذاری پویا (تا نبودِ DLL پیام فارسی و روشن بدهد)
// -----------------------------------------------------------------------------

typedef HRESULT(STDMETHODCALLTYPE* PFN_CreateCoreWebView2EnvironmentWithOptions)(
    PCWSTR browserExecutableFolder, PCWSTR userDataFolder, ICoreWebView2EnvironmentOptions* environmentOptions,
    ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler* environmentCreatedHandler);

static PFN_CreateCoreWebView2EnvironmentWithOptions g_createEnvWithOptions = nullptr;

// -----------------------------------------------------------------------------
//  ابزارهای عمومی
// -----------------------------------------------------------------------------

static std::wstring Utf8ToWide(const std::string& s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), nullptr, 0);
    std::wstring out((size_t)n, 0);
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), &out[0], n);
    return out;
}

static std::string WideToUtf8(const std::wstring& s) {
    if (s.empty()) return {};
    int n = WideCharToMultiByte(CP_UTF8, 0, s.c_str(), (int)s.size(), nullptr, 0, nullptr, nullptr);
    std::string out((size_t)n, 0);
    WideCharToMultiByte(CP_UTF8, 0, s.c_str(), (int)s.size(), &out[0], n, nullptr, nullptr);
    return out;
}

static std::string Trim(const std::string& s) {
    size_t a = s.find_first_not_of(" \t\r\n");
    if (a == std::string::npos) return {};
    size_t b = s.find_last_not_of(" \t\r\n");
    return s.substr(a, b - a + 1);
}

static std::wstring TrimW(std::wstring s) {
    while (!s.empty() && (s.front() == L' ' || s.front() == L'\t' || s.front() == L'\r')) s.erase(s.begin());
    while (!s.empty() && (s.back() == L' ' || s.back() == L'\t' || s.back() == L'\r')) s.pop_back();
    return s;
}

static std::wstring ExeDir() {
    wchar_t buf[MAX_PATH * 4] = {0};
    DWORD n = GetModuleFileNameW(nullptr, buf, MAX_PATH * 4);
    std::wstring p(buf, n);
    size_t slash = p.find_last_of(L"\\/");
    return slash == std::wstring::npos ? std::wstring(L".") : p.substr(0, slash);
}

static std::wstring JoinPath(const std::wstring& a, const std::wstring& b) {
    if (a.empty()) return b;
    if (a.back() == L'\\' || a.back() == L'/') return a + b;
    return a + L"\\" + b;
}

static bool FileExists(const std::wstring& p) {
    DWORD a = GetFileAttributesW(p.c_str());
    return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

static bool DirExists(const std::wstring& p) {
    DWORD a = GetFileAttributesW(p.c_str());
    return a != INVALID_FILE_ATTRIBUTES && (a & FILE_ATTRIBUTE_DIRECTORY);
}

static void MakeDirs(const std::wstring& path) {
    std::wstring cur;
    for (size_t i = 0; i < path.size(); ++i) {
        cur += path[i];
        if (path[i] == L'\\' || path[i] == L'/') {
            if (cur.size() > 3) CreateDirectoryW(cur.c_str(), nullptr);
        }
    }
    CreateDirectoryW(path.c_str(), nullptr);
}

static std::string ReadSmallFileUtf8(const std::wstring& path) {
    std::string out;
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return out;
    char buf[8192];
    DWORD got = 0;
    while (ReadFile(h, buf, sizeof(buf), &got, nullptr) && got > 0) out.append(buf, got);
    CloseHandle(h);
    if (out.size() >= 3 && (unsigned char)out[0] == 0xEF && (unsigned char)out[1] == 0xBB &&
        (unsigned char)out[2] == 0xBF)
        out.erase(0, 3);
    return out;
}

#define APP_VERSION "1.0.0"

static void Log(const std::string& msg);

static void WriteSmallFileUtf8(const std::wstring& path, const std::string& data) {
    HANDLE h = CreateFileW(path.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, CREATE_ALWAYS,
                           FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return;
    DWORD wrote = 0;
    WriteFile(h, data.data(), (DWORD)data.size(), &wrote, nullptr);
    CloseHandle(h);
}

static void DeleteTree(const std::wstring& dir) {
    std::wstring pattern = JoinPath(dir, L"*");
    WIN32_FIND_DATAW fd;
    HANDLE h = FindFirstFileW(pattern.c_str(), &fd);
    if (h != INVALID_HANDLE_VALUE) {
        do {
            if (wcscmp(fd.cFileName, L".") == 0 || wcscmp(fd.cFileName, L"..") == 0) continue;
            std::wstring child = JoinPath(dir, fd.cFileName);
            if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
                DeleteTree(child);
            } else {
                SetFileAttributesW(child.c_str(), FILE_ATTRIBUTE_NORMAL);
                DeleteFileW(child.c_str());
            }
        } while (FindNextFileW(h, &fd));
        FindClose(h);
    }
    RemoveDirectoryW(dir.c_str());
}

// هنگام نصب نسخهٔ جدید (یا اولین اجرا) فقط کش‌های موتور نمایش پاک می‌شوند تا
// رابط کاربری قدیمی از حافظه بارگذاری نشود؛ پروژه‌ها و تنظیمات کاربر دست‌نخورده
// می‌مانند (localStorage در EBWebView\Default\Local Storage است).
static void EnsureUserDataFresh(const std::wstring& userDataDir) {
    std::wstring stamp = JoinPath(userDataDir, L".appversion");
    std::string current = ReadSmallFileUtf8(stamp);
    if (Trim(current) == APP_VERSION) return;

    const wchar_t* cacheDirs[] = {L"EBWebView\\Default\\Cache", L"EBWebView\\Default\\Code Cache",
                                  L"EBWebView\\Default\\GPUCache", L"EBWebView\\GrShaderCache",
                                  L"EBWebView\\ShaderCache", L"EBWebView\\Default\\DawnCache",
                                  L"EBWebView\\component_crx_cache"};
    for (const auto* rel : cacheDirs) {
        std::wstring p = JoinPath(userDataDir, rel);
        if (DirExists(p)) DeleteTree(p);
    }
    WriteSmallFileUtf8(stamp, std::string(APP_VERSION) + "\r\n");
    Log("cache reset for version " APP_VERSION);
}

// -----------------------------------------------------------------------------
//  تنظیمات: app.cfg در کنار فایل اجرایی (همهٔ کلیدها اختیاری)
//    title=...        عنوان پنجره
//    width=1440       عرض ناحیهٔ نمایش (پیکسل)
//    height=880       ارتفاع ناحیهٔ نمایش
//    fixed=1          اندازهٔ ثابت پنجره
//    page=app\index.html
//    icon=app.ico
//    zoom=0           غیرفعال‌کردن بزرگ‌نمایی مرورگر (پیش‌فرض)
//    devtools=0
//    log=            نام فایل لاگ (خالی = بدون لاگ)
//    userdata=       پوشهٔ دادهٔ WebView2
// -----------------------------------------------------------------------------

struct Config {
    std::wstring title = L"خراط‌کد — شبیه‌ساز و تولید جی‌کد خراطی CNC";
    int width = 1440;
    int height = 880;
    bool fixedSize = true;
    std::wstring page = L"app\\index.html";
    std::wstring icon = L"app.ico";
    std::wstring userDataDir;
    std::wstring logFile;
    std::wstring deepLink;
    bool devTools = false;
    bool allowZoom = false;
    bool downloadNotify = true;   // اولین بار، محل ذخیرهٔ خروجی را نشان بده
    std::wstring downloadDir;     // پوشهٔ پیش‌فرض ذخیرهٔ خروجی‌ها (خالی = Documents\KharraatCode)
};

static Config LoadConfig(const std::wstring& exeDir) {
    Config c;
    std::string raw = ReadSmallFileUtf8(JoinPath(exeDir, L"app.cfg"));
    std::wstring file = Utf8ToWide(raw);
    size_t pos = 0;
    while (pos <= file.size()) {
        size_t nl = file.find_first_of(L"\r\n", pos);
        if (nl == std::wstring::npos) nl = file.size();
        std::wstring line = file.substr(pos, nl - pos);
        if (nl >= file.size()) pos = file.size() + 1;
        else pos = nl + 1;
        size_t eq = line.find(L'=');
        if (eq == std::wstring::npos) continue;
        std::wstring key = TrimW(line.substr(0, eq));
        std::wstring val = TrimW(line.substr(eq + 1));
        if (val.size() >= 2 && val.front() == L'"' && val.back() == L'"') val = val.substr(1, val.size() - 2);
        if (key == L"title" && !val.empty()) c.title = val;
        else if (key == L"width") c.width = (std::max)(720, _wtoi(val.c_str()));
        else if (key == L"height") c.height = (std::max)(520, _wtoi(val.c_str()));
        else if (key == L"fixed") c.fixedSize = (_wtoi(val.c_str()) != 0);
        else if (key == L"page" && !val.empty()) c.page = val;
        else if (key == L"icon" && !val.empty()) c.icon = val;
        else if (key == L"userdata" && !val.empty()) c.userDataDir = val;
        else if (key == L"log" && !val.empty()) c.logFile = val;
        else if (key == L"deeplink" && !val.empty()) c.deepLink = val;
        else if (key == L"devtools") c.devTools = (_wtoi(val.c_str()) != 0);
        else if (key == L"zoom") c.allowZoom = (_wtoi(val.c_str()) != 0);
        else if (key == L"downloadnotify") c.downloadNotify = (_wtoi(val.c_str()) != 0);
        else if (key == L"downloaddir" && !val.empty()) c.downloadDir = val;
    }
    return c;
}

// -----------------------------------------------------------------------------
//  لاگ (اختیاری)
// -----------------------------------------------------------------------------

static std::wstring g_logPath;
static std::mutex g_logMutex;

static void Log(const std::string& msg) {
    if (g_logPath.empty()) return;
    std::lock_guard<std::mutex> lock(g_logMutex);
    HANDLE h = CreateFileW(g_logPath.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                           OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return;
    SetFilePointer(h, 0, nullptr, FILE_END);
    SYSTEMTIME st;
    GetLocalTime(&st);
    char stamp[64];
    snprintf(stamp, sizeof(stamp), "%04d-%02d-%02d %02d:%02d:%02d  ", st.wYear, st.wMonth, st.wDay, st.wHour,
             st.wMinute, st.wSecond);
    std::string body = std::string(stamp) + msg + "\r\n";
    DWORD wrote = 0;
    WriteFile(h, body.data(), (DWORD)body.size(), &wrote, nullptr);
    CloseHandle(h);
}

// -----------------------------------------------------------------------------
//  وضعیت کلی برنامه
// -----------------------------------------------------------------------------

static HWND g_hwnd = nullptr;
static ICoreWebView2Controller* g_controller = nullptr;
static ICoreWebView2* g_webview = nullptr;
static Config g_cfg;
static std::wstring g_exeDir;
static std::wstring g_homeUrl;
static std::wstring g_title;
static std::atomic<bool> g_closing{false};
static bool g_allowExit = false;
static bool g_envRetried = false;
static bool g_hatPipe = false;
static bool g_notifiedDownload = false;
static std::wstring g_lastDownload;
static std::wstring g_noticeDir;
static int g_fixedW = 0;   // اندازهٔ قطعی پنجره (شامل قاب) برای حالت اندازهٔ ثابت
static int g_fixedH = 0;

#define WM_APP_COMMAND (WM_APP + 1)
#define WM_APP_LOADED (WM_APP + 2)
#define WM_APP_READY (WM_APP + 3)
#define WM_APP_NOTICE (WM_APP + 4)

static std::string UrlDecode(const std::string& in) {
    std::string out;
    out.reserve(in.size());
    for (size_t i = 0; i < in.size(); ++i) {
        if (in[i] == '%' && i + 2 < in.size()) {
            auto hex = [](char c) -> int {
                if (c >= '0' && c <= '9') return c - '0';
                if (c >= 'a' && c <= 'f') return c - 'a' + 10;
                if (c >= 'A' && c <= 'F') return c - 'A' + 10;
                return -1;
            };
            int hi = hex(in[i + 1]), lo = hex(in[i + 2]);
            if (hi >= 0 && lo >= 0) {
                out.push_back((char)((hi << 4) | lo));
                i += 2;
                continue;
            }
        }
        out.push_back(in[i]);
    }
    return out;
}

// -----------------------------------------------------------------------------
//  کلیپ‌بورد ویندوز (تا دکمهٔ «کپی جی‌کد» بدون مجوز مرورگر هم کار کند)
// -----------------------------------------------------------------------------

static bool SetClipboardUtf8(const std::wstring& text) {
    if (!OpenClipboard(g_hwnd)) return false;
    bool ok = false;
    if (EmptyClipboard()) {
        size_t bytes = (text.size() + 1) * sizeof(wchar_t);
        HGLOBAL mem = GlobalAlloc(GMEM_MOVEABLE, bytes);
        if (mem) {
            void* dst = GlobalLock(mem);
            if (dst) {
                memcpy(dst, text.c_str(), bytes);
                GlobalUnlock(mem);
                if (SetClipboardData(CF_UNICODETEXT, mem)) ok = true;
                else GlobalFree(mem);
            } else {
                GlobalFree(mem);
            }
        }
    }
    CloseClipboard();
    return ok;
}

// اسکریپت کوچکی که فقط اجازهٔ نوشتن در کلیپ‌بورد را از موتور نمایش می‌گیرد
static const wchar_t* kClipboardGrantScript =
    L"(function(){try{var c=navigator.clipboard;if(!c||!c.writeText)return;var orig=c.writeText.bind(c);"
    L"c.writeText=function(t){try{return orig(t);}catch(e){"
    L"window.chrome.webview.postMessage(\"KC_CLIP:\"+encodeURIComponent(String(t)));"
    L"return Promise.resolve();}};}catch(e){}})();";

static void EmitEvent(const char* name) {
    if (!g_hatPipe) return;
    HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
    if (out == INVALID_HANDLE_VALUE || !out) return;
    DWORD wrote = 0;
    std::string line = std::string(name) + "\n";
    WriteFile(out, line.data(), (DWORD)line.size(), &wrote, nullptr);
}

// -----------------------------------------------------------------------------
//  مدیریت دستی COM (بدون WRL)
// -----------------------------------------------------------------------------

template <typename Iface>
class ComBase : public Iface {
  public:
    IFACEMETHODIMP_(ULONG) AddRef() override { return (ULONG)InterlockedIncrement(&ref_); }
    IFACEMETHODIMP_(ULONG) Release() override {
        LONG n = InterlockedDecrement(&ref_);
        if (n == 0) delete this;
        return (ULONG)n;
    }
    IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (IsIID(riid)) {
            *ppv = static_cast<Iface*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }

  protected:
    virtual bool IsIID(REFIID riid) = 0;
    virtual ~ComBase() = default;

  private:
    LONG ref_ = 1;
};

// -----------------------------------------------------------------------------
//  پیام‌های خطا برای کاربر
// -----------------------------------------------------------------------------

static void FatalMessage(const std::wstring& text) {
    Log("FATAL: " + WideToUtf8(text));
    MessageBoxW(nullptr, text.c_str(), L"خراط‌کد", MB_OK | MB_ICONERROR);
    ExitProcess(1);
}

static void WebView2MissingMessage(HRESULT hr) {
    wchar_t msg[1024];
    swprintf(msg, 1024,
             L"موتور نمایش «Microsoft Edge WebView2» روی این ویندوز پیدا نشد.\r\n\r\n"
             L"این موتور در ویندوز ۱۱ و بیشتر نسخه‌های ویندوز ۱۰ از پیش نصب است. اگر نبود، یک بار "
             L"بستهٔ «WebView2 Runtime» را از نشانی زیر نصب کنید (فقط یک بار، بدون نیاز به اینترنت پس از نصب):\r\n\r\n"
             L"https://developer.microsoft.com/microsoft-edge/webview2/\r\n\r\n"
             L"سپس برنامه را دوباره اجرا کنید.  کد خطا: 0x%08lX",
             (unsigned long)hr);
    FatalMessage(msg);
}

// -----------------------------------------------------------------------------
//  handlerها
// -----------------------------------------------------------------------------

class ControllerReadyHandler;

class EnvironmentReadyHandler : public ComBase<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler> {
  public:
    explicit EnvironmentReadyHandler(HWND hwnd) : hwnd_(hwnd) {}
    IFACEMETHODIMP Invoke(HRESULT result, ICoreWebView2Environment* env) override;

  protected:
    bool IsIID(REFIID riid) override { return riid == IID_ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler; }

  private:
    HWND hwnd_;
};

class NavigationDoneHandler : public ComBase<ICoreWebView2NavigationCompletedEventHandler> {
  public:
    IFACEMETHODIMP Invoke(ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) override {
        BOOL ok = FALSE;
        args->get_IsSuccess(&ok);
        if (ok) {
            // پشتیبان کپی در کلیپ‌بورد پس از هر بارگذاری دوباره نصب می‌شود
            g_webview->ExecuteScript(kClipboardGrantScript, nullptr);
            PostMessageW(g_hwnd, WM_APP_LOADED, 0, 0);
        } else {
            COREWEBVIEW2_WEB_ERROR_STATUS status = COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN;
            args->get_WebErrorStatus(&status);
            Log("navigation failed, status=" + std::to_string((int)status));
        }
        return S_OK;
    }

  protected:
    bool IsIID(REFIID riid) override { return riid == IID_ICoreWebView2NavigationCompletedEventHandler; }
};

// آدرس‌های مجاز: فقط فایل صفحهٔ خود برنامه (و about:blank که WebView2 در شروع می‌سازد)
static std::wstring g_appUrlPrefix;

static bool IsAppUrl(const std::wstring& url) {
    if (url.empty() || url == L"about:blank") return true;
    if (!g_appUrlPrefix.empty() && url.rfind(g_appUrlPrefix, 0) == 0) return true;
    return false;
}

// مجوزهای لازم (کلیپ‌بورد، فایل محلی) به‌صورت خودکار و بی‌پرسش تأیید می‌شوند؛
// بقیهٔ درخواست‌ها رد می‌شوند تا هیچ پنجرهٔ مزاحمی باز نشود.
class PermissionHandler : public ComBase<ICoreWebView2PermissionRequestedEventHandler> {
  public:
    IFACEMETHODIMP Invoke(ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs* args) override {
        COREWEBVIEW2_PERMISSION_KIND kind = COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
        args->get_PermissionKind(&kind);
        BOOL fromApp = FALSE;
        args->get_IsUserInitiated(&fromApp);
        // ۵ = OTHER (نوشتن در کلیپ‌بورد در WebView2های جدید)،
        // ۹ = CLIPBOARD_READ. فقط همین دو مجوز به‌صورت خودکار داده می‌شوند.
        bool allow = (kind == COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ) || ((int)kind == 5);
        args->put_State(allow ? COREWEBVIEW2_PERMISSION_STATE_ALLOW : COREWEBVIEW2_PERMISSION_STATE_DENY);
        return S_OK;
    }

  protected:
    bool IsIID(REFIID riid) override { return riid == IID_ICoreWebView2PermissionRequestedEventHandler; }
};

// کپی متن به کلیپ‌بورد از طریق پل پیام (به‌عنوان پشتیبان مطمئن)
class WebMessageHandler : public ComBase<ICoreWebView2WebMessageReceivedEventHandler> {
  public:
    IFACEMETHODIMP Invoke(ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) override {
        LPWSTR msg = nullptr;
        if (SUCCEEDED(args->get_WebMessageAsJson(&msg)) && msg) {
            std::wstring raw = msg;
            CoTaskMemFree(msg);
            const std::wstring key = L"KC_CLIP:";
            size_t at = raw.find(key);
            if (at != std::wstring::npos && raw.size() > at + key.size() + 1) {
                std::wstring payload = raw.substr(at + key.size());
                while (!payload.empty() && payload.back() == L'"') payload.pop_back();
                std::wstring text = Utf8ToWide(UrlDecode(WideToUtf8(payload)));
                SetClipboardUtf8(text);
            }
        }
        return S_OK;
    }

  protected:
    bool IsIID(REFIID riid) override { return riid == IID_ICoreWebView2WebMessageReceivedEventHandler; }
};

static void InstallDomHooks() {
    // درخواست خودکار مجوز کلیپ‌بورد
    ICoreWebView2_4* wv4 = nullptr;
    if (SUCCEEDED(g_webview->QueryInterface(IID_ICoreWebView2_4, (void**)&wv4)) && wv4) {
        wv4->add_PermissionRequested(new PermissionHandler(), nullptr);
        wv4->Release();
    }
    // پل پیام برای کپی در کلیپ‌بورد
    ICoreWebView2_2* wv2 = nullptr;
    if (SUCCEEDED(g_webview->QueryInterface(IID_ICoreWebView2_2, (void**)&wv2)) && wv2) {
        EventRegistrationToken tok;
        wv2->add_WebMessageReceived(new WebMessageHandler(), &tok);
        wv2->Release();
    }
    g_webview->ExecuteScript(kClipboardGrantScript, nullptr);
}

// ذخیرهٔ خروجی‌ها (جی‌کد، DXF، پروژه): به‌جای تکیه بر رفتار پیش‌فرض موتور،
// فایل دقیقاً در پوشهٔ مشخص ذخیره می‌شود تا کاربر همیشه بداند کجاست.
class DownloadHandler : public ComBase<ICoreWebView2DownloadStartingEventHandler> {
  public:
    IFACEMETHODIMP Invoke(ICoreWebView2* sender, ICoreWebView2DownloadStartingEventArgs* args) override {
        LPWSTR current = nullptr;
        args->get_ResultFilePath(&current);
        std::wstring name = current ? current : L"kharraatcode-output";
        if (current) CoTaskMemFree(current);
        size_t slash = name.find_last_of(L'\\');
        if (slash != std::wstring::npos) name = name.substr(slash + 1);
        if (name.empty()) name = L"kharraatcode-output";
        for (auto& ch : name)
            if (ch == L'\\' || ch == L'/' || ch == L':' || ch == L'*' || ch == L'?' || ch == L'"' || ch == L'<' ||
                ch == L'>' || ch == L'|')
                ch = L'-';

        std::wstring dir = DownloadDir();
        MakeDirs(dir);
        std::wstring dest = UniquePath(JoinPath(dir, name));

        args->put_ResultFilePath(dest.c_str());
        args->put_Handled(TRUE);

        Log("download -> " + WideToUtf8(dest));
        g_lastDownload = dest;

        if (g_cfg.downloadNotify && !g_notifiedDownload) {
            g_notifiedDownload = true;
            // نمایش پیام و باز کردن پوشه بعد از پایان این رویداد انجام می‌شود
            // (نمایش مودال داخل callback موتور نمایش امن نیست)
            g_noticeDir = dir;
            PostMessageW(g_hwnd, WM_APP_NOTICE, 0, 0);
        }
        return S_OK;
    }

  protected:
    bool IsIID(REFIID riid) override { return riid == IID_ICoreWebView2DownloadStartingEventHandler; }

  private:
    static std::wstring DownloadDir() {
        if (!g_cfg.downloadDir.empty()) return g_cfg.downloadDir;
        wchar_t* docs = nullptr;
        if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Documents, 0, nullptr, &docs)) && docs) {
            std::wstring base = docs;
            CoTaskMemFree(docs);
            return JoinPath(base, L"KharraatCode");
        }
        return JoinPath(g_exeDir, L"_Exports");
    }

    static std::wstring UniquePath(const std::wstring& path) {
        if (!FileExists(path)) return path;
        size_t dot = path.find_last_of(L'.');
        std::wstring stem = (dot == std::wstring::npos) ? path : path.substr(0, dot);
        std::wstring ext = (dot == std::wstring::npos) ? L"" : path.substr(dot);
        for (int i = 2; i < 1000; ++i) {
            std::wstring candidate = stem + L" (" + std::to_wstring(i) + L")" + ext;
            if (!FileExists(candidate)) return candidate;
        }
        return path;
    }
};

// نقشهٔ امنیتی اصلی: هر ناوبری خارج از صفحهٔ برنامه لغو می‌شود. این کار جلوی
// «پریدن» صفحه هنگام کشیدن فایل روی پنجره، کلیک روی لینک یا فشردن تصادفی کلیدها
// را می‌گیرد؛ فایلِ کشیده‌شده فقط در پوشهٔ _Incoming کپی می‌شود.
class NavigationStartingHandler : public ComBase<ICoreWebView2NavigationStartingEventHandler> {
  public:
    IFACEMETHODIMP Invoke(ICoreWebView2* sender, ICoreWebView2NavigationStartingEventArgs* args) override {
        LPWSTR uri = nullptr;
        args->get_Uri(&uri);
        std::wstring url = uri ? uri : L"";
        if (uri) CoTaskMemFree(uri);

        if (IsAppUrl(url)) return S_OK;

        args->put_Cancel(TRUE);
        Log("navigation blocked: " + WideToUtf8(url));

        if (url.rfind(L"file:///", 0) == 0) {
            std::wstring path = url.substr(8);
            for (auto& ch : path)
                if (ch == L'/') ch = L'\\';
            size_t cut = path.find(L'?');
            if (cut != std::wstring::npos) path = path.substr(0, cut);
            if (FileExists(path)) {
                std::wstring name = path.substr(path.find_last_of(L'\\') + 1);
                std::wstring dir = JoinPath(g_exeDir, L"_Incoming");
                MakeDirs(dir);
                std::wstring dest = JoinPath(dir, name);
                CopyFileW(path.c_str(), dest.c_str(), FALSE);
                Log("incoming file copied: " + WideToUtf8(dest));
            }
        }
        return S_OK;
    }

  protected:
    bool IsIID(REFIID riid) override { return riid == IID_ICoreWebView2NavigationStartingEventHandler; }
};

// بزرگ‌نمایی صفحه (Ctrl+wheel / pinch) همیشه روی ۱۰۰٪ نگه داشته می‌شود تا
// چیدمان پنل‌ها هرگز به‌هم نریزد.
class ZoomGuard : public ComBase<ICoreWebView2ZoomFactorChangedEventHandler> {
  public:
    IFACEMETHODIMP Invoke(ICoreWebView2Controller* sender, IUnknown*) override {
        double z = 1.0;
        if (SUCCEEDED(sender->get_ZoomFactor(&z)) && (z < 0.99 || z > 1.01)) {
            sender->put_ZoomFactor(1.0);
        }
        return S_OK;
    }

  protected:
    bool IsIID(REFIID riid) override { return riid == IID_ICoreWebView2ZoomFactorChangedEventHandler; }
};

class NewWindowHandler : public ComBase<ICoreWebView2NewWindowRequestedEventHandler> {
  public:
    IFACEMETHODIMP Invoke(ICoreWebView2* sender, ICoreWebView2NewWindowRequestedEventArgs* args) override {
        LPWSTR uri = nullptr;
        args->get_Uri(&uri);
        std::wstring url = uri ? uri : L"";
        if (uri) CoTaskMemFree(uri);

        // پنجرهٔ جدید هرگز باز نمی‌شود؛ صفحهٔ فعلی هم عوض نمی‌شود
        args->put_Handled(TRUE);

        if (url.rfind(L"app://", 0) == 0) {
            // لینک‌های داخلی (مثل ورود به حساب) به‌صورت رویداد به برنامه داده می‌شوند
            std::wstring target = url.substr(6);
            std::wstring script =
                L"window.dispatchEvent(new CustomEvent('kharraatcode-link',{detail:'" + target + L"'}));";
            sender->ExecuteScript(script.c_str(), nullptr);
            return S_OK;
        }

        if (url.rfind(L"file:///", 0) == 0) {
            // فایل کشیده‌شده روی پنجره: فقط کپی می‌شود، برنامه بارگذاری نمی‌شود
            std::wstring path = url.substr(8);
            for (auto& ch : path)
                if (ch == L'/') ch = L'\\';
            if (FileExists(path)) {
                std::wstring name = path.substr(path.find_last_of(L'\\') + 1);
                std::wstring dir = JoinPath(g_exeDir, L"_Incoming");
                MakeDirs(dir);
                std::wstring dest = JoinPath(dir, name);
                CopyFileW(path.c_str(), dest.c_str(), FALSE);
                Log("incoming file copied: " + WideToUtf8(dest));
            }
            return S_OK;
        }

        if (url.rfind(L"http://", 0) == 0 || url.rfind(L"https://", 0) == 0 || url.rfind(L"mailto:", 0) == 0) {
            ShellExecuteW(nullptr, L"open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
        }
        return S_OK;
    }

  protected:
    bool IsIID(REFIID riid) override { return riid == IID_ICoreWebView2NewWindowRequestedEventHandler; }
};

class ControllerReadyHandler : public ComBase<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler> {
  public:
    explicit ControllerReadyHandler(HWND hwnd) : hwnd_(hwnd) {}
    IFACEMETHODIMP Invoke(HRESULT result, ICoreWebView2Controller* controller) override;

  protected:
    bool IsIID(REFIID riid) override { return riid == IID_ICoreWebView2CreateCoreWebView2ControllerCompletedHandler; }

  private:
    HWND hwnd_;
};

IFACEMETHODIMP EnvironmentReadyHandler::Invoke(HRESULT result, ICoreWebView2Environment* env) {
    if (FAILED(result) || !env) {
        // یک بار دیگر با پوشهٔ دادهٔ موقت تلاش می‌کنیم (مثلاً اگر پوشهٔ کنار
        // برنامه فقط خواندنی بود)
        if (!g_envRetried) {
            g_envRetried = true;
            wchar_t tmp[MAX_PATH] = {0};
            GetTempPathW(MAX_PATH, tmp);
            std::wstring alt = JoinPath(std::wstring(tmp), L"KharraatCode-WebView2");
            MakeDirs(alt);
            Log("retry env with temp user data: " + WideToUtf8(alt));
            HRESULT hr = g_createEnvWithOptions
                             ? g_createEnvWithOptions(nullptr, alt.c_str(), nullptr, new EnvironmentReadyHandler(hwnd_))
                             : E_FAIL;
            if (SUCCEEDED(hr)) return S_OK;
        }
        WebView2MissingMessage(result);
        return S_OK;
    }

    HRESULT hr = env->CreateCoreWebView2Controller(hwnd_, new ControllerReadyHandler(hwnd_));
    if (FAILED(hr)) {
        WebView2MissingMessage(hr);
    }
    return S_OK;
}

IFACEMETHODIMP ControllerReadyHandler::Invoke(HRESULT result, ICoreWebView2Controller* controller) {
    if (FAILED(result) || !controller) {
        WebView2MissingMessage(result);
        return S_OK;
    }

    g_controller = controller;
    g_controller->AddRef();

    if (FAILED(g_controller->get_CoreWebView2(&g_webview)) || !g_webview) {
        FatalMessage(L"دسترسی به موتور نمایش برنامه ممکن نشد. لطفاً برنامه را دوباره اجرا کنید.");
        return S_OK;
    }

    RECT rc;
    GetClientRect(hwnd_, &rc);
    g_controller->put_Bounds(rc);
    g_controller->put_IsVisible(TRUE);

    ICoreWebView2Settings* settings = nullptr;
    if (SUCCEEDED(g_webview->get_Settings(&settings)) && settings) {
        settings->put_AreDefaultContextMenusEnabled(FALSE);
        settings->put_AreDevToolsEnabled(g_cfg.devTools ? TRUE : FALSE);
        settings->put_IsStatusBarEnabled(FALSE);
        settings->put_AreHostObjectsAllowed(FALSE);
        settings->put_IsZoomControlEnabled(g_cfg.allowZoom ? TRUE : FALSE);
        settings->put_IsBuiltInErrorPageEnabled(TRUE);
        settings->Release();
    }

    // بستن میان‌برهای مرورگری (F5 / Ctrl+R / Ctrl+P / F12) تا صفحهٔ برنامه
    // به‌طور تصادفی بارگذاری نشود (WebView2 نسخه‌های جدید)
    {
        ICoreWebView2Settings* s1 = nullptr;
        if (SUCCEEDED(g_webview->get_Settings(&s1)) && s1) {
            ICoreWebView2Settings3* s3 = nullptr;
            if (SUCCEEDED(s1->QueryInterface(IID_ICoreWebView2Settings3, (void**)&s3)) && s3) {
                s3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
                s3->Release();
            }
            s1->Release();
        }
    }

    ICoreWebView2Controller2* controller2 = nullptr;
    if (SUCCEEDED(g_controller->QueryInterface(IID_ICoreWebView2Controller2, (void**)&controller2)) && controller2) {
        COREWEBVIEW2_COLOR bg = {255, 20, 16, 11};  // A,R,G,B — پس‌زمینهٔ تیرهٔ برنامه
        controller2->put_DefaultBackgroundColor(bg);
        controller2->Release();
    }

    // ذخیرهٔ خروجی‌ها (نیازمند WebView2 نسخهٔ 1.0.1108+؛ در نسخه‌های قدیمی‌تر
    // بی‌صدا رد می‌شود و رفتار پیش‌فرض موتور استفاده می‌گردد)
    {
        ICoreWebView2_4* wv4 = nullptr;
        if (SUCCEEDED(g_webview->QueryInterface(IID_ICoreWebView2_4, (void**)&wv4)) && wv4) {
            wv4->add_DownloadStarting(new DownloadHandler(), nullptr);
            wv4->Release();
        }
    }

    g_webview->add_NavigationStarting(new NavigationStartingHandler(), nullptr);
    InstallDomHooks();
    g_webview->add_NavigationCompleted(new NavigationDoneHandler(), nullptr);
    g_webview->add_NewWindowRequested(new NewWindowHandler(), nullptr);
    g_controller->add_ZoomFactorChanged(new ZoomGuard(), nullptr);
    g_controller->put_ZoomFactor(1.0);

    HRESULT hr = g_webview->Navigate(g_homeUrl.c_str());
    Log(std::string("navigate ") + (SUCCEEDED(hr) ? "ok " : "failed ") + WideToUtf8(g_homeUrl));
    if (FAILED(hr)) {
        FatalMessage(L"بارگذاری رابط کاربری برنامه ممکن نشد.\r\n\r\n"
                     L"لطفاً مطمئن شوید پوشهٔ «app» کنار فایل اجرایی است و فایل ZIP را کامل استخراج کرده‌اید.");
    }
    return S_OK;
}

// -----------------------------------------------------------------------------
//  آیکن‌ها
// -----------------------------------------------------------------------------

static HICON g_iconBig = nullptr;
static HICON g_iconSmall = nullptr;

static void LoadAppIcons() {
    g_iconBig = (HICON)LoadImageW(GetModuleHandleW(nullptr), MAKEINTRESOURCEW(1), IMAGE_ICON,
                                  GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON), LR_DEFAULTCOLOR);
    g_iconSmall = (HICON)LoadImageW(GetModuleHandleW(nullptr), MAKEINTRESOURCEW(1), IMAGE_ICON,
                                    GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_DEFAULTCOLOR);
    if (!g_iconBig || !g_iconSmall) {
        std::wstring icoPath = JoinPath(g_exeDir, g_cfg.icon);
        if (FileExists(icoPath)) {
            if (!g_iconBig)
                g_iconBig = (HICON)LoadImageW(nullptr, icoPath.c_str(), IMAGE_ICON, GetSystemMetrics(SM_CXICON),
                                              GetSystemMetrics(SM_CYICON), LR_LOADFROMFILE);
            if (!g_iconSmall)
                g_iconSmall = (HICON)LoadImageW(nullptr, icoPath.c_str(), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON),
                                                GetSystemMetrics(SM_CYSMICON), LR_LOADFROMFILE);
        }
    }
    if (!g_iconBig) g_iconBig = LoadIconW(nullptr, IDI_APPLICATION);
    if (!g_iconSmall) g_iconSmall = LoadIconW(nullptr, IDI_APPLICATION);
}

static void ApplyWindowIcons(HWND hwnd) {
    if (g_iconBig) SendMessageW(hwnd, WM_SETICON, ICON_BIG, (LPARAM)g_iconBig);
    if (g_iconSmall) SendMessageW(hwnd, WM_SETICON, ICON_SMALL, (LPARAM)g_iconSmall);
}

// -----------------------------------------------------------------------------
//  فرمان‌های ورودی
// -----------------------------------------------------------------------------

static void RunCommand(const std::wstring& cmdIn) {
    std::wstring cmd = TrimW(cmdIn);
    if (cmd.empty()) return;
    if (cmd == L"reload") {
        if (g_webview) g_webview->Reload();
    } else if (cmd == L"exit" || cmd == L"quit") {
        g_allowExit = true;
        DestroyWindow(g_hwnd);
    } else if (cmd.rfind(L"title:", 0) == 0) {
        g_title = cmd.substr(6);
        SetWindowTextW(g_hwnd, g_title.c_str());
    }
}

// -----------------------------------------------------------------------------
//  پنجره
// -----------------------------------------------------------------------------

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
        case WM_CREATE:
            ApplyWindowIcons(hwnd);
            return 0;

        case WM_SIZE:
            if (g_controller) {
                RECT rc;
                GetClientRect(hwnd, &rc);
                g_controller->put_Bounds(rc);
            }
            return 0;

        case WM_GETMINMAXINFO: {
            if (g_cfg.fixedSize && g_fixedW > 0 && g_fixedH > 0) {
                MINMAXINFO* mmi = (MINMAXINFO*)lParam;
                RECT work;
                SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0);
                int maxW = (std::min)(g_fixedW, (int)(work.right - work.left));
                int maxH = (std::min)(g_fixedH, (int)(work.bottom - work.top));
                mmi->ptMaxTrackSize.x = maxW;
                mmi->ptMaxTrackSize.y = maxH;
                mmi->ptMinTrackSize.x = maxW;
                mmi->ptMinTrackSize.y = maxH;
            }
            return 0;
        }

        case WM_SYSCOMMAND:
            if (g_cfg.fixedSize && wParam == SC_MAXIMIZE) return 0;
            break;

        case WM_CLOSE: {
            if (g_allowExit || !g_webview) {
                g_allowExit = true;
                DestroyWindow(hwnd);
                return 0;
            }
            if (!g_closing.exchange(true)) {
                EmitEvent("EV:closing");
                // به صفحه یک لحظه فرصت می‌دهیم وضعیت خود را ذخیره کند، سپس
                // پنجره بسته می‌شود (هیچ‌وقت بیش از ۰٫۴ ثانیه معطل نمی‌ماند)
                g_webview->ExecuteScript(L"window.dispatchEvent(new Event('kharraatcode-before-close'))", nullptr);
                SetTimer(hwnd, 1, 400, nullptr);
            }
            return 0;
        }

        case WM_TIMER:
            if (wParam == 1) {
                KillTimer(hwnd, 1);
                g_allowExit = true;
                if (g_controller) g_controller->Close();
                DestroyWindow(hwnd);
            }
            return 0;

        case WM_DESTROY:
            PostQuitMessage(0);
            return 0;

        case WM_APP_COMMAND: {
            wchar_t* text = (wchar_t*)lParam;
            if (text) {
                RunCommand(text);
                free(text);
            }
            return 0;
        }

        case WM_APP_LOADED:
            EmitEvent("EV:loaded");
            return 0;

        case WM_APP_READY:
            EmitEvent("EV:ready");
            return 0;

        case WM_APP_NOTICE: {
            if (!g_noticeDir.empty()) {
                std::wstring msg = L"فایل خروجی ذخیره شد در پوشهٔ:\r\n\r\n" + g_noticeDir +
                                   L"\r\n\r\nاین پوشه همین حالا باز می‌شود؛ در دفعات بعد فایل‌ها "
                                   L"مستقیماً همین‌جا ذخیره می‌شوند.";
                MessageBoxW(hwnd, msg.c_str(), L"خراط‌کد — ذخیرهٔ خروجی", MB_OK | MB_ICONINFORMATION);
                ShellExecuteW(nullptr, L"open", g_noticeDir.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
                g_noticeDir.clear();
            }
            return 0;
        }

        case WM_ENDSESSION:
            // خاموش‌شدن ویندوز: بدون پرسش بسته می‌شویم
            g_allowExit = true;
            return 0;

        default:
            break;
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

// -----------------------------------------------------------------------------
//  خواندن فرمان‌ها از stdin (بدون قفل‌کردن پنجره)
// -----------------------------------------------------------------------------

static void StdinThread() {
    HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
    if (!in || in == INVALID_HANDLE_VALUE) return;
    if (GetFileType(in) != FILE_TYPE_PIPE) return;  // اجرای مستقیم؛ فرمانی در کار نیست

    std::string pending;
    char buf[4096];
    DWORD got = 0;
    while (ReadFile(in, buf, sizeof(buf), &got, nullptr) && got > 0) {
        pending.append(buf, got);
        size_t nl;
        while ((nl = pending.find('\n')) != std::string::npos) {
            std::string line = Trim(pending.substr(0, nl));
            pending.erase(0, nl + 1);
            if (line.empty()) continue;
            std::wstring w = Utf8ToWide(line);
            wchar_t* copy = (wchar_t*)malloc((w.size() + 1) * sizeof(wchar_t));
            if (!copy) continue;
            memcpy(copy, w.c_str(), (w.size() + 1) * sizeof(wchar_t));
            if (!PostMessageW(g_hwnd, WM_APP_COMMAND, 0, (LPARAM)copy)) free(copy);
        }
    }
    // پایان stdin: پنجره بسته نمی‌شود (اجرای مستقیم با دوبار کلیک هم بی‌خطر است)
    Log("stdin closed");
}

// -----------------------------------------------------------------------------
//  راه‌اندازی
// -----------------------------------------------------------------------------

static void EnableDpi() {
    HMODULE user32 = LoadLibraryW(L"user32.dll");
    if (user32) {
        typedef BOOL(WINAPI * PFN_SetCtx)(HANDLE);
        PFN_SetCtx fn = (PFN_SetCtx)GetProcAddress(user32, "SetProcessDpiAwarenessContext");
        // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
        if (fn && fn((HANDLE)-4)) return;
    }
    SetProcessDPIAware();
}

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE, LPWSTR, int) {
    EnableDpi();

    HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
    g_hatPipe = (out && out != INVALID_HANDLE_VALUE && GetFileType(out) == FILE_TYPE_PIPE);

    g_exeDir = ExeDir();
    g_cfg = LoadConfig(g_exeDir);
    g_title = g_cfg.title;
    if (!g_cfg.logFile.empty()) g_logPath = JoinPath(g_exeDir, g_cfg.logFile);

    Log("=== start ================================================");
    Log("exe dir: " + WideToUtf8(g_exeDir));

    // تک‌نمونه‌ای — از باز شدن چند پنجره روی هم جلوگیری می‌کند
    HANDLE once = CreateMutexW(nullptr, FALSE, L"KharraatCode_SingleInstance_1");
    if (once && GetLastError() == ERROR_ALREADY_EXISTS) {
        HWND prev = FindWindowW(L"KharraatCodeMainWindow", nullptr);
        if (prev) {
            if (IsIconic(prev)) ShowWindow(prev, SW_RESTORE);
            SetForegroundWindow(prev);
        }
        return 0;
    }

    // بررسی فایل‌های همراه
    if (!DirExists(JoinPath(g_exeDir, L"app"))) {
        FatalMessage(L"پوشهٔ «app» در کنار فایل اجرایی پیدا نشد.\r\n\r\n"
                     L"کل پوشهٔ نرم‌افزار را از فایل ZIP استخراج کنید و سپس KharraatCode.exe را اجرا کنید.");
        return 1;
    }
    std::wstring pagePath = JoinPath(g_exeDir, g_cfg.page);
    if (!FileExists(pagePath)) {
        FatalMessage(L"فایل «app\\index.html» پیدا نشد. لطفاً فایل ZIP را کامل و دوباره استخراج کنید.");
        return 1;
    }

    // بارگذاری پویا تا پیام خطای فارسی و واضح بدهیم
    HMODULE loader = LoadLibraryW(JoinPath(g_exeDir, L"WebView2Loader.dll").c_str());
    if (!loader) loader = LoadLibraryW(L"WebView2Loader.dll");
    if (!loader) {
        FatalMessage(L"فایل WebView2Loader.dll در کنار برنامه پیدا نشد.\r\n\r\n"
                     L"لطفاً همهٔ فایل‌های ZIP را با هم استخراج کنید (فایل‌ها را تک‌به‌تک جابه‌جا نکنید).");
        return 1;
    }
    g_createEnvWithOptions =
        (PFN_CreateCoreWebView2EnvironmentWithOptions)GetProcAddress(loader, "CreateCoreWebView2EnvironmentWithOptions");
    if (!g_createEnvWithOptions) {
        FatalMessage(L"نسخهٔ WebView2Loader.dll با این برنامه سازگار نیست. لطفاً فایل ZIP را دوباره استخراج کنید.");
        return 1;
    }

    // نشانی محلی صفحه؛ نسخه در آدرس می‌آید تا کش قدیمی استفاده نشود
    std::wstring url = L"file:///";
    for (auto ch : pagePath) url += (ch == L'\\') ? L'/' : ch;
    g_homeUrl = url + L"?v=" + Utf8ToWide(APP_VERSION);
    g_appUrlPrefix = url;

    // پوشهٔ دادهٔ WebView2 کنار برنامه؛ اگر پوشهٔ برنامه قابل نوشتن نبود
    // (مثلاً نصب در Program Files) به AppData کاربر می‌رود
    if (g_cfg.userDataDir.empty()) {
        std::wstring local = JoinPath(g_exeDir, L"_UserData");
        MakeDirs(local);
        bool writable = false;
        if (DirExists(local)) {
            std::wstring probe = JoinPath(local, L".write-test");
            HANDLE h = CreateFileW(probe.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
                                   FILE_ATTRIBUTE_TEMPORARY, nullptr);
            if (h != INVALID_HANDLE_VALUE) {
                writable = true;
                CloseHandle(h);
                DeleteFileW(probe.c_str());
            }
        }
        if (!writable) {
            wchar_t* appdata = nullptr;
            if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &appdata)) && appdata) {
                local = JoinPath(appdata, L"KharraatCode");
                CoTaskMemFree(appdata);
            }
        }
        g_cfg.userDataDir = local;
    }
    MakeDirs(g_cfg.userDataDir);
    EnsureUserDataFresh(g_cfg.userDataDir);
    Log("user data: " + WideToUtf8(g_cfg.userDataDir));

    LoadAppIcons();

    WNDCLASSEXW wc;
    memset(&wc, 0, sizeof(wc));
    wc.cbSize = sizeof(wc);
    wc.style = CS_HREDRAW | CS_VREDRAW | CS_DBLCLKS;
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInst;
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = CreateSolidBrush(RGB(20, 16, 11));
    wc.lpszClassName = L"KharraatCodeMainWindow";
    wc.hIcon = g_iconBig;
    wc.hIconSm = g_iconSmall;
    if (!RegisterClassExW(&wc)) {
        FatalMessage(L"ثبت پنجرهٔ برنامه ناموفق بود.");
        return 1;
    }

    DWORD style = WS_OVERLAPPEDWINDOW;
    if (g_cfg.fixedSize) style &= ~(WS_MAXIMIZEBOX | WS_THICKFRAME);

    // اندازهٔ پنجره بر اساس DPI نمایشگر مقیاس می‌شود تا روی نمایشگرهای
    // HiDPI (۱۲۵٪/۱۵۰٪) هم اندازهٔ دیده‌شدهٔ برنامه طبیعی بماند
    UINT dpi = 96;
    {
        HMODULE u32 = GetModuleHandleW(L"user32.dll");
        if (u32) {
            typedef UINT(WINAPI * PFN_GetDpiForSystem)();
            PFN_GetDpiForSystem gd = (PFN_GetDpiForSystem)GetProcAddress(u32, "GetDpiForSystem");
            if (gd) dpi = gd();
        }
    }
    int scaleW = (int)((double)g_cfg.width * dpi / 96.0);
    int scaleH = (int)((double)g_cfg.height * dpi / 96.0);

    RECT rc = {0, 0, scaleW, scaleH};
    AdjustWindowRectEx(&rc, style, FALSE, 0);
    int winW = rc.right - rc.left;
    int winH = rc.bottom - rc.top;

    RECT work;
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0);
    int workW = work.right - work.left;
    int workH = work.bottom - work.top;
    if (winW > workW - 32) winW = workW - 32;
    if (winH > workH - 32) winH = workH - 32;
    int px = work.left + (workW - winW) / 2;
    int py = work.top + (workH - winH) / 2;

    g_fixedW = winW;
    g_fixedH = winH;

    g_hwnd = CreateWindowExW(0, L"KharraatCodeMainWindow", g_title.c_str(), style, px, py, winW, winH, nullptr,
                             nullptr, hInst, nullptr);
    if (!g_hwnd) {
        FatalMessage(L"ایجاد پنجرهٔ برنامه ناموفق بود.");
        return 1;
    }

    ShowWindow(g_hwnd, SW_SHOW);
    UpdateWindow(g_hwnd);
    ApplyWindowIcons(g_hwnd);

    HRESULT hrCo = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hrCo) && hrCo != RPC_E_CHANGED_MODE) {
        FatalMessage(L"راه‌اندازی اجزای ویندوز ناموفق بود (CoInitializeEx).");
        return 1;
    }

    EmitEvent("EV:ready");

    HRESULT hr = g_createEnvWithOptions(nullptr, g_cfg.userDataDir.c_str(), nullptr, new EnvironmentReadyHandler(g_hwnd));
    if (FAILED(hr)) {
        WebView2MissingMessage(hr);
        return 1;
    }

    std::thread stdinThread(StdinThread);
    stdinThread.detach();

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    g_allowExit = true;
    Log("=== exit =================================================");
    if (g_webview) {
        g_webview->Release();
        g_webview = nullptr;
    }
    if (g_controller) {
        g_controller->Release();
        g_controller = nullptr;
    }
    CoUninitialize();
    return 0;
}
