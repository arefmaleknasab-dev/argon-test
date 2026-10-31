import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DEFAULT_HOLDER2, MAX_INNER_DISTANCE, MIN_HOLDER2_OFFSET, MIN_INNER_DISTANCE, type SegKind } from "../lib/lathe";
import {
  BUILTIN_THEMES,
  DEFAULT_THEME_COLORS,
  THEME_CATEGORIES,
  areThemeColorsEqual,
  getThemeBaseColors,
  isBuiltInThemeId,
  normalizeHexColor,
  normalizeLiveHexInput,
  parseThemeFile,
  rgbaCss,
  sanitizeThemeColors,
  segColorFromTheme,
  serializeThemeFile,
  toPersianDigits,
  type CustomThemePreset,
  type ThemeCategoryIcon,
  type ThemeColorKey,
  type ThemeColors,
} from "../lib/theme";
import { cn } from "../utils/cn";
import { IconSettings, IconX } from "./icons";

export interface AppPreferences {
  theme: string;
  themeColors: ThemeColors;
  customThemes: CustomThemePreset[];
  profileColor: string;
  selectedColor: string;
  guideColor: string;
  lineWidth: number;
  /** مقیاس یکپارچه همه نشانگرها و نقاط هندسی روی بوم. */
  pointScale: number;
  /** حذف کامل افکت Glow انتخاب برای کاهش بار رندر. */
  disableSelectionGlow: boolean;
  toolbarScale: number;
  /** نگه‌داری تغییرات تأییدنشده پس از خروج از ویرایش مسیر. */
  keepEditDraft: boolean;
  /** نمایش و فعال‌بودن ابزار نقاشی جهت‌دار روی بوم. */
  showCanvasPaintTool: boolean;
  /** استفاده از پنجره بومی ویندوز برای Save As؛ در حالت خاموش نام‌گذاری داخل برنامه است. */
  useWindowsSaveDialog: boolean;
  /** راست‌کلیک روی فضای خالی بین ابزار فعلی و قبلی سوییچ کند. */
  rightClickToolToggle: boolean;
  /** رفتار قدیمی: دسته‌های کنترلی فقط پس از انتخاب قبلی خط وارد Box Selection شوند. */
  deferMarqueeControlPoints: boolean;
  historyLimit: number;
  showHeaderImportAi: boolean;
  showHeaderExportDxf: boolean;
  showHeaderCopyGcode: boolean;
  showHeaderDownloadNc: boolean;
  shortcuts: Record<string, string>;
  postProcessor: "fanuc" | "linuxcnc" | "generic";
  gcodeUnits: "mm" | "inch";
  sequenceNumbers: boolean;
  gcodeFormat: "modal" | "std";
  continuousPaths: boolean;
  safeBottomInnerLink: boolean;
  /** الگوریتم ساده‌سازی اتصال‌های محدوده آبی. */
  innerBoundaryRoutingMode:
    | "linear"
    | "expBinary"
    | "compact"
    | "orthogonal"
    | "nearest"
    | "rawBoundary"
    | "rdp"
    | "shortCode"
    | "offsetOptimized";
  optimizeFeeds: boolean;
  spreadRapid: boolean;
  spindleSpeed: number;
  defaultGcodeShiftX: number;
  defaultGcodeShiftY: number;
  defaultInnerStartClearance: number;
  defaultInnerEndTravel: number;
  defaultHolder2XOff: number;
  defaultHolder2YOff: number;
  operationFeeds: Record<string, number>;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: "lathe",
  themeColors: { ...DEFAULT_THEME_COLORS },
  customThemes: [],
  profileColor: DEFAULT_THEME_COLORS.profileOuter,
  selectedColor: DEFAULT_THEME_COLORS.profileSelected,
  guideColor: DEFAULT_THEME_COLORS.pathEditSelected,
  lineWidth: 2,
  pointScale: 1,
  disableSelectionGlow: true,
  toolbarScale: 1,
  keepEditDraft: false,
  showCanvasPaintTool: true,
  useWindowsSaveDialog: false,
  rightClickToolToggle: true,
  deferMarqueeControlPoints: false,
  historyLimit: 40,
  showHeaderImportAi: false,
  showHeaderExportDxf: false,
  showHeaderCopyGcode: false,
  showHeaderDownloadNc: true,
  shortcuts: {
    select: "v",
    move: "m",
    rotate: "r",
    boxscale: "b",
    scale: "s",
    copy: "c",
    mirror: "i",
    fillet: "f",
    trim: "t",
    line: "l",
    polyline: "p",
    quad: "q",
    cubic: "u",
    arc: "a",
    split: "x",
  },
  postProcessor: "fanuc",
  gcodeUnits: "mm",
  sequenceNumbers: true,
  gcodeFormat: "modal",
  continuousPaths: true,
  safeBottomInnerLink: true,
  innerBoundaryRoutingMode: "offsetOptimized",
  optimizeFeeds: true,
  spreadRapid: false,
  spindleSpeed: 1500,
  defaultGcodeShiftX: 0,
  defaultGcodeShiftY: 0,
  defaultInnerStartClearance: 2,
  defaultInnerEndTravel: 300,
  defaultHolder2XOff: DEFAULT_HOLDER2.xOff,
  defaultHolder2YOff: DEFAULT_HOLDER2.yOff,
  operationFeeds: {
    round: 2000,
    face: 100,
    rough: 2000,
    roughz: 2000,
    copy: 2000,
    offset: 500,
    finish: 100,
    bottom: 300,
    bore: 300,
    boreoff: 300,
    borefin: 150,
  },
};

const FEED_LABELS: [SegKind, string][] = [
  ["round", "گرد کردن گوشه‌ها"],
  ["face", "پیشانی‌تراشی"],
  ["rough", "خشن بیرون"],
  ["offset", "آفست"],
  ["finish", "پرداخت نهایی"],
  ["bottom", "کف‌تراشی"],
  ["bore", "خشن داخل"],
  ["boreoff", "آفست داخل"],
  ["borefin", "پرداخت داخل"],
];

const SHORTCUT_LABELS: Record<string, string> = {
  select: "انتخاب",
  move: "حرکت",
  rotate: "چرخش",
  boxscale: "مقیاس باکس",
  scale: "مقیاس مرجع",
  copy: "کپی",
  mirror: "آینه",
  fillet: "فیلت",
  trim: "برش (Trim)",
  line: "خط",
  polyline: "چندخطی",
  quad: "منحنی درجه دو",
  cubic: "منحنی بزیه",
  arc: "قوس",
  split: "تقسیم",
};

function CategoryIcon({ kind }: { kind: ThemeCategoryIcon }) {
  switch (kind) {
    case "ui":
      return (
        <svg viewBox="0 0 18 18" className="h-4 w-4 shrink-0 text-brass" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="2" y="2.5" width="14" height="13" rx="2" />
          <path d="M2 6.5h14M6.5 6.5v9" />
        </svg>
      );
    case "editor":
      return (
        <svg viewBox="0 0 18 18" className="h-4 w-4 shrink-0 text-brass" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 14c2.5-6 6-8.5 12-9" strokeLinecap="round" />
          <circle cx="3" cy="14" r="1.7" fill="currentColor" />
          <circle cx="15" cy="5" r="1.7" fill="currentColor" />
          <circle cx="8" cy="5.5" r="1.3" />
          <path d="M3 14 8 5.5" strokeDasharray="2 2" />
        </svg>
      );
    case "pathedit":
      return (
        <svg viewBox="0 0 18 18" className="h-4 w-4 shrink-0 text-brass" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 13.5 7.5 6l4 5 3.5-6.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="3" cy="13.5" r="1.6" />
          <circle cx="15" cy="4.5" r="1.6" />
        </svg>
      );
    case "ops":
      return (
        <svg viewBox="0 0 18 18" className="h-4 w-4 shrink-0 text-brass" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M2.5 5h13M2.5 9h10M2.5 13h7" strokeLinecap="round" />
          <path d="m13 10.5 2.5 2.5L13 15.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "view3d":
      return (
        <svg viewBox="0 0 18 18" className="h-4 w-4 shrink-0 text-brass" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M9 2 15.5 5.6v6.8L9 16 2.5 12.4V5.6Z" strokeLinejoin="round" />
          <path d="M9 16V9.2M15.5 5.6 9 9.2 2.5 5.6" strokeLinejoin="round" />
        </svg>
      );
    case "sim":
      return (
        <svg viewBox="0 0 18 18" className="h-4 w-4 shrink-0 text-brass" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="2" y="5" width="4" height="8" rx="0.8" />
          <path d="M6 6.8h6.5L15 9l-2.5 2.2H6" strokeLinejoin="round" />
          <path d="M12.5 13.5 15 16" strokeLinecap="round" />
        </svg>
      );
    case "gcode":
      return (
        <svg viewBox="0 0 18 18" className="h-4 w-4 shrink-0 text-brass" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="m6 5-3.5 4L6 13M12 5l3.5 4L12 13M10 3.5 8 14.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

function ThemeColorRow({
  label,
  color,
  onChange,
}: {
  label: string;
  color: string;
  onChange: (hex: string) => void;
}) {
  const hexCode = color.toUpperCase();
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const commitDraft = (raw: string | null) => {
    if (raw !== null) {
      const parsed = normalizeHexColor(raw);
      if (parsed) onChange(parsed);
    }
    setDraft(null);
  };

  return (
    <div className="flex items-center justify-between gap-2.5 rounded-lg border border-edge/85 bg-bg/75 px-3 py-2 transition-colors hover:border-edge2">
      <span className="min-w-0 truncate text-[11.5px] font-bold text-ink/95" title={label}>
        {label}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <label
          className="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-white/15 shadow-inner transition-transform hover:scale-105"
          style={{ backgroundColor: color }}
          title={`انتخاب رنگ (${hexCode})`}
        >
          <input
            type="color"
            value={normalizeHexColor(color) ?? "#000000"}
            onChange={(e) => {
              const clean = normalizeHexColor(e.target.value);
              if (clean) onChange(clean);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <input
          type="text"
          dir="ltr"
          value={draft ?? hexCode}
          title={`کد رنگی (${hexCode})`}
          onFocus={(e) => {
            setFocused(true);
            e.currentTarget.select();
          }}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            const live = normalizeLiveHexInput(next);
            if (live) onChange(live);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft(draft);
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
          onBlur={() => {
            setFocused(false);
            commitDraft(draft);
          }}
          className={cn(
            "h-7 w-[82px] rounded-md border px-1.5 text-center font-mono text-[10.5px] font-bold tracking-tight outline-none transition-colors",
            draft !== null && draft.toUpperCase() !== hexCode
              ? "border-brass/75 bg-bg text-brass2"
              : focused
                ? "border-brass/70 bg-bg text-ink"
                : "border-edge2 bg-bg/85 text-ink hover:border-brass/45"
          )}
        />
      </div>
    </div>
  );
}

export default function PreferencesDialog({
  value,
  snapTolerance,
  onChange,
  onSnapTolerance,
  onClose,
}: {
  value: AppPreferences;
  snapTolerance: number;
  onChange: (next: AppPreferences) => void;
  onSnapTolerance: (value: number) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"general" | "theme" | "appearance" | "snap" | "post" | "shortcuts">("general");
  const [query, setQuery] = useState("");
  const [frame, setFrame] = useState(() => ({
    x: Math.max(12, Math.round((window.innerWidth - Math.min(880, window.innerWidth - 24)) / 2)),
    y: Math.max(12, Math.round((window.innerHeight - Math.min(620, window.innerHeight - 24)) / 2)),
    w: Math.min(880, window.innerWidth - 24),
    h: Math.min(620, window.innerHeight - 24),
  }));
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const resize = useRef<{ edge: string; x: number; y: number; frame: typeof frame } | null>(null);

  /* وضعیت‌های بخش مدیریت تم */
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const presetMenuRef = useRef<HTMLDivElement>(null);
  const themeFileInputRef = useRef<HTMLInputElement>(null);
  const [addingTheme, setAddingTheme] = useState(false);
  const [newThemeName, setNewThemeName] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(THEME_CATEGORIES.map((c) => [c.id, true]))
  );
  const [themeFeedback, setThemeFeedback] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (!presetMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (presetMenuRef.current && !presetMenuRef.current.contains(e.target as Node)) {
        setPresetMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [presetMenuOpen]);

  useEffect(() => {
    if (!themeFeedback) return;
    const timer = window.setTimeout(() => setThemeFeedback(null), 3200);
    return () => window.clearTimeout(timer);
  }, [themeFeedback]);

  const patch = (p: Partial<AppPreferences>) => onChange({ ...value, ...p });

  const moveFrame = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (d) {
      setFrame((f) => ({
        ...f,
        x: Math.max(0, Math.min(window.innerWidth - 80, d.left + e.clientX - d.x)),
        y: Math.max(0, Math.min(window.innerHeight - 40, d.top + e.clientY - d.y)),
      }));
    }
    const r = resize.current;
    if (!r) return;
    const dx = e.clientX - r.x;
    const dy = e.clientY - r.y;
    let { x, y, w, h } = r.frame;
    if (r.edge.includes("e")) w = Math.max(520, Math.min(window.innerWidth - x, w + dx));
    if (r.edge.includes("s")) h = Math.max(360, Math.min(window.innerHeight - y, h + dy));
    if (r.edge.includes("w")) {
      const nw = Math.max(520, w - dx);
      x = Math.max(0, x + w - nw);
      w = nw;
    }
    if (r.edge.includes("n")) {
      const nh = Math.max(360, h - dy);
      y = Math.max(0, y + h - nh);
      h = nh;
    }
    setFrame({ x, y, w, h });
  };

  const beginResize = (edge: string) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    resize.current = { edge, x: e.clientX, y: e.clientY, frame: { ...frame } };
    (e.currentTarget.parentElement as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const themeColors = value.themeColors ?? DEFAULT_THEME_COLORS;
  const customThemes = value.customThemes ?? [];
  const allThemePresets = [
    ...BUILTIN_THEMES,
    ...customThemes.map((t) => ({
      id: t.id,
      name: t.name,
      builtIn: false,
      colors: sanitizeThemeColors(t.colors),
    })),
  ];
  const currentPreset = allThemePresets.find((t) => t.id === value.theme) ?? BUILTIN_THEMES[0];
  const baseColorsOfCurrent = getThemeBaseColors(currentPreset.id, customThemes);
  const isCurrentModified = !areThemeColorsEqual(themeColors, baseColorsOfCurrent);
  const canDeleteCurrentTheme = !isBuiltInThemeId(currentPreset.id);

  const applyThemeColorsPatch = (nextColors: ThemeColors, nextThemeId = value.theme, nextCustoms = customThemes) => {
    onChange({
      ...value,
      theme: nextThemeId,
      customThemes: nextCustoms,
      themeColors: nextColors,
      profileColor: nextColors.profileOuter,
      selectedColor: nextColors.profileSelected,
      guideColor: nextColors.pathEditSelected,
    });
  };

  const setSingleThemeColor = (key: ThemeColorKey, hex: string) => {
    applyThemeColorsPatch({ ...themeColors, [key]: hex });
  };

  const selectPresetTheme = (presetId: string) => {
    const found = allThemePresets.find((t) => t.id === presetId);
    if (!found) return;
    setPresetMenuOpen(false);
    setAddingTheme(false);
    applyThemeColorsPatch({ ...found.colors }, found.id);
  };

  const handleOpenAddTheme = () => {
    const customCount = customThemes.length + 1;
    setNewThemeName(`${currentPreset.name} (${toPersianDigits(customCount)})`);
    setAddingTheme((v) => !v);
  };

  const handleConfirmAddTheme = () => {
    const trimmed = newThemeName.trim();
    if (!trimmed) return;
    const newPreset: CustomThemePreset = {
      id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed.slice(0, 60),
      colors: { ...themeColors },
    };
    const nextCustoms = [...customThemes, newPreset];
    setAddingTheme(false);
    setNewThemeName("");
    applyThemeColorsPatch({ ...themeColors }, newPreset.id, nextCustoms);
    setThemeFeedback({ text: `تم «${newPreset.name}» به فهرست تم‌های آماده اضافه شد ✓` });
  };

  const handleDeleteCurrentTheme = () => {
    if (!canDeleteCurrentTheme) return;
    const removedName = currentPreset.name;
    const remaining = customThemes.filter((t) => t.id !== currentPreset.id);
    const fallbackPreset = remaining.length > 0 ? remaining[remaining.length - 1] : BUILTIN_THEMES[0];
    applyThemeColorsPatch({ ...fallbackPreset.colors }, fallbackPreset.id, remaining);
    setThemeFeedback({ text: `تم «${removedName}» از تم‌های آماده حذف شد.` });
  };

  const handleResetCurrentTheme = () => {
    const base = getThemeBaseColors(currentPreset.id, customThemes);
    applyThemeColorsPatch(base, currentPreset.id);
    setThemeFeedback({ text: `رنگ‌های تم «${currentPreset.name}» به حالت پیش‌فرض بازگردانده شد ✓` });
  };

  const handleSaveThemeToFile = async () => {
    const json = serializeThemeFile(currentPreset.name, themeColors);
    const safeName = (currentPreset.name.replace(/[\\/:*?"<>|]/g, "-").trim() || "kharraat-theme") + ".khtheme.json";
    const winWithPicker = window as Window & {
      showSaveFilePicker?: (opts?: unknown) => Promise<{
        createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
      }>;
    };
    if (value.useWindowsSaveDialog && typeof winWithPicker.showSaveFilePicker === "function") {
      try {
        const handle = await winWithPicker.showSaveFilePicker({
          suggestedName: safeName,
          types: [{ description: "فایل تم خراط‌کد", accept: { "application/json": [".json"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        setThemeFeedback({ text: `فایل تم با موفقیت ذخیره شد ✓` });
        return;
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
      }
    }
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setThemeFeedback({ text: `فایل تم «${safeName}» ذخیره شد ✓` });
  };

  const handleImportThemeFile = async (file: File | null | undefined) => {
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = parseThemeFile(raw);
      if (!parsed) {
        setThemeFeedback({ text: "فایل انتخاب‌شده قالب معتبر تم خراط‌کد را ندارد.", error: true });
        return;
      }
      const newPreset: CustomThemePreset = {
        id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: parsed.name,
        colors: parsed.colors,
      };
      const nextCustoms = [...customThemes, newPreset];
      applyThemeColorsPatch(parsed.colors, newPreset.id, nextCustoms);
      setThemeFeedback({ text: `تم «${newPreset.name}» با موفقیت بارگذاری و اعمال شد ✓` });
    } catch {
      setThemeFeedback({ text: "خطا در خواندن فایل تم.", error: true });
    }
  };

  const q = query.trim();
  const themeSearchKeywords = THEME_CATEGORIES.map((c) => `${c.title} ${c.items.map((i) => i.label).join(" ")}`).join(" ");

  return (
    <div className="pointer-events-none fixed inset-0 z-[100]" dir="rtl">
      <section
        dir="ltr"
        className="anim-in pointer-events-auto absolute flex min-h-[360px] min-w-[520px] flex-col overflow-hidden rounded-xl border border-edge2 bg-panel/98 shadow-2xl shadow-black/70"
        style={{
          left: frame.x,
          top: frame.y,
          width: frame.w,
          height: frame.h,
          maxWidth: "calc(100vw - 16px)",
          maxHeight: "calc(100vh - 16px)",
        }}
        onPointerMove={moveFrame}
        onPointerUp={() => {
          drag.current = null;
          resize.current = null;
        }}
      >
        <div onPointerDown={beginResize("n")} className="absolute top-0 right-3 left-3 z-50 h-2 cursor-n-resize" />
        <div onPointerDown={beginResize("s")} className="absolute right-3 bottom-0 left-3 z-50 h-2 cursor-s-resize" />
        <div onPointerDown={beginResize("e")} className="absolute top-3 right-0 bottom-3 z-50 w-2 cursor-e-resize" />
        <div onPointerDown={beginResize("w")} className="absolute top-3 bottom-3 left-0 z-50 w-2 cursor-w-resize" />
        <div onPointerDown={beginResize("ne")} className="absolute top-0 right-0 z-[51] h-3 w-3 cursor-ne-resize" />
        <div onPointerDown={beginResize("nw")} className="absolute top-0 left-0 z-[51] h-3 w-3 cursor-nw-resize" />
        <div onPointerDown={beginResize("se")} className="absolute right-0 bottom-0 z-[51] h-3 w-3 cursor-se-resize" />
        <div onPointerDown={beginResize("sw")} className="absolute bottom-0 left-0 z-[51] h-3 w-3 cursor-sw-resize" />

        <header
          dir="rtl"
          className="flex cursor-move select-none items-center justify-between border-b border-edge bg-panel2/90 px-4 py-3"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("button,input")) return;
            drag.current = { x: e.clientX, y: e.clientY, left: frame.x, top: frame.y };
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
        >
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-brass/35 bg-brass/10 text-brass2">
              <IconSettings className="h-4.5 w-4.5" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-ink">Preferences</h2>
              <p className="text-[9.5px] text-dim">تنظیمات عمومی، رنگ‌بندی تم و خروجی خراط‌کد</p>
            </div>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جست‌وجوی تنظیمات یا بخش رنگی…"
            className="mx-4 h-8 min-w-0 flex-1 rounded-md border border-edge bg-bg/70 px-3 text-[11px] text-ink outline-none focus:border-teal"
          />
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md text-dim hover:bg-panel3 hover:text-ink">
            <IconX className="h-4 w-4" />
          </button>
        </header>

        <div dir="rtl" className="grid min-h-0 flex-1 grid-cols-[150px_1fr] overflow-hidden">
          <nav className="space-y-1 overflow-y-auto border-l border-edge bg-bg/45 p-2">
            {(
              [
                ["general", "تنظیمات عمومی", "پیش نویس ویرایش مسیر خروج تایید تغییرات"],
                ["theme", "تم نرم‌افزار", `تم رنگ کد رنگی ذخیره بارگذاری بازنشانی ${themeSearchKeywords}`],
                ["appearance", "خطوط و مقیاس بوم", "ظاهر ضخامت نوار ابزار دکمه اندازه نقطه glow"],
                ["snap", "اسنپ و دقت", "حساسیت پیکسل نقاط تقاطع محور"],
                ["shortcuts", "کلیدهای میانبر", "کیبورد ابزار انتخاب حرکت چرخش مقیاس کپی برش trim"],
                ["post", "تنظیمات جی‌کد", "سرعت فید عملیات فانوک لینوکس واحد میلیمتر اینچ شماره خط شیفت جابجایی افست هلدر دوم فاصله شروع پایان داخل تراشی"],
              ] as const
            )
              .filter(([, label, keywords]) => !q || `${label} ${keywords}`.toLowerCase().includes(q.toLowerCase()))
              .map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={cn(
                    "w-full rounded-md px-3 py-2 text-right text-[11px] font-bold transition-colors",
                    tab === id ? "bg-brass/18 text-brass2" : "text-mute hover:bg-panel3 hover:text-ink"
                  )}
                >
                  {label}
                </button>
              ))}
          </nav>

          <div className="overflow-y-auto p-4">
            {tab === "general" && (
              <div>
                <Title
                  title="تنظیمات عمومی"
                  text="رفتارهای عمومی نرم‌افزار"
                  onReset={() =>
                    patch({
                      keepEditDraft: DEFAULT_PREFERENCES.keepEditDraft,
                      showCanvasPaintTool: DEFAULT_PREFERENCES.showCanvasPaintTool,
                      useWindowsSaveDialog: DEFAULT_PREFERENCES.useWindowsSaveDialog,
                      rightClickToolToggle: DEFAULT_PREFERENCES.rightClickToolToggle,
                      deferMarqueeControlPoints: DEFAULT_PREFERENCES.deferMarqueeControlPoints,
                      historyLimit: DEFAULT_PREFERENCES.historyLimit,
                      showHeaderImportAi: DEFAULT_PREFERENCES.showHeaderImportAi,
                      showHeaderExportDxf: DEFAULT_PREFERENCES.showHeaderExportDxf,
                      showHeaderCopyGcode: DEFAULT_PREFERENCES.showHeaderCopyGcode,
                      showHeaderDownloadNc: DEFAULT_PREFERENCES.showHeaderDownloadNc,
                    })
                  }
                />
                <label className="mt-5 flex items-start gap-3 rounded-lg border border-edge bg-panel2 p-4 text-[11px] text-ink">
                  <input type="checkbox" checked={value.keepEditDraft} onChange={(e) => patch({ keepEditDraft: e.target.checked })} className="mt-0.5 accent-brass" />
                  <span>
                    <b className="block">حفظ پیش‌نویس ویرایش مسیر</b>
                    <small className="mt-1 block text-[9.5px] leading-5 text-dim">
                      هنگام خروج درباره تأیید تغییرات سؤال می‌شود؛ در صورت عدم تأیید، تنظیمات و جی‌کد قبلی نمایش داده می‌شود و با روشن‌بودن این گزینه، پیش‌نویس برای ورود بعدی نگه داشته می‌شود.
                    </small>
                  </span>
                </label>
                <label className="mt-4 flex items-start gap-3 rounded-lg border border-edge bg-panel2 p-4 text-[11px] text-ink">
                  <input type="checkbox" checked={value.showCanvasPaintTool} onChange={(e) => patch({ showCanvasPaintTool: e.target.checked })} className="mt-0.5 accent-brass" />
                  <span>
                    <b className="block">ابزار نقاشی جهت‌دار روی بوم</b>
                    <small className="mt-1 block text-[9.5px] leading-5 text-dim">ابزار نمایشی فلش‌دار را فعال می‌کند؛ این خطوط هیچ اثری روی G-code ندارند.</small>
                  </span>
                </label>
                <label className="mt-4 flex items-start gap-3 rounded-lg border border-edge bg-panel2 p-4 text-[11px] text-ink">
                  <input type="checkbox" checked={value.useWindowsSaveDialog} onChange={(e) => patch({ useWindowsSaveDialog: e.target.checked })} className="mt-0.5 accent-brass" />
                  <span>
                    <b className="block">پنجره ذخیره ویندوز برای Save As</b>
                    <small className="mt-1 block text-[9.5px] leading-5 text-dim">خاموش: نام‌گذاری داخل نرم‌افزار؛ روشن: پنجره انتخاب نام و مسیر ویندوز.</small>
                  </span>
                </label>
                <label className="mt-4 flex items-start gap-3 rounded-lg border border-edge bg-panel2 p-4 text-[11px] text-ink">
                  <input type="checkbox" checked={value.rightClickToolToggle} onChange={(e) => patch({ rightClickToolToggle: e.target.checked })} className="mt-0.5 accent-brass" />
                  <span>
                    <b className="block">تعویض ابزار با راست‌کلیک روی فضای خالی</b>
                    <small className="mt-1 block text-[9.5px] leading-5 text-dim">علاوه بر رفتار فعلی راست‌کلیک، کلیک روی فضای خالی بین ابزار فعلی و ابزار قبلی جابه‌جا می‌شود.</small>
                  </span>
                </label>
                <label className="mt-4 flex items-start gap-3 rounded-lg border border-edge bg-panel2 p-4 text-[11px] text-ink">
                  <input type="checkbox" checked={value.deferMarqueeControlPoints} onChange={(e) => patch({ deferMarqueeControlPoints: e.target.checked })} className="mt-0.5 accent-brass" />
                  <span>
                    <b className="block">انتخاب دسته‌های کنترل در مرحله دوم</b>
                    <small className="mt-1 block text-[9.5px] leading-5 text-dim">
                      روشن: رفتار قدیمی؛ Box Selection اول خط را انتخاب می‌کند و دسته‌های کنترلی فقط در انتخاب بعدی گرفته می‌شوند. خاموش: دسته‌ها از همان انتخاب اول انتخاب می‌شوند.
                    </small>
                  </span>
                </label>
                <label className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-edge bg-panel2 p-3 text-[11px] text-ink">
                  <span>
                    <b className="block">تعداد تغییرات Undo / Redo</b>
                    <small className="mt-1 block text-[9px] text-dim">حداکثر ۲۰۰ تغییر</small>
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    step={1}
                    value={value.historyLimit}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) patch({ historyLimit: Math.min(200, Math.max(1, Math.round(n))) });
                    }}
                    className="h-8 w-20 rounded border border-edge2 bg-bg px-2 text-center font-mono text-xs text-teal outline-none focus:border-teal"
                  />
                </label>
                <div className="mt-4">
                  <div className="mb-2 text-[11px] font-bold text-ink">دکمه‌های نوار بالای نرم‌افزار</div>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ["showHeaderImportAi", "ورود AI"],
                        ["showHeaderExportDxf", "خروجی DXF"],
                        ["showHeaderCopyGcode", "کپی جی‌کد"],
                        ["showHeaderDownloadNc", "دانلود CNC"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 rounded-md border border-edge bg-panel2 px-3 py-2 text-[10.5px] text-ink">
                        <input type="checkbox" checked={Boolean(value[key])} onChange={(e) => patch({ [key]: e.target.checked })} className="accent-brass" />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === "theme" && (
              <div className="space-y-3">
                <input
                  ref={themeFileInputRef}
                  type="file"
                  accept=".json,.khtheme,application/json"
                  hidden
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    void handleImportThemeFile(file);
                    e.currentTarget.value = "";
                  }}
                />

                {/* نوار ابزار مدیریت تم — چیدمان و دکمه‌ها دقیقاً مطابق تصویر مرجع */}
                <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-edge pb-3">
                  {/* سمت راست: تم‌های آماده + افزودن (+) + حذف (−) */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] font-bold text-mute">تم‌های آماده:</span>

                    <div ref={presetMenuRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setPresetMenuOpen((o) => !o)}
                        className="flex h-9 min-w-[205px] items-center justify-between gap-2 rounded-lg border border-edge2 bg-bg/80 px-3 text-[12px] font-bold text-brass2 transition-colors hover:border-brass/65"
                      >
                        <span className="flex min-w-0 items-center gap-1.5 truncate">
                          <span className="truncate">{currentPreset.name}</span>
                          {isCurrentModified && (
                            <span
                              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brass"
                              title="رنگ‌های این تم تغییر کرده‌اند"
                            />
                          )}
                        </span>
                        <svg
                          viewBox="0 0 16 16"
                          className={cn("h-3.5 w-3.5 shrink-0 text-mute transition-transform", presetMenuOpen && "rotate-180")}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                        >
                          <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>

                      {presetMenuOpen && (
                        <div className="absolute right-0 top-[calc(100%+5px)] z-40 max-h-72 w-64 overflow-y-auto rounded-lg border border-edge2 bg-panel p-1.5 shadow-2xl">
                          <div className="px-2 py-1 text-[10px] font-bold text-dim">تم‌های پیش‌فرض نرم‌افزار</div>
                          {BUILTIN_THEMES.map((preset) => {
                            const active = preset.id === currentPreset.id;
                            return (
                              <button
                                key={preset.id}
                                type="button"
                                onClick={() => selectPresetTheme(preset.id)}
                                className={cn(
                                  "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-right text-[11.5px] font-bold transition-colors",
                                  active ? "bg-brass/18 text-brass2" : "text-ink hover:bg-panel3"
                                )}
                              >
                                <span className="truncate">{preset.name}</span>
                                <span className="flex shrink-0 items-center gap-1">
                                  <span className="h-3 w-3 rounded-sm border border-white/15" style={{ backgroundColor: preset.colors.uiBg }} />
                                  <span className="h-3 w-3 rounded-sm border border-white/15" style={{ backgroundColor: preset.colors.uiAccent }} />
                                  <span className="h-3 w-3 rounded-sm border border-white/15" style={{ backgroundColor: preset.colors.uiSecondary }} />
                                </span>
                              </button>
                            );
                          })}

                          {customThemes.length > 0 && (
                            <>
                              <div className="my-1 border-t border-edge" />
                              <div className="px-2 py-1 text-[10px] font-bold text-dim">تم‌های افزوده‌شده توسط کاربر</div>
                              {customThemes.map((preset) => {
                                const active = preset.id === currentPreset.id;
                                return (
                                  <button
                                    key={preset.id}
                                    type="button"
                                    onClick={() => selectPresetTheme(preset.id)}
                                    className={cn(
                                      "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-right text-[11.5px] font-bold transition-colors",
                                      active ? "bg-brass/18 text-brass2" : "text-ink hover:bg-panel3"
                                    )}
                                  >
                                    <span className="truncate">{preset.name}</span>
                                    <span className="flex shrink-0 items-center gap-1">
                                      <span className="h-3 w-3 rounded-sm border border-white/15" style={{ backgroundColor: preset.colors.uiBg }} />
                                      <span className="h-3 w-3 rounded-sm border border-white/15" style={{ backgroundColor: preset.colors.uiAccent }} />
                                      <span className="h-3 w-3 rounded-sm border border-white/15" style={{ backgroundColor: preset.colors.uiSecondary }} />
                                    </span>
                                  </button>
                                );
                              })}
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* دکمه + افزودن تم فعلی به تم‌های آماده */}
                    <button
                      type="button"
                      onClick={handleOpenAddTheme}
                      title="افزودن تم فعلی به فهرست تم‌های آماده"
                      aria-label="افزودن تم"
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-lg border p-0 transition-colors",
                        addingTheme
                          ? "border-brass bg-brass/20 text-brass2"
                          : "border-edge2 bg-panel2/85 text-ink hover:border-brass/65 hover:bg-panel3 hover:text-brass2"
                      )}
                    >
                      <svg viewBox="0 0 16 16" className="block h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                        <path d="M8 3.5v9M3.5 8h9" />
                      </svg>
                    </button>

                    {/* دکمه − حذف تم سفارشی کاربر (غیرفعال برای تم‌های پیش‌فرض) */}
                    <button
                      type="button"
                      disabled={!canDeleteCurrentTheme}
                      onClick={handleDeleteCurrentTheme}
                      title={
                        canDeleteCurrentTheme
                          ? `حذف تم سفارشی «${currentPreset.name}»`
                          : "تم‌های پیش‌فرض نرم‌افزار قابل حذف نیستند"
                      }
                      aria-label="حذف تم"
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-edge2 bg-panel2/85 p-0 text-mute transition-colors hover:border-danger/65 hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      <svg viewBox="0 0 16 16" className="block h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                        <path d="M3.5 8h9" />
                      </svg>
                    </button>
                  </div>

                  {/* سمت چپ: بارگذاری تم + ذخیره تم + بازنشانی */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => themeFileInputRef.current?.click()}
                      title="بارگذاری فایل تم ذخیره‌شده به داخل نرم‌افزار"
                      className="flex h-9 items-center gap-1.5 rounded-lg border border-edge2 bg-panel2/85 px-3 text-[11.5px] font-bold text-ink transition-colors hover:border-brass/65 hover:bg-panel3"
                    >
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-brass" fill="none" stroke="currentColor" strokeWidth="1.7">
                        <path d="M8 10.5V2.8M5.2 5.4 8 2.6l2.8 2.8M2.5 10.5v2.2c0 .5.4.8.9.8h9.2c.5 0 .9-.3.9-.8v-2.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>بارگذاری تم</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleSaveThemeToFile()}
                      title="ذخیره تم فعلی به عنوان یک فایل قابل انتقال"
                      className="flex h-9 items-center gap-1.5 rounded-lg border border-edge2 bg-panel2/85 px-3 text-[11.5px] font-bold text-ink transition-colors hover:border-brass/65 hover:bg-panel3"
                    >
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-brass" fill="none" stroke="currentColor" strokeWidth="1.7">
                        <path d="M8 2.6v7.9M5.2 7.8 8 10.6l2.8-2.8M2.5 10.5v2.2c0 .5.4.8.9.8h9.2c.5 0 .9-.3.9-.8v-2.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>ذخیره تم</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleResetCurrentTheme}
                      title={`بازگردانی رنگ‌های تم «${currentPreset.name}» به حالت پیش‌فرض خودش`}
                      className="flex h-9 items-center gap-1.5 rounded-lg border border-edge2 bg-panel2/85 px-3 text-[11.5px] font-bold text-mute transition-colors hover:border-brass/65 hover:bg-panel3 hover:text-ink"
                    >
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-mute" fill="none" stroke="currentColor" strokeWidth="1.7">
                        <path d="M3.2 6.2A5.2 5.2 0 1 1 4 11.4M3 3v3.4h3.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>بازنشانی</span>
                    </button>
                  </div>
                </div>

                {/* فرم نام‌گذاری هنگام فشردن دکمه + */}
                {addingTheme && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleConfirmAddTheme();
                    }}
                    className="flex items-center gap-2 rounded-lg border border-brass/55 bg-brass/10 p-2.5"
                  >
                    <span className="shrink-0 text-[11.5px] font-bold text-brass2">نام تم جدید:</span>
                    <input
                      autoFocus
                      value={newThemeName}
                      onChange={(e) => setNewThemeName(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setAddingTheme(false);
                        }
                      }}
                      placeholder="نام دلخواه تم را بنویسید…"
                      className="field-input !py-1 !text-xs"
                    />
                    <button type="submit" className="btn-brass shrink-0 rounded-md px-3 py-1.5 text-[11.5px] font-bold">
                      افزودن به تم‌های آماده
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddingTheme(false)}
                      className="shrink-0 rounded-md border border-edge px-2.5 py-1.5 text-[11px] text-mute hover:text-ink"
                    >
                      انصراف
                    </button>
                  </form>
                )}

                {themeFeedback && (
                  <div
                    className={cn(
                      "rounded-lg border px-3 py-2 text-[11px] font-bold",
                      themeFeedback.error ? "border-danger/50 bg-danger/12 text-danger" : "border-teal/45 bg-teal/12 text-teal"
                    )}
                  >
                    {themeFeedback.text}
                  </div>
                )}

                {/* بخش‌های تاشو رنگ‌بندی تمام اجزای نرم‌افزار */}
                {THEME_CATEGORIES.map((cat) => {
                  const visibleItems = q
                    ? cat.items.filter(
                        (it) =>
                          it.label.includes(q) ||
                          cat.title.includes(q) ||
                          themeColors[it.key].toLowerCase().includes(q.toLowerCase())
                      )
                    : cat.items;
                  if (visibleItems.length === 0) return null;
                  const isCollapsed = q ? false : !!collapsedCats[cat.id];
                  return (
                    <section key={cat.id} className="overflow-hidden rounded-xl border border-edge bg-panel2/45">
                      <button
                        type="button"
                        onClick={() => setCollapsedCats((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right transition-colors hover:bg-panel3/45"
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-[9px] text-brass">{isCollapsed ? "▼" : "▲"}</span>
                          <CategoryIcon kind={cat.icon} />
                          <span className="text-[13px] font-bold text-ink">{cat.title}</span>
                        </span>
                        <span className="rounded-md border border-edge bg-bg/80 px-2.5 py-0.5 text-[10.5px] font-bold text-brass">
                          {toPersianDigits(visibleItems.length)} تنظیم
                        </span>
                      </button>

                      {!isCollapsed && (
                        <div className="grid grid-cols-1 gap-2.5 px-3.5 pt-0.5 pb-3.5 sm:grid-cols-2">
                          {visibleItems.map((item) => (
                            <ThemeColorRow
                              key={item.key}
                              label={item.label}
                              color={themeColors[item.key]}
                              onChange={(hex) => setSingleThemeColor(item.key, hex)}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}

            {tab === "appearance" && (
              <div>
                <Title
                  title="خطوط و مقیاس بوم"
                  text="ضخامت خطوط، اندازه نقاط هندسی و نوار ابزار"
                  onReset={() =>
                    patch({
                      lineWidth: DEFAULT_PREFERENCES.lineWidth,
                      pointScale: DEFAULT_PREFERENCES.pointScale,
                      disableSelectionGlow: DEFAULT_PREFERENCES.disableSelectionGlow,
                      toolbarScale: DEFAULT_PREFERENCES.toolbarScale,
                    })
                  }
                />
                <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-brass/35 bg-brass/8 p-3 text-[10.5px]">
                  <span className="text-mute">رنگ‌بندی تمام پنجره‌ها، خطوط، عملیات‌ها، نمای سه‌بعدی، شبیه‌سازی و جی‌کد در تب «تم نرم‌افزار» قرار دارد.</span>
                  <button
                    type="button"
                    onClick={() => setTab("theme")}
                    className="btn-brass shrink-0 rounded-md px-3 py-1.5 text-[10.5px] font-bold"
                  >
                    مدیریت تم و رنگ‌ها
                  </button>
                </div>
                <label className="mt-4 block rounded-lg border border-edge bg-panel2 p-3 text-[10px] text-mute">
                  ضخامت خطوط: <b className="text-ink">{value.lineWidth}px</b>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={0.5}
                    value={value.lineWidth}
                    onChange={(e) => patch({ lineWidth: Number(e.target.value) })}
                    className="mt-2 w-full accent-brass"
                  />
                </label>
                <label className="mt-4 block rounded-lg border border-edge bg-panel2 p-3 text-[10px] text-mute">
                  <span className="flex items-center justify-between">
                    اندازه همه مدل‌های نقطه <b className="font-mono text-teal">{Math.round(value.pointScale * 100)}٪</b>
                  </span>
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.05}
                    value={value.pointScale}
                    onChange={(e) => patch({ pointScale: Number(e.target.value) })}
                    className="mt-3 w-full accent-teal"
                  />
                  <span className="mt-1 flex justify-between text-[8.5px] text-dim">
                    <span>کوچک</span>
                    <span>پیش‌فرض</span>
                    <span>بزرگ</span>
                  </span>
                </label>
                <label className="mt-4 flex items-start gap-3 rounded-lg border border-edge bg-panel2 p-3 text-[10px] text-ink">
                  <input
                    type="checkbox"
                    checked={value.disableSelectionGlow}
                    onChange={(e) => patch({ disableSelectionGlow: e.target.checked })}
                    className="mt-0.5 accent-brass"
                  />
                  <span>
                    <b className="block">غیرفعال‌کردن کامل Glow انتخاب</b>
                    <small className="mt-1 block text-[9px] leading-4 text-dim">
                      همه افکت‌های درخشش هنگام انتخاب را حذف می‌کند تا رندر بوم سبک‌تر و سریع‌تر باشد.
                    </small>
                  </span>
                </label>
                <label className="mt-4 block rounded-lg border border-edge bg-panel2 p-3 text-[10px] text-mute">
                  <span className="flex items-center justify-between">
                    اندازه دکمه‌های نوار ابزار چپ <b className="font-mono text-teal">{Math.round(value.toolbarScale * 100)}٪</b>
                  </span>
                  <input
                    type="range"
                    min={0.75}
                    max={1.5}
                    step={0.05}
                    value={value.toolbarScale}
                    onChange={(e) => patch({ toolbarScale: Number(e.target.value) })}
                    className="mt-3 w-full accent-teal"
                  />
                  <span className="mt-1 flex justify-between text-[8.5px] text-dim">
                    <span>کوچک</span>
                    <span>بزرگ</span>
                  </span>
                </label>
              </div>
            )}

            {tab === "snap" && (
              <div>
                <Title title="حساسیت اسنپ" text="فاصله تشخیص نقاط، تقاطع‌ها و محور بر حسب پیکسل" onReset={() => onSnapTolerance(11)} />
                <div className="mt-6 rounded-lg border border-edge bg-panel2 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs text-ink">حساسیت پیکسلی</span>
                    <b className="font-mono text-sm text-teal">{snapTolerance}px</b>
                  </div>
                  <input
                    type="range"
                    min={3}
                    max={30}
                    step={1}
                    value={snapTolerance}
                    onChange={(e) => onSnapTolerance(Number(e.target.value))}
                    className="w-full accent-teal"
                  />
                  <div className="mt-2 flex justify-between text-[9px] text-dim">
                    <span>دقیق ۳px</span>
                    <span>حساس ۳۰px</span>
                  </div>
                </div>
              </div>
            )}

            {tab === "shortcuts" && (
              <div>
                <Title
                  title="کلیدهای میانبر"
                  text="برای تغییر، روی کادر کلید کلیک و کلید جدید را فشار دهید"
                  onReset={() => patch({ shortcuts: { ...DEFAULT_PREFERENCES.shortcuts } })}
                />
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {Object.entries(SHORTCUT_LABELS)
                    .filter(([, label]) => !q || label.includes(q))
                    .map(([id, label]) => (
                      <label key={id} className="flex items-center justify-between rounded-md border border-edge bg-panel2 px-3 py-2 text-[10.5px] text-ink">
                        <span>{label}</span>
                        <input
                          readOnly
                          value={(value.shortcuts[id] ?? "").toUpperCase()}
                          onKeyDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const rc = typeof e.code === "string" ? e.code : "";
                            const rk = typeof e.key === "string" ? e.key : "";
                            const key = /^Key[A-Z]$/.test(rc) ? rc.slice(3).toLowerCase() : rk.toLowerCase();
                            if (key.length !== 1) return;
                            const used = Object.entries(value.shortcuts).find(([other, k]) => other !== id && k === key);
                            if (used) return;
                            patch({ shortcuts: { ...value.shortcuts, [id]: key } });
                          }}
                          onFocus={(e) => e.currentTarget.select()}
                          className="h-7 w-12 rounded border border-edge2 bg-bg text-center font-mono text-xs font-bold text-brass2 outline-none focus:border-teal"
                        />
                      </label>
                    ))}
                </div>
              </div>
            )}

            {tab === "post" && (
              <div>
                <Title
                  title="تنظیمات جی‌کد"
                  text="سرعت پیش‌فرض عملیات، جابجایی جی‌کد، افست هلدر دوم و قالب خروجی کنترلر"
                  onReset={() =>
                    patch({
                      postProcessor: DEFAULT_PREFERENCES.postProcessor,
                      gcodeUnits: DEFAULT_PREFERENCES.gcodeUnits,
                      sequenceNumbers: DEFAULT_PREFERENCES.sequenceNumbers,
                      gcodeFormat: DEFAULT_PREFERENCES.gcodeFormat,
                      continuousPaths: DEFAULT_PREFERENCES.continuousPaths,
                      safeBottomInnerLink: DEFAULT_PREFERENCES.safeBottomInnerLink,
                      innerBoundaryRoutingMode: DEFAULT_PREFERENCES.innerBoundaryRoutingMode,
                      optimizeFeeds: DEFAULT_PREFERENCES.optimizeFeeds,
                      spreadRapid: DEFAULT_PREFERENCES.spreadRapid,
                      spindleSpeed: DEFAULT_PREFERENCES.spindleSpeed,
                      defaultGcodeShiftX: DEFAULT_PREFERENCES.defaultGcodeShiftX,
                      defaultGcodeShiftY: DEFAULT_PREFERENCES.defaultGcodeShiftY,
                      defaultInnerStartClearance: DEFAULT_PREFERENCES.defaultInnerStartClearance,
                      defaultInnerEndTravel: DEFAULT_PREFERENCES.defaultInnerEndTravel,
                      defaultHolder2XOff: DEFAULT_PREFERENCES.defaultHolder2XOff,
                      defaultHolder2YOff: DEFAULT_PREFERENCES.defaultHolder2YOff,
                      operationFeeds: { ...DEFAULT_PREFERENCES.operationFeeds },
                    })
                  }
                />
                <div className="mt-4 rounded-lg border border-edge bg-panel2 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-ink">جابجایی پیش‌فرض جی‌کد</span>
                    <span className="text-[9px] text-dim">هنگام باز شدن نرم‌افزار · مثبت و منفی</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2.5">
                    <PrefNumInput label="جابجایی محور X" unit="mm" value={value.defaultGcodeShiftX} step={0.5} onChange={(v) => patch({ defaultGcodeShiftX: v })} />
                    <PrefNumInput label="جابجایی محور Y" unit="mm" value={value.defaultGcodeShiftY} step={0.5} onChange={(v) => patch({ defaultGcodeShiftY: v })} />
                  </div>
                </div>
                <div className="mt-3 rounded-lg border border-edge bg-panel2 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-ink">فاصله پیش‌فرض شروع و پایان داخل‌تراشی</span>
                    <span className="text-[9px] text-dim">هنگام باز شدن نرم‌افزار · ۱ تا ۹۹۹ میلی‌متر</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2.5">
                    <PrefNumInput
                      label="فاصله شروع داخل‌تراشی"
                      unit="mm"
                      value={value.defaultInnerStartClearance}
                      min={MIN_INNER_DISTANCE}
                      max={MAX_INNER_DISTANCE}
                      step={1}
                      onChange={(v) => patch({ defaultInnerStartClearance: Math.min(MAX_INNER_DISTANCE, Math.max(MIN_INNER_DISTANCE, v)) })}
                    />
                    <PrefNumInput
                      label="فاصله پایان داخل‌تراشی"
                      unit="mm"
                      value={value.defaultInnerEndTravel}
                      min={MIN_INNER_DISTANCE}
                      max={MAX_INNER_DISTANCE}
                      step={1}
                      onChange={(v) => patch({ defaultInnerEndTravel: Math.min(MAX_INNER_DISTANCE, Math.max(MIN_INNER_DISTANCE, v)) })}
                    />
                  </div>
                </div>
                <div
                  className="mt-3 rounded-lg border p-3"
                  style={{ borderColor: rgbaCss(themeColors.opInnerRough, 0.35), backgroundColor: rgbaCss(themeColors.opInnerRough, 0.06) }}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-bold" style={{ color: themeColors.opInnerRough }}>
                      افست پیش‌فرض هلدر دوم
                    </span>
                    <span className="text-[9px] text-dim">هنگام باز شدن نرم‌افزار · حداقل {MIN_HOLDER2_OFFSET}mm</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2.5">
                    <PrefNumInput
                      label="X Offset (+X)"
                      unit="mm"
                      value={value.defaultHolder2XOff}
                      min={MIN_HOLDER2_OFFSET}
                      step={0.5}
                      onChange={(v) => patch({ defaultHolder2XOff: Math.max(MIN_HOLDER2_OFFSET, v) })}
                    />
                    <PrefNumInput
                      label="Y Offset (−Y)"
                      unit="mm"
                      value={value.defaultHolder2YOff}
                      min={MIN_HOLDER2_OFFSET}
                      step={0.5}
                      onChange={(v) => patch({ defaultHolder2YOff: Math.max(MIN_HOLDER2_OFFSET, v) })}
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <div className="mb-2 text-[11px] font-bold text-ink">
                    سرعت پیش‌فرض عملیات <span className="font-normal text-dim">(mm/min)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {FEED_LABELS.map(([key, label]) => (
                      <label key={key} className="flex items-center justify-between gap-2 rounded-md border border-edge bg-panel2 px-2.5 py-2 text-[9.5px] text-mute">
                        <span className="flex items-center gap-2">
                          <i
                            className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/25"
                            style={{ backgroundColor: segColorFromTheme(themeColors, key) }}
                          />
                          {label}
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={20000}
                          step={10}
                          value={value.operationFeeds[key]}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isFinite(n)) patch({ operationFeeds: { ...value.operationFeeds, [key]: Math.min(20000, Math.max(1, n)) } });
                          }}
                          className="h-7 w-20 rounded border border-edge2 bg-bg px-1 text-center font-mono text-[10px] text-teal outline-none focus:border-teal"
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <label className="mt-4 flex items-center justify-between gap-3 rounded-md border border-edge bg-panel2 p-3 text-[11px] text-ink">
                  <span>
                    سرعت چرخش <small className="text-dim">(rpm)</small>
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={20000}
                    step={100}
                    value={value.spindleSpeed}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) patch({ spindleSpeed: Math.min(20000, Math.max(0, n)) });
                    }}
                    className="h-8 w-24 rounded border border-edge2 bg-bg px-2 text-center font-mono text-xs text-teal outline-none focus:border-teal"
                  />
                </label>
                <div className="mt-5">
                  <span className="mb-1 block text-[10px] text-mute">سبک خروجی جی‌کد</span>
                  <div className="grid grid-cols-2 overflow-hidden rounded-md border border-edge">
                    <button
                      onClick={() => patch({ gcodeFormat: "modal" })}
                      className={cn(
                        "py-2 text-[10.5px] font-bold",
                        value.gcodeFormat === "modal" ? "bg-brass text-[var(--color-brass-ink)]" : "bg-panel2 text-mute"
                      )}
                    >
                      فشرده Modal
                    </button>
                    <button
                      onClick={() => patch({ gcodeFormat: "std" })}
                      className={cn(
                        "border-r border-edge py-2 text-[10.5px] font-bold",
                        value.gcodeFormat === "std" ? "bg-brass text-[var(--color-brass-ink)]" : "bg-panel2 text-mute"
                      )}
                    >
                      استاندارد Fanuc
                    </button>
                  </div>
                </div>
                <div className="mt-4">
                  <span className="mb-1 block text-[10px] text-mute">الگوریتم خشن داخل</span>
                  <div className="grid grid-cols-2 overflow-hidden rounded-md border border-edge">
                    {(
                      [
                        ["linear", "خطی کامل", "۴۰ تا ۴۸ میلی‌ثانیه", ""],
                        ["expBinary", "نمایی–دودویی", "۳۱ تا ۳۳ میلی‌ثانیه", "border-r"],
                        ["compact", "رأس‌های فشرده", "۲۷ تا ۳۰ میلی‌ثانیه", "border-r border-t"],
                        ["orthogonal", "میانبر قائم–محوری", "۲۶ تا ۲۹ میلی‌ثانیه", "border-r border-t"],
                        ["nearest", "نزدیک‌ترین رأس مرئی", "۲۰ تا ۲۳ میلی‌ثانیه", "border-t"],
                        ["rawBoundary", "مرز خام بدون ساده‌سازی", "۱۳ تا ۳۰ میلی‌ثانیه", "border-r border-t"],
                        ["rdp", "ساده‌سازی هوشمند ایمن", "۱۵ تا ۲۳ میلی‌ثانیه", "border-t"],
                        ["shortCode", "کد کوتاه کم‌رأس", "۲۷ تا ۳۰ میلی‌ثانیه", "border-r border-t"],
                        ["offsetOptimized", "افست دقیق فوق‌سریع کم‌خط", "۱۱۵ تا ۱۳۵ میلی‌ثانیه (طرح پیچیده)", "border-t"],
                      ] as const
                    ).map(([mode, title, sub, borderCls]) => (
                      <button
                        key={mode}
                        onClick={() => patch({ innerBoundaryRoutingMode: mode })}
                        className={cn(
                          borderCls,
                          "border-edge py-2 text-[9.5px] font-bold",
                          value.innerBoundaryRoutingMode === mode ? "bg-brass text-[var(--color-brass-ink)]" : "bg-panel2 text-mute"
                        )}
                      >
                        <span className="block">{title}</span>
                        <small className="mt-0.5 block font-mono text-[8px] opacity-75">{sub}</small>
                      </button>
                    ))}
                  </div>
                  <small className="mt-1 block text-[9px] leading-4 text-dim">
                    خطی کامل: روش قبلی؛ نمایی–دودویی: ساده‌سازی سریع؛ رأس‌های فشرده: کاهش آزمون‌های دید؛ میانبر قائم–محوری: مسیرهای قائم و محور؛ نزدیک‌ترین رأس مرئی: ورود نزدیک؛ مرز خام: بدون ساده‌سازی؛ ساده‌سازی هوشمند ایمن: کاهش سریع رأس‌ها؛ کد کوتاه کم‌رأس: اولویت با کمترین خطوط همراه مجموعه دید کوچک‌تر؛ افست دقیق فوق‌سریع کم‌خط: دورترین وتر ایمن با خطای حداکثر ۰٫۲۵mm و حفظ قانون آفست موضعی.
                  </small>
                </div>
                <div className="mt-3 grid gap-2">
                  {(
                    [
                      ["continuousPaths", "اتصال پیوسته مسیرها (بدون G0)"],
                      ["safeBottomInnerLink", "اتصال امن کف‌تراشی به خشن داخل (+X، Y، −X)"],
                      ["optimizeFeeds", "فیدر بهینه (حذف Fهای تکراری)"],
                      ["sequenceNumbers", "شماره خط (N) — فقط Fanuc"],
                      ["spreadRapid", "گسترش G0 در جی‌کد (۳mm)"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 rounded-md border border-edge bg-panel2 px-3 py-2 text-[10.5px] text-ink">
                      <input type="checkbox" checked={Boolean(value[key])} onChange={(e) => patch({ [key]: e.target.checked })} className="accent-brass" />
                      {label}
                    </label>
                  ))}
                </div>
                <label className="mt-4 block text-[10px] text-mute">
                  پست‌پراسس
                  <select value={value.postProcessor} onChange={(e) => patch({ postProcessor: e.target.value as AppPreferences["postProcessor"] })} className="field-input mt-1">
                    <option value="fanuc">Fanuc / سازگار</option>
                    <option value="linuxcnc">LinuxCNC</option>
                    <option value="generic">Generic ISO</option>
                  </select>
                </label>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    onClick={() => patch({ gcodeUnits: "mm" })}
                    className={cn(
                      "rounded-md border p-3 text-xs font-bold",
                      value.gcodeUnits === "mm" ? "border-brass/60 bg-brass/10 text-brass2" : "border-edge text-mute"
                    )}
                  >
                    میلی‌متر (G21)
                  </button>
                  <button
                    onClick={() => patch({ gcodeUnits: "inch" })}
                    className={cn(
                      "rounded-md border p-3 text-xs font-bold",
                      value.gcodeUnits === "inch" ? "border-brass/60 bg-brass/10 text-brass2" : "border-edge text-mute"
                    )}
                  >
                    اینچ (G20)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <footer dir="rtl" className="flex justify-end border-t border-edge px-4 py-3">
          <button onClick={onClose} className="btn-brass rounded-md px-5 py-1.5 text-xs font-bold">
            تأیید
          </button>
        </footer>
      </section>
    </div>
  );
}

function PrefNumInput({
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min?: number;
  max?: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState<string>(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  const clamp = (v: number) => {
    let r = Math.round(v * 100) / 100;
    if (Object.is(r, -0)) r = 0;
    if (min !== undefined) r = Math.max(min, r);
    if (max !== undefined) r = Math.min(max, r);
    return r;
  };
  const commit = (raw: string) => {
    const normalized = raw
      .replace(/[−–—]/g, "-")
      .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
      .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const v = parseFloat(normalized);
    if (!Number.isNaN(v) && Number.isFinite(v)) onChange(clamp(v));
  };
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold text-mute">{label}</span>
      <div className="relative">
        <input
          type="text"
          inputMode={min !== undefined && min >= 0 ? "decimal" : undefined}
          className="field-input pl-10"
          value={text}
          dir="ltr"
          style={{ textAlign: "right" }}
          onFocus={() => (focused.current = true)}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => {
            focused.current = false;
            setText(String(value));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "ArrowUp") {
              e.preventDefault();
              const v = clamp(value + step);
              onChange(v);
              setText(String(v));
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              const v = clamp(value - step);
              onChange(v);
              setText(String(v));
            }
          }}
        />
        <span className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 font-mono text-[9px] text-dim">{unit}</span>
      </div>
    </label>
  );
}

function Title({ title, text, onReset }: { title: string; text: string; onReset: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-base font-bold text-ink">{title}</h3>
        <p className="mt-1 text-[10px] text-dim">{text}</p>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="shrink-0 rounded-md border border-edge bg-panel2 px-2.5 py-1.5 text-[9.5px] font-bold text-mute transition-colors hover:border-brass/50 hover:text-brass2"
        title="بازنشانی تنظیمات این بخش به مقدار پیش‌فرض"
      >
        بازنشانی به پیش‌فرض
      </button>
    </div>
  );
}
