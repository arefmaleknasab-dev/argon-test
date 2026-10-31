import "./point-scale.css";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ControlsPanel from "./components/ControlsPanel";
import AIImportDialog from "./components/AIImportDialog";
import { PanelErrorBoundary } from "./components/ErrorBoundary";
import { DockPanel, DockSplitter, MAX_UNBOUNDED_PANEL, MIN_EDITOR_W, MIN_PANEL, PANEL_IDS, WindowMenu, defaultLayout, normalizeLayout, panelMaxWidth, panelMinWidth } from "./components/Dock";
import type { LayoutState, PanelId, PanelState, PanelVis, WindowMenuItem } from "./components/Dock";
import GCodePanel from "./components/GCodePanel";
import ProfileEditor, { type EdSettings, type ReferenceImage } from "./components/ProfileEditor";
import SimulationView from "./components/SimulationView";
import Lathe3DView from "./components/Lathe3DView";
import PreferencesDialog, { DEFAULT_PREFERENCES, type AppPreferences } from "./components/PreferencesDialog";
import { IconArrowLeft, IconArrowRight, IconCheck, IconCode, IconCube, IconDownload, IconLayers, IconPen, IconSim, IconSettings, IconSpindle, IconWarn } from "./components/icons";
import { buildDxf } from "./lib/dxf";
import { MAX_INNER_DISTANCE, MIN_HOLDER2_OFFSET, MIN_INNER_DISTANCE, PRESETS, STRATEGIES, applyGcodeOvr, deriveGcodeOvr, generate, makeOps, normalizeParams, presetPoints, seedGcodeEdit, translateHolder2Edit } from "./lib/lathe";
import type { EditBuf, ELine, GcodeOvrMap, GenResult, Holder2State, OpType, Params, PPoint, Preset, SplitState } from "./lib/lathe";
import type { SketchSeg } from "./lib/sketch";
import { autoSplitPoint, branchPathPoints, branchPoints, chainPolyline, flattenSketch, normalizeSketch, orderChain, segMid, sketchFromPoints, sketchFromWall, splitChainAt } from "./lib/sketch";
import { applyThemeToDocument, getThemeBaseColors, hexToRgb, normalizeHexColor, rgbaCss, sanitizeThemeColors, shadeHex, type CustomThemePreset } from "./lib/theme";
import { cn } from "./utils/cn";

const STORE_KEY = "kharraatcode-v1";

/* محاسبهٔ بودجهٔ دقیق عرض پنل‌های کناری بر اساس عرض واقعی ردیف فلکس تا هیچ پنلی (از جمله جی‌کد در سمت چپ) از کادر بیرون نزند */
function computeSideBudget(l: LayoutState, rowW: number) {
  const order = Array.isArray(l.order) ? l.order : PANEL_IDS;
  const activeIds = order.filter((id) =>
    id === "editor" ? !l.editor.open || !l.editor.collapsed : l[id].open && !l[id].collapsed
  );
  const flexPanelId: PanelId | null = activeIds.includes("editor")
    ? "editor"
    : activeIds.length > 0
      ? activeIds[activeIds.length - 1]
      : null;
  const openSideIds = activeIds.filter((id) => id !== flexPanelId);
  const collapsedCount = order.filter((id) => l[id].open && l[id].collapsed).length;
  const splitterCount = Math.max(0, activeIds.length - 1);
  const renderedPanels = activeIds.length + collapsedCount;
  const visItems = renderedPanels + splitterCount;
  const gapsW = Math.max(0, visItems - 1) * 8;
  const splittersW = splitterCount * 9;
  const collapsedW = collapsedCount * 44;
  /* ۲۴ پیکسل padding افقی (p-3) + ۲ پیکسل حاشیه اطمینان برای رندرینگ زیرپیکسلی مرورگر */
  const totalRawAvail = Math.max(activeIds.length * 110, rowW - 26 - gapsW - splittersW - collapsedW);
  const allRawMin = activeIds.reduce((acc, id) => acc + panelMinWidth(id), 0);
  const scale = allRawMin > 0 && totalRawAvail < allRawMin ? totalRawAvail / allRawMin : 1;
  const minById: Record<PanelId, number> = {
    controls: MIN_PANEL,
    view3d: MIN_EDITOR_W,
    editor: MIN_EDITOR_W,
    gcode: MIN_PANEL,
  };
  for (const id of activeIds) {
    minById[id] = scale < 1 ? Math.max(110, Math.floor(panelMinWidth(id) * scale)) : panelMinWidth(id);
  }
  const flexReserve = flexPanelId ? minById[flexPanelId] : 0;
  const minSideSum = openSideIds.reduce((acc, id) => acc + minById[id], 0);
  const maxSideSum = Math.max(minSideSum, totalRawAvail - flexReserve);
  const totalActiveWidth = maxSideSum + flexReserve;
  return { activeIds, openSideIds, flexPanelId, maxSideSum, totalActiveWidth, minById };
}

function getEffectiveSideSizes(l: LayoutState, rowW: number, isRow: boolean): Record<PanelId, number> {
  const out: Record<PanelId, number> = {
    controls: l.controls.size,
    view3d: l.view3d.size,
    editor: 0,
    gcode: l.gcode.size,
  };
  if (!isRow) return out;
  const { openSideIds, maxSideSum, minById } = computeSideBudget(l, rowW);
  if (openSideIds.length === 0) return out;
  for (const id of openSideIds) {
    out[id] = Math.max(minById[id], Math.min(panelMaxWidth(id), Math.round(out[id])));
  }
  const sum = openSideIds.reduce((acc, id) => acc + out[id], 0);
  if (sum <= maxSideSum) return out;

  const excess = sum - maxSideSum;
  const shrinkable = openSideIds.reduce((acc, id) => acc + Math.max(0, out[id] - minById[id]), 0);
  if (shrinkable <= 0) {
    for (const id of openSideIds) out[id] = minById[id];
    return out;
  }
  for (const id of openSideIds) {
    const cap = Math.max(0, out[id] - minById[id]);
    const take = Math.min(cap, Math.round((excess * cap) / shrinkable));
    out[id] -= take;
  }
  let rem = openSideIds.reduce((acc, id) => acc + out[id], 0) - maxSideSum;
  for (const id of openSideIds) {
    if (rem <= 0) break;
    const canTake = Math.min(rem, Math.max(0, out[id] - minById[id]));
    out[id] -= canTake;
    rem -= canTake;
  }
  return out;
}

/** نگاشت معکوس انتخاب Edit Path به سطر متن G-code، شامل خطوط تکراری و Bridgeها. */
function editLineGCodeIndex(lineId: number, editLines: ELine[], gen: GenResult): number {
  const editIndex=editLines.findIndex(line=>line.id===lineId);
  if(editIndex<0)return -1;
  const line=editLines[editIndex];
  const bridge=/^#bridge:(.+):(\d+)$/.exec(line.key);
  if(bridge){
    const baseKey=bridge[1],move=/^move:(\d+)$/.exec(baseKey);
    const segment=move?gen.segs[Number(move[1])]:gen.segs.find(candidate=>candidate.ovrKey===baseKey);
    return segment?.line??-1;
  }
  const move=/^#move:(\d+)$/.exec(line.key);
  if(move)return gen.segs[Number(move[1])]?.line??-1;
  if(line.key.startsWith("#"))return -1;
  let occurrence=-1;
  for(let i=0;i<=editIndex;i++)if(editLines[i].key===line.key)occurrence++;
  const matches=gen.segs.filter(segment=>segment.ovrKey===line.key);
  return matches.length?matches[Math.min(Math.max(0,occurrence),matches.length-1)].line:-1;
}

interface Saved {
  points?: PPoint[];
  sketch?: SketchSeg[];
  params?: Partial<Params>;
  settings?: Partial<EdSettings>;
  preferences?: Partial<AppPreferences>;
  layout?: LayoutState;
  activePreset?: string | null;
  referenceImages?: ReferenceImage[];
  gcodeOvr?: Record<string, { s?: { z: number; x: number }; e?: { z: number; x: number }; via?: { z: number; x: number }[]; moves?: { motion: 0 | 1; feed: number }[]; bridgeMoves?: Record<number, { motion: 0 | 1; feed: number }>; del?: boolean }>;
  version?: number;
}

const SAVE_VERSION = 9;

let SAVED: Saved | null = null;
try {
  const raw = localStorage.getItem(STORE_KEY);
  if (raw) SAVED = JSON.parse(raw) as Saved;
} catch {
  SAVED = null;
}

/* داده‌های پیش از نسخه ۲: عملیات «spring» و «offset» معنای متفاوتی داشتند */
const IS_LEGACY = !SAVED || !SAVED.version || SAVED.version < 3;

/* گام تاریخچه — یکپارچه: اسکچ + اوررایدهای تأییدشدهٔ جی‌کد + وضعیت/بافرِ حالت ادیت */
interface ProjectTab {
  id: string;
  name: string;
  sketch: SketchSeg[];
  params: Params;
  gcodeOvr: GcodeOvrMap;
  referenceImages: ReferenceImage[];
  activePreset: string | null;
  savedSnapshot: string | null;
  past: HistEntry[];
  future: HistEntry[];
}

const projectSnapshot = (sketch: SketchSeg[], params: Params, gcodeOvr: GcodeOvrMap, images: ReferenceImage[] = []) =>
  JSON.stringify({ sketch, params, gcodeOvr, images: Array.isArray(images) ? images : [] });

function normalizeReferenceImages(raw: unknown): ReferenceImage[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (img): img is ReferenceImage =>
      !!img &&
      typeof img === "object" &&
      typeof (img as ReferenceImage).src === "string" &&
      typeof (img as ReferenceImage).width === "number" &&
      typeof (img as ReferenceImage).height === "number"
  );
}

function saveRecentProjectsSafe(tabs: ProjectTab[]) {
  /* پشته‌های undo/redo (past/future) حاوی صدها کپی سنگین از EditBuf هستند و فقط
     مربوط به نشست جاری‌اند؛ حذف آن‌ها پیش از ذخیره در localStorage مانع پر شدن
     سهمیه ۵ مگابایتی مرورگر و کرش QuotaExceededError می‌شود. */
  const clean = tabs.slice(0, 30).map((tab) => ({
    ...tab,
    referenceImages: normalizeReferenceImages(tab.referenceImages),
    past: [],
    future: [],
  }));
  try {
    localStorage.setItem("kharraat-recent-projects", JSON.stringify(clean));
  } catch {
    try {
      const lighter = clean.map((tab, idx) => (idx < 3 ? tab : { ...tab, referenceImages: [] }));
      localStorage.setItem("kharraat-recent-projects", JSON.stringify(lighter));
    } catch {
      try {
        const minimal = clean.slice(0, 8).map((tab) => ({ ...tab, referenceImages: [] }));
        localStorage.setItem("kharraat-recent-projects", JSON.stringify(minimal));
      } catch {
        /* ignore if storage completely unavailable */
      }
    }
  }
}

interface EditEntrySnapshot {
  sketch: SketchSeg[];
  params: Params;
  gcodeOvr: GcodeOvrMap;
  activePreset: string | null;
  baseline: string;
}

function cloneParams(p: Params): Params {
  return JSON.parse(JSON.stringify(p)) as Params;
}

function cloneGcodeOvr(o: GcodeOvrMap): GcodeOvrMap {
  return JSON.parse(JSON.stringify(o)) as GcodeOvrMap;
}

function computeProfileBranches(
  targetSketch: SketchSeg[],
  targetSplit: SplitState,
  blankD: number,
  blankL: number
): {
  points: PPoint[];
  innerPoints: PPoint[];
  outerFinishPoints: PPoint[];
  splitInfo: { outerDir: 1 | -1; innerDir: 1 | -1; at: { z: number; r: number } } | null;
} {
  const blankR = blankD / 2;
  if (targetSplit.enabled) {
    const poly = chainPolyline(orderChain(targetSketch));
    if (poly.length >= 3) {
      const sp = splitChainAt(poly, { z: targetSplit.z, r: targetSplit.r });
      /* حفظ جهت توپولوژیک نسبت به Split در حالت swapped: شاخهٔ خارجی از سر آزاد به Split و شاخهٔ داخلی از Split به سر آزاد */
      const outerBranch = targetSplit.swapped ? [...sp.inner].reverse() : sp.outer;
      const innerBranch = targetSplit.swapped ? [...sp.outer].reverse() : sp.inner;
      const branchDir = (br: { z: number }[]): 1 | -1 =>
        br.length >= 2 && br[br.length - 1].z < br[0].z ? -1 : 1;
      return {
        points: branchPoints(outerBranch, blankR, blankL, "max"),
        /* پرداخت بیرونی نیز باید ترتیب توپولوژیک و گوشه‌های قائم شاخه را حفظ
           کند؛ پوشش مرتب‌شدهٔ points فقط برای محاسبات خشن استفاده می‌شود. */
        outerFinishPoints: branchPathPoints(outerBranch, blankR, blankL),
        /* ترتیب واقعی شاخه برای Offset/Finish حفظ می‌شود؛ موتور مسیر یک پوشش
           یکنواخت جداگانه برای پاس‌های خشن می‌سازد. */
        innerPoints: branchPathPoints(innerBranch, blankR, blankL),
        splitInfo: {
          outerDir: branchDir(outerBranch),
          innerDir: branchDir(innerBranch),
          at: sp.splitAt,
        },
      };
    }
  }
  const orderedProfile = chainPolyline(orderChain(targetSketch));
  return {
    points: flattenSketch(targetSketch, blankR, blankL),
    innerPoints: [] as PPoint[],
    outerFinishPoints: branchPathPoints(orderedProfile, blankR, blankL),
    splitInfo: null,
  };
}

interface HistEntry {
  sketch: SketchSeg[];
  gcodeOvr: GcodeOvrMap;
  editBuf: EditBuf | null;
  /** باز یا بسته‌بودن پنجره مستقل از وجود پیش‌نویس ذخیره می‌شود. */
  editOpen: boolean;
  /** همه پارامترهای مولد، به‌ویژه لیست عملیات استراتژی، باید همراه بافر
      ویرایش بازیابی شوند؛ وگرنه بافر قدیمی روی عملیات جدید تأیید می‌شود. */
  params: Params;
  /** وضعیت تأییدشده پیش از ورود به ویرایش مسیر برای بازگشت در صورت خروج بدون تأیید. */
  editEntry?: EditEntrySnapshot | null;
}

/* بازخوانی ایمنِ اوررایدها از حافظهٔ محلی (سنجش نوع پس از پارس) */
function normGcodeOvr(raw: Saved["gcodeOvr"]): GcodeOvrMap {
  const out: GcodeOvrMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== "object") continue;
    const o: { s?: { z: number; x: number }; e?: { z: number; x: number }; via?: { z: number; x: number }[]; moves?: { motion: 0 | 1; feed: number }[]; bridgeMoves?: Record<number, { motion: 0 | 1; feed: number }>; del?: boolean } = {};
    const okPt = (q: unknown): q is { z: number; x: number } =>
      !!q &&
      typeof q === "object" &&
      typeof (q as { z: unknown }).z === "number" &&
      typeof (q as { x: unknown }).x === "number" &&
      isFinite((q as { z: number }).z) &&
      isFinite((q as { x: number }).x);
    if (okPt(v.s)) o.s = { z: v.s!.z, x: v.s!.x };
    if (okPt(v.e)) o.e = { z: v.e!.z, x: v.e!.x };
    if (Array.isArray(v.via)) o.via = v.via.filter(okPt).map((q) => ({ z: q.z, x: q.x }));
    if (Array.isArray(v.moves)) {
      const moves = v.moves.filter((m) => m && (m.motion === 0 || m.motion === 1) && typeof m.feed === "number" && isFinite(m.feed) && m.feed >= 0);
      if (moves.length) o.moves = moves.map((m) => ({ motion: m.motion, feed: m.feed }));
    }
    if (v.bridgeMoves && typeof v.bridgeMoves === "object") {
      const bridgeMoves: Record<number, { motion: 0 | 1; feed: number }> = {};
      for (const [leg, move] of Object.entries(v.bridgeMoves)) {
        const n = Number(leg);
        if (Number.isInteger(n) && move && (move.motion === 0 || move.motion === 1) && typeof move.feed === "number" && isFinite(move.feed) && move.feed >= 0) {
          bridgeMoves[n] = { motion: move.motion, feed: move.feed };
        }
      }
      if (Object.keys(bridgeMoves).length) o.bridgeMoves = bridgeMoves;
    }
    if (v.del === true) o.del = true;
    if (o.s || o.e || o.via?.length || o.moves?.length || o.bridgeMoves || o.del) out[k] = o;
  }
  return out;
}

export default function App() {
  const [showAiImport, setShowAiImport] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [imageImportRequest,setImageImportRequest]=useState(0);
  const imageHistoryApi=useRef<{undo:()=>void;redo:()=>void;canUndo:boolean;canRedo:boolean}|null>(null);
  const [imageHistoryState,setImageHistoryState]=useState({canUndo:false,canRedo:false});
  const registerImageHistory=useCallback((api:{undo:()=>void;redo:()=>void;canUndo:boolean;canRedo:boolean})=>{imageHistoryApi.current=api;setImageHistoryState(s=>s.canUndo===api.canUndo&&s.canRedo===api.canRedo?s:{canUndo:api.canUndo,canRedo:api.canRedo});},[]);
  const [saveAsName,setSaveAsName]=useState<string|null>(null);
  const saveAsResolver=useRef<((name:string|null)=>void)|null>(null);
  const [preferences, setPreferences] = useState<AppPreferences>(() => {
    const saved = SAVED?.preferences as (Partial<AppPreferences> & Record<string, unknown>) | undefined;
    const savedCustomThemes: CustomThemePreset[] = Array.isArray(saved?.customThemes)
      ? saved.customThemes
          .filter((item): item is CustomThemePreset => Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.name === "string"))
          .map((item) => ({
            id: item.id,
            name: item.name,
            colors: sanitizeThemeColors(item.colors),
          }))
      : [];
    const savedThemeId = typeof saved?.theme === "string" && saved.theme.trim() ? saved.theme.trim() : DEFAULT_PREFERENCES.theme;
    const baseThemeColors = getThemeBaseColors(savedThemeId, savedCustomThemes);
    const resolvedThemeColors =
      saved?.themeColors && typeof saved.themeColors === "object"
        ? sanitizeThemeColors(saved.themeColors, baseThemeColors)
        : sanitizeThemeColors(
            {
              profileOuter: normalizeHexColor(typeof saved?.profileColor === "string" ? saved.profileColor : "") ?? baseThemeColors.profileOuter,
              profileSelected: normalizeHexColor(typeof saved?.selectedColor === "string" ? saved.selectedColor : "") ?? baseThemeColors.profileSelected,
              pathEditSelected: normalizeHexColor(typeof saved?.guideColor === "string" ? saved.guideColor : "") ?? baseThemeColors.pathEditSelected,
            },
            baseThemeColors
          );
    /* تنظیمات خروجی پیش‌تر در Params بودند. فقط پس از اولین ذخیره نسخه جدید،
       مقادیر Preferences معتبرند؛ وگرنه دقیقاً با پیش‌فرض‌های تصویر آغاز شوند. */
    const hasNewGcodePreferences = saved?.gcodeFormat === "modal" || saved?.gcodeFormat === "std";
    return {
      ...DEFAULT_PREFERENCES,
      ...(saved ?? {}),
      theme: savedThemeId,
      customThemes: savedCustomThemes,
      themeColors: resolvedThemeColors,
      profileColor: resolvedThemeColors.profileOuter,
      selectedColor: resolvedThemeColors.profileSelected,
      guideColor: resolvedThemeColors.pathEditSelected,
      ...(!hasNewGcodePreferences ? {
        gcodeFormat: "modal" as const,
        continuousPaths: true,
        optimizeFeeds: true,
        sequenceNumbers: true,
        spreadRapid: false,
      } : {}),
      /* مهاجرت نسخه ۹: سه میانبر اختیاری نوار بالا از این نسخه پیش‌فرض خاموش‌اند. */
      ...((SAVED?.version ?? 0) < 9 ? {
        showHeaderImportAi: false,
        showHeaderExportDxf: false,
        showHeaderCopyGcode: false,
      } : {}),
      shortcuts: { ...DEFAULT_PREFERENCES.shortcuts, ...(saved?.shortcuts ?? {}) },
      operationFeeds: { ...DEFAULT_PREFERENCES.operationFeeds, ...(saved?.operationFeeds ?? {}) },
      defaultGcodeShiftX: typeof saved?.defaultGcodeShiftX === "number" && Number.isFinite(saved.defaultGcodeShiftX)
        ? saved.defaultGcodeShiftX
        : DEFAULT_PREFERENCES.defaultGcodeShiftX,
      defaultGcodeShiftY: typeof saved?.defaultGcodeShiftY === "number" && Number.isFinite(saved.defaultGcodeShiftY)
        ? saved.defaultGcodeShiftY
        : DEFAULT_PREFERENCES.defaultGcodeShiftY,
      defaultInnerStartClearance: typeof saved?.defaultInnerStartClearance === "number" && Number.isFinite(saved.defaultInnerStartClearance)
        ? Math.min(MAX_INNER_DISTANCE, Math.max(MIN_INNER_DISTANCE, saved.defaultInnerStartClearance))
        : DEFAULT_PREFERENCES.defaultInnerStartClearance,
      defaultInnerEndTravel: typeof saved?.defaultInnerEndTravel === "number" && Number.isFinite(saved.defaultInnerEndTravel)
        ? Math.min(MAX_INNER_DISTANCE, Math.max(MIN_INNER_DISTANCE, saved.defaultInnerEndTravel))
        : DEFAULT_PREFERENCES.defaultInnerEndTravel,
      defaultHolder2XOff: typeof saved?.defaultHolder2XOff === "number" && Number.isFinite(saved.defaultHolder2XOff)
        ? Math.max(MIN_HOLDER2_OFFSET, saved.defaultHolder2XOff)
        : DEFAULT_PREFERENCES.defaultHolder2XOff,
      defaultHolder2YOff: typeof saved?.defaultHolder2YOff === "number" && Number.isFinite(saved.defaultHolder2YOff)
        ? Math.max(MIN_HOLDER2_OFFSET, saved.defaultHolder2YOff)
        : DEFAULT_PREFERENCES.defaultHolder2YOff,
    };
  });
  const [sketch, setSketch] = useState<SketchSeg[]>(() => {
    const fromSaved = normalizeSketch(SAVED?.sketch);
    if (fromSaved) return fromSaved;
    if (SAVED?.points && SAVED.points.length >= 2) return sketchFromPoints(SAVED.points);
    return sketchFromPoints(presetPoints(PRESETS[0]));
  });
  /* منبع مولد مسیر از اسکچ نمایشی جداست تا وقتی همهٔ لایه‌ها خاموش‌اند، درگ
     پروفایل بدون اجرای generate در هر فریم انجام شود؛ در pointerup همگام می‌شود. */
  const [generationSketch, setGenerationSketch] = useState<SketchSeg[]>(sketch);
  /* درگ می‌تواند در یک فریم ده‌ها pointermove تولید کند؛ G-code فقط برای آخرین
     هندسه همان فریم لازم است، نه همه وضعیت‌های میانی که هرگز نمایش داده نمی‌شوند. */
  const generationFrameRef = useRef<number | null>(null);
  const pendingGenerationSketchRef = useRef<SketchSeg[] | null>(null);
  const [params, setParams] = useState<Params>(() => {
    const base = normalizeParams(SAVED?.params, IS_LEGACY);
    /* در هر بار باز شدن نرم‌افزار، مقادیر پیش‌فرض جابجایی جی‌کد، فاصله‌های داخل‌تراشی و افست هلدر دوم از Preferences اعمال می‌شوند. */
    return {
      ...base,
      gcodeShiftX: preferences.defaultGcodeShiftX,
      gcodeShiftY: preferences.defaultGcodeShiftY,
      innerStartClearance: Math.min(MAX_INNER_DISTANCE, Math.max(MIN_INNER_DISTANCE, preferences.defaultInnerStartClearance)),
      innerEndTravel: Math.min(MAX_INNER_DISTANCE, Math.max(MIN_INNER_DISTANCE, preferences.defaultInnerEndTravel)),
      holder2: {
        xOff: Math.max(MIN_HOLDER2_OFFSET, preferences.defaultHolder2XOff),
        yOff: Math.max(MIN_HOLDER2_OFFSET, preferences.defaultHolder2YOff),
      },
    };
  });
  const [settings, setSettings] = useState<EdSettings>(() => {
    const s = SAVED?.settings;
    const legacyShowBore = (s as (Partial<EdSettings> & { showBore?: boolean }) | undefined)?.showBore;
    /* ۵۰/۵ پیش‌فرض نسخهٔ قبل بود؛ فقط همین جفت مقدار در ارتقای نسخه به ۱۰۰/۱۰ مهاجرت می‌کند. */
    const legacyGridDefaults =
      (SAVED?.version ?? 0) < 7 && s?.editGridSize === 50 && s?.editGridDivisions === 5;
    return {
      snap: s?.snap ?? 1,
      smartSnap: s?.smartSnap ?? true,
      snapTolerancePx: typeof s?.snapTolerancePx === "number" ? Math.min(30, Math.max(3, s.snapTolerancePx)) : 11,
      showRough: s?.showRough ?? false,
      showFinish: s?.showFinish ?? false,
      showOffset: s?.showOffset ?? false,
      showInnerRough: s?.showInnerRough ?? legacyShowBore ?? false,
      showInnerOffset: s?.showInnerOffset ?? legacyShowBore ?? false,
      showInnerFinish: s?.showInnerFinish ?? legacyShowBore ?? false,
      showRound: s?.showRound ?? false,
      showFace: s?.showFace ?? false,
      showBottom: s?.showBottom ?? false,
      showRapids: s?.showRapids ?? false,
      showGhost: s?.showGhost ?? false,
      showInnerArea: s?.showInnerArea ?? false,
      layerOpacity: typeof s?.layerOpacity === "number" && isFinite(s.layerOpacity)
        ? Math.min(1, Math.max(0.1, s.layerOpacity))
        : 1,
      editGridVisible: s?.editGridVisible ?? true,
      editGridSize: !legacyGridDefaults && typeof s?.editGridSize === "number" && isFinite(s.editGridSize)
        ? Math.min(500, Math.max(1, s.editGridSize))
        : 100,
      editGridDivisions: !legacyGridDefaults && typeof s?.editGridDivisions === "number" && isFinite(s.editGridDivisions)
        ? Math.min(20, Math.max(1, Math.round(s.editGridDivisions)))
        : 10,
    };
  });
  const allProfileLayersHidden =
    !settings.showRough &&
    !settings.showFinish &&
    !settings.showOffset &&
    !settings.showInnerRough &&
    !settings.showInnerOffset &&
    !settings.showInnerFinish &&
    !settings.showRound &&
    !settings.showFace &&
    !settings.showBottom &&
    !settings.showRapids &&
    !settings.showGhost;
  const [layout, setLayout] = useState<LayoutState>(() => normalizeLayout(SAVED?.layout));
  const [mode, setMode] = useState<"design" | "sim">("design");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [activePreset, setActivePreset] = useState<string | null>(SAVED?.activePreset ?? PRESETS[0].id);
  const [activeLine, setActiveLine] = useState(-1);
  const [isolatedOpId, setIsolatedOpId] = useState<number | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "warn" } | null>(null);
  const [, setHistVer] = useState(0);

  /* حالت ویرایش مسیر: فایل = برنامهٔ پایه + اوررایدِ تأییدشده (پیش از «تأیید» فایل دست‌نخورده است) */
  const [gcodeOvr, setGcodeOvr] = useState<GcodeOvrMap>(() => normGcodeOvr(SAVED?.gcodeOvr));
  const [referenceImages,setReferenceImages]=useState<ReferenceImage[]>(()=>normalizeReferenceImages(SAVED?.referenceImages));
  const initialProjectId = useRef(`project-${Date.now()}`);
  const [activeProjectId, setActiveProjectId] = useState(initialProjectId.current);
  const [projectTabs, setProjectTabs] = useState<ProjectTab[]>([{ id: initialProjectId.current, name: PRESETS.find(p=>p.id===activePreset)?.name ?? "پروژه بدون نام", sketch, params, gcodeOvr: normGcodeOvr(SAVED?.gcodeOvr), referenceImages, activePreset, savedSnapshot: null, past: [], future: [] }]);
  const normalizeStoredTab = (raw: unknown): ProjectTab | null => {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Partial<ProjectTab>;
    const id = typeof r.id === "string" && r.id ? r.id : `project-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const name = typeof r.name === "string" && r.name.trim() ? r.name : "پروژه بدون نام";
    const normSketch = Array.isArray(r.sketch) ? (normalizeSketch(r.sketch) ?? []) : [];
    const normParams = normalizeParams(r.params, false);
    const normOvr = normGcodeOvr(r.gcodeOvr as Saved["gcodeOvr"]);
    const normImgs = normalizeReferenceImages(r.referenceImages);
    return {
      id,
      name,
      sketch: normSketch,
      params: normParams,
      gcodeOvr: normOvr,
      referenceImages: normImgs,
      activePreset: typeof r.activePreset === "string" ? r.activePreset : null,
      savedSnapshot: typeof r.savedSnapshot === "string" ? r.savedSnapshot : null,
      past: Array.isArray(r.past) ? r.past : [],
      future: Array.isArray(r.future) ? r.future : [],
    };
  };
  const [recentProjects, setRecentProjects] = useState<ProjectTab[]>(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem("kharraat-recent-projects") || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeStoredTab).filter((t): t is ProjectTab => t !== null);
    } catch {
      return [];
    }
  });
  const [welcomeOpen, setWelcomeOpen] = useState(true);
  const [confirmClearRecent, setConfirmClearRecent] = useState(false);
  const initialProjectSnapshot = useRef(projectSnapshot(sketch, params, normGcodeOvr(SAVED?.gcodeOvr), referenceImages));
  const projectTabsHydrated = useRef(false);
  const persistableTabs = (tabs: ProjectTab[]) => tabs.filter(tab => !(tab.id === initialProjectId.current && projectSnapshot(tab.sketch, tab.params, tab.gcodeOvr, tab.referenceImages) === initialProjectSnapshot.current));
  const projectTabsRef = useRef(projectTabs);
  projectTabsRef.current = projectTabs;
  useEffect(() => {
    // فهرست اخیر باید مجموعهٔ همهٔ تب‌ها باشد، نه فقط تب فعال یا آخرین تب بسته‌شده.
    if (!projectTabsHydrated.current) { projectTabsHydrated.current = true; return; }
    const currentTabs = persistableTabs(projectTabs);
    if (!currentTabs.length) return;
    setRecentProjects(previous => {
      const byId = new Map<string, ProjectTab>();
      for (const tab of persistableTabs(previous)) byId.set(tab.id, tab);
      // تب‌های جدیدتر در ابتدای فهرست قرار می‌گیرند؛ ترتیب تب‌های داخل پروژه
      // از چپ به راست/قدیمی به جدید است، بنابراین از انتها وارد می‌کنیم.
      for (const tab of [...currentTabs].reverse()) { byId.delete(tab.id); byId.set(tab.id, tab); }
      const merged = Array.from(byId.values()).slice(0, 30);
      saveRecentProjectsSafe(merged);
      return merged;
    });
  }, [projectTabs]);
  useEffect(() => {
    const saveAllOpenTabs = () => {
      const open = persistableTabs(projectTabsRef.current);
      if (!open.length) return;
      saveRecentProjectsSafe(open);
    };
    // visibilitychange هنگام بارگذاری اولیه نیز ممکن است اجرا شود و تب موقت اولیه
    // را روی فهرست ذخیره‌شده بنویسد؛ فقط خروج واقعی مرورگر معتبر است.
    window.addEventListener("beforeunload", saveAllOpenTabs);
    return () => { window.removeEventListener("beforeunload", saveAllOpenTabs); };
  }, []);
  const [pendingCloseProject, setPendingCloseProject] = useState<string|null>(null);
  const [newProjectDraft,setNewProjectDraft]=useState<{name:string;diameter:string;length:string}|null>(null);
  const [pendingEditExit, setPendingEditExit] = useState(false);
  const pendingExitActionRef = useRef<(() => void) | null>(null);
  const [saveThenCloseProject, setSaveThenCloseProject] = useState<string|null>(null);
  const [editBuf, setEditBuf] = useState<EditBuf | null>(null);
  /* بافر همگام‌شده با نرخ فریم برای پیش‌نمایش زندهٔ G-code هنگام کشیدن پیوسته بدون افت فریم */
  const [liveEditBuf, setLiveEditBuf] = useState<EditBuf | null>(null);
  const liveEditFrameRef = useRef<number | null>(null);
  const pendingLiveEditBufRef = useRef<EditBuf | null>(null);
  /* وضعیت تأییدشده پیش از ورود به ویرایش مسیر تا در صورت خروج بدون تأیید بازیابی شود */
  const [editEntry, setEditEntry] = useState<EditEntrySnapshot | null>(null);
  const editEntryRef = useRef<EditEntrySnapshot | null>(editEntry);
  editEntryRef.current = editEntry;
  const keptDraftRef = useRef<{ editBuf: EditBuf; draftParams: Params; baseline: string } | null>(null);
  /* باز/بسته‌بودن UI از وجود پیش‌نویس جداست تا خروج تصادفی، تغییرات تأییدنشده را پاک نکند. */
  const [editOpen, setEditOpen] = useState(false);
  const editOpenRef = useRef(editOpen);
  editOpenRef.current = editOpen;
  const editBufRef = useRef<EditBuf | null>(editBuf);
  const editBaselineRef = useRef<string>("");
  editBufRef.current = editBuf;
  /* تغییر preset هندسه و پارامترهای مولد را هم‌زمان عوض می‌کند؛ اگر پیش‌نویس
     مسیر وجود داشته باشد باید بعد از تولید برنامهٔ جدید از نو seed شود. */
  const presetReseedRef = useRef(false);

  /* مبنای بازسازی زندهٔ پیش‌نویس هنگام تغییر پارامترهای مولد مسیر. */
  const pendingParamRebaseRef = useRef<{
    genBase: GenResult;
    params: Params;
    gcodeOvr: GcodeOvrMap;
  } | null>(null);

  const flushLiveEditBuf = useCallback((next: EditBuf | null) => {
    if (liveEditFrameRef.current != null) {
      cancelAnimationFrame(liveEditFrameRef.current);
      liveEditFrameRef.current = null;
    }
    pendingLiveEditBufRef.current = null;
    setLiveEditBuf(next);
  }, []);

  useEffect(() => () => {
    if (liveEditFrameRef.current != null) cancelAnimationFrame(liveEditFrameRef.current);
  }, []);

  const past = useRef<HistEntry[]>([]);
  const future = useRef<HistEntry[]>([]);
  const toastTimer = useRef<number | null>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const projectHandlesRef = useRef(new Map<string, { name?: string; createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> }>());
  const stateRef = useRef({ sketch, gcodeOvr, editBuf, editOpen, params, editEntry });
  stateRef.current = { sketch, gcodeOvr, editBuf, editOpen, params, editEntry };
  const committedSketch = editOpen && editEntry ? editEntry.sketch : sketch;
  const committedParams = editOpen && editEntry ? editEntry.params : params;
  const committedGcodeOvr = editOpen && editEntry ? editEntry.gcodeOvr : gcodeOvr;
  const committedActivePreset = editOpen && editEntry ? editEntry.activePreset : activePreset;
  useEffect(() => {
    setProjectTabs(tabs => tabs.map(tab => tab.id===activeProjectId ? { ...tab, sketch: committedSketch, params: committedParams, gcodeOvr: committedGcodeOvr, referenceImages, activePreset: committedActivePreset } : tab));
  }, [activeProjectId, committedSketch, committedParams, committedGcodeOvr, referenceImages, committedActivePreset]);
  const switchProject = (id: string) => {
    if(id===activeProjectId)return;const tab=projectTabs.find(t=>t.id===id);if(!tab)return;
    /* تاریخچه تب مبدأ پیش از سوییچ ذخیره و تاریخچه مستقل مقصد بازیابی می‌شود. */
    setProjectTabs(tabs=>tabs.map(t=>t.id===activeProjectId?{...t,past:[...past.current],future:[...future.current]}:t));
    setActiveProjectId(id);setSketch(tab.sketch);setGenerationSketch(tab.sketch);setParams(tab.params);setGcodeOvr(tab.gcodeOvr);setReferenceImages(normalizeReferenceImages(tab.referenceImages));setActivePreset(tab.activePreset);
    const limit=Math.min(200,Math.max(1,Math.round(preferences.historyLimit)));
    keptDraftRef.current=null;pendingExitActionRef.current=null;setPendingEditExit(false);setEditEntry(null);
    setSelectedIds([]);setEditBuf(null);flushLiveEditBuf(null);setEditOpen(false);past.current=(tab.past??[]).slice(-limit);future.current=(tab.future??[]).slice(-limit);setHistVer(v=>v+1);
  };
  const finishCloseProject = (id:string) => {
    const closed = projectTabs.find(t=>t.id===id);
    const remaining=projectTabs.filter(t=>t.id!==id);
    // هنگام بستن تک‌تک تب‌ها، همان تب بسته‌شده باید در صدر فهرست اخیر قرار بگیرد.
    const ordered = closed ? [closed, ...remaining, ...recentProjects] : [...remaining, ...recentProjects];
    const seen = new Set<string>();
    const recent = ordered.filter(tab => !seen.has(tab.id) && (seen.add(tab.id), true)).slice(0, 30);
    setRecentProjects(recent); saveRecentProjectsSafe(recent);
    projectHandlesRef.current.delete(id);
    if(remaining.length){setProjectTabs(remaining);if(id===activeProjectId){const next=remaining[Math.max(0,projectTabs.findIndex(t=>t.id===id)-1)]??remaining[0];setActiveProjectId(next.id);setSketch(next.sketch);setGenerationSketch(next.sketch);setParams(next.params);setGcodeOvr(next.gcodeOvr);setReferenceImages(normalizeReferenceImages(next.referenceImages));setActivePreset(next.activePreset);past.current=[...(next.past??[])];future.current=[...(next.future??[])];setHistVer(v=>v+1);}}
    else { setProjectTabs([]); setWelcomeOpen(true); }
    keptDraftRef.current=null;pendingExitActionRef.current=null;setPendingEditExit(false);setEditEntry(null);
    setPendingCloseProject(null);setSelectedIds([]);setEditBuf(null);flushLiveEditBuf(null);setEditOpen(false);
  };
  const requestCloseProject=(id:string)=>{const tab=projectTabs.find(t=>t.id===id);if(!tab)return;const dirty=tab.savedSnapshot!==projectSnapshot(tab.sketch,tab.params,tab.gcodeOvr,tab.referenceImages);if(dirty)setPendingCloseProject(id);else finishCloseProject(id);};
  const openNewProject=()=>{
    setWelcomeOpen(false);
    let number=1;
    while(projectTabs.some(tab=>tab.name===`پروژه جدید ${number}`))number++;
    setNewProjectDraft({name:`پروژه جدید ${number}`,diameter:String(params.blankD),length:String(params.blankL)});
  };
  const createNewProject=()=>{
    if(!newProjectDraft)return;
    const diameter=Number(newProjectDraft.diameter),length=Number(newProjectDraft.length),name=newProjectDraft.name.trim();
    if(!(diameter>=0.01&&diameter<=10000)||!(length>=0.01&&length<=10000)){showToast("قطر و طول قطعه باید بین ۰٫۰۱ تا ۱۰۰۰۰ میلی‌متر باشند","warn");return;}
    const id=`project-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const nextParams=normalizeParams({
      ...params,
      blankD:diameter,
      blankL:length,
      gcodeShiftX:preferences.defaultGcodeShiftX,
      gcodeShiftY:preferences.defaultGcodeShiftY,
      innerStartClearance:Math.min(MAX_INNER_DISTANCE,Math.max(MIN_INNER_DISTANCE,preferences.defaultInnerStartClearance)),
      innerEndTravel:Math.min(MAX_INNER_DISTANCE,Math.max(MIN_INNER_DISTANCE,preferences.defaultInnerEndTravel)),
      holder2:{
        xOff:Math.max(MIN_HOLDER2_OFFSET,preferences.defaultHolder2XOff),
        yOff:Math.max(MIN_HOLDER2_OFFSET,preferences.defaultHolder2YOff),
      },
      split:{...params.split,enabled:false},
      innerZoneOrder:[],
      innerZoneBounds:[],
    },false);
    /* پروژه تازه در لحظه ایجاد وضعیت تمیز دارد؛ هشدار فقط پس از نخستین تغییر
       واقعی نسبت به همین Snapshot نمایش داده می‌شود. */
    const initialSnapshot=projectSnapshot([],nextParams,{},[]);
    setProjectTabs(tabs=>[...tabs.map(tab=>tab.id===activeProjectId?{...tab,past:[...past.current],future:[...future.current]}:tab),{id,name:name||`پروژه جدید ${tabs.length+1}`,sketch:[],params:nextParams,gcodeOvr:{},referenceImages:[],activePreset:null,savedSnapshot:initialSnapshot,past:[],future:[]}]);
    keptDraftRef.current=null;pendingExitActionRef.current=null;setPendingEditExit(false);setEditEntry(null);
    setActiveProjectId(id);setSketch([]);setGenerationSketch([]);setParams(nextParams);setGcodeOvr({});setReferenceImages([]);setActivePreset(null);setSelectedIds([]);setEditBuf(null);flushLiveEditBuf(null);setEditOpen(false);past.current=[];future.current=[];setHistVer(v=>v+1);setNewProjectDraft(null);
  };

  /* تاریخچهٔ یکپارچه: هر گام = {اسکچ، اورراید جی‌کد، بافر ادیت} — واگرد بعد از تأیید
     دقیقاً به همان حالت ادیت و آخرین تغییر بازمی‌گردد (خواستهٔ کاربر) */
  const snap = (): HistEntry => ({ ...stateRef.current });
  const pushPast = (e: HistEntry) => {
    const limit = Math.min(200, Math.max(1, Math.round(preferences.historyLimit)));
    past.current.push(e);
    if (past.current.length > limit) past.current.splice(0, past.current.length - limit);
    /* هر تغییر تازه شاخهٔ تاریخچه را عوض می‌کند؛ Redo قبلی دیگر معتبر نیست. */
    future.current = [];
  };

  /* پروفایل نقطه‌ای برای موتور تراش — حالت عادی تخت، حالت کاسه دوشاخه (Split) */
  const { points, innerPoints, outerFinishPoints, splitInfo } = useMemo(
    () => computeProfileBranches(generationSketch, params.split, params.blankD, params.blankL),
    [generationSketch, params.split, params.blankD, params.blankL]
  );

  useEffect(() => {
    if (!allProfileLayersHidden && generationSketch !== sketch) setGenerationSketch(sketch);
  }, [allProfileLayersHidden, generationSketch, sketch]);

  const generationParams = useMemo<Params>(() => ({ ...params, rpm: preferences.spindleSpeed, format: preferences.gcodeFormat, lineNumbers: preferences.sequenceNumbers, ramp: preferences.continuousPaths, safeBottomInnerLink: preferences.safeBottomInnerLink, innerBoundaryRoutingMode: preferences.innerBoundaryRoutingMode, simpleFeed: preferences.optimizeFeeds, spreadG0: preferences.spreadRapid, feedByKind: { ...preferences.operationFeeds, roughz: preferences.operationFeeds.rough, copy: preferences.operationFeeds.rough } }), [params, preferences.operationFeeds, preferences.spindleSpeed, preferences.gcodeFormat, preferences.sequenceNumbers, preferences.continuousPaths, preferences.safeBottomInnerLink, preferences.innerBoundaryRoutingMode, preferences.optimizeFeeds, preferences.spreadRapid]);
  const genBase = useMemo(() => generate(points, generationParams, innerPoints, outerFinishPoints), [points, generationParams, innerPoints, outerFinishPoints]);

  const gen = useMemo(() => applyGcodeOvr(genBase, gcodeOvr, generationParams), [genBase, gcodeOvr, generationParams]);

  /* پیش‌نمایش زندهٔ جی‌کد در حالت ویرایش مسیر بدون نیاز به فشردن دکمهٔ تأیید */
  const activeDraftBuf = editOpen ? (liveEditBuf ?? editBuf) : null;
  const liveGen = useMemo(() => {
    if (!editOpen || !activeDraftBuf) return null;
    const draftHolder2 = activeDraftBuf.holder2 ?? params.holder2;
    const draftSplit = activeDraftBuf.split ?? params.split;
    const sketchChanged = activeDraftBuf.sketch !== sketch;
    const holder2Changed =
      draftHolder2.xOff !== params.holder2.xOff || draftHolder2.yOff !== params.holder2.yOff;
    const draftGenerationParams: Params = holder2Changed
      ? { ...generationParams, holder2: draftHolder2 }
      : generationParams;
    const draftParams: Params = holder2Changed
      ? { ...params, holder2: draftHolder2 }
      : params;
    const draftBranches = sketchChanged
      ? computeProfileBranches(activeDraftBuf.sketch, draftSplit, params.blankD, params.blankL)
      : { points, innerPoints, outerFinishPoints };
    const draftGenBase = holder2Changed || sketchChanged
      ? generate(draftBranches.points, draftGenerationParams, draftBranches.innerPoints, draftBranches.outerFinishPoints)
      : genBase;
    const draftOvr = deriveGcodeOvr(activeDraftBuf.verts, activeDraftBuf.lines, draftGenBase.segs, gcodeOvr, draftParams);
    return applyGcodeOvr(draftGenBase, draftOvr, draftGenerationParams);
  }, [editOpen, activeDraftBuf, params, sketch, generationParams, points, innerPoints, outerFinishPoints, genBase, gcodeOvr]);

  const displayGen = editOpen && liveGen ? liveGen : gen;

  /* پارامترهای برداشت مستقیماً توپولوژی مسیر را تغییر می‌دهند. پیش‌نویس فعلی
     ابتدا نسبت به برنامه قبلی به override تبدیل، سپس روی برنامه جدید اعمال
     می‌شود؛ بنابراین Polyline زنده به‌روز می‌شود و ویرایش‌های کاربر نیز تا
     جایی که کلید پایدار Segment وجود دارد حفظ می‌شوند. */
  useEffect(() => {
    const pending = pendingParamRebaseRef.current;
    if (!pending || presetReseedRef.current) return;
    pendingParamRebaseRef.current = null;
    setEditBuf((buf) => {
      if (!buf) return buf;
      const wasClean = JSON.stringify({ verts: buf.verts, lines: buf.lines, sketch: buf.sketch, holder2: buf.holder2, split: buf.split }) === editBaselineRef.current;
      /* آفست H2 در حالت ادیت بخشی از پیش‌نویس است. هنگام تغییر پارامترهای دیگر
         نباید به override هندسی تبدیل یا با مقدار تأییدشده بازنویسی شود. */
      const draftHolder2 = buf.holder2 ?? pending.params.holder2;
      const splitChangedExternally = JSON.stringify(params.split) !== JSON.stringify(pending.params.split);
      const nextSplit = splitChangedExternally ? { ...params.split } : (buf.split ?? { ...params.split });
      const oldDraftParams: Params = { ...pending.params, holder2: draftHolder2 };
      const newDraftParams: Params = { ...params, holder2: draftHolder2 };
      const draftOvr = deriveGcodeOvr(buf.verts, buf.lines, pending.genBase.segs, pending.gcodeOvr, oldDraftParams);
      const rebuilt = applyGcodeOvr(genBase, draftOvr, newDraftParams);
      const seed = seedGcodeEdit(rebuilt.segs, newDraftParams);

      /* انتخاب‌ها با کلید پایدار + شماره قطعه در همان حرکت منتقل می‌شوند. */
      const oldCount = new Map<string, number>();
      const tokenById = new Map<number, string>();
      for (const line of buf.lines) {
        const n = oldCount.get(line.key) ?? 0;
        oldCount.set(line.key, n + 1);
        tokenById.set(line.id, `${line.key}\u0000${n}`);
      }
      const selectedTokens = new Set((buf.selLines ?? []).map((id) => tokenById.get(id)).filter((token): token is string => !!token));
      const activeToken = buf.activeLine == null ? null : tokenById.get(buf.activeLine) ?? null;
      const newCount = new Map<string, number>();
      const selLines: number[] = [];
      let activeLine: number | null = null;
      for (const line of seed.lines) {
        const n = newCount.get(line.key) ?? 0;
        newCount.set(line.key, n + 1);
        const token = `${line.key}\u0000${n}`;
        if (selectedTokens.has(token)) selLines.push(line.id);
        if (token === activeToken) activeLine = line.id;
      }
      const nextBuf: EditBuf = { ...buf, verts: seed.verts, lines: seed.lines, selLines, activeLine, split: nextSplit };
      if (wasClean) {
        editBaselineRef.current = JSON.stringify({ verts: nextBuf.verts, lines: nextBuf.lines, sketch: nextBuf.sketch, holder2: nextBuf.holder2, split: nextBuf.split });
      }
      flushLiveEditBuf(nextBuf);
      return nextBuf;
    });
    setHistVer((v) => v + 1);
  }, [genBase, params, flushLiveEditBuf]);

  /* پس از اعمال preset، مسیر قدیمی با هندسه/ابعاد جدید مخلوط نمی‌شود؛ بافر
     تازه دقیقاً از خروجی جدید ساخته و انتخاب‌های قبلی پاک می‌شود. */
  useEffect(() => {
    if (!presetReseedRef.current) return;
    presetReseedRef.current = false;
    const seed = seedGcodeEdit(gen.segs, params);
    const nextEdit: EditBuf = { verts: seed.verts, lines: seed.lines, sketch, off: {}, holder2: { ...params.holder2 }, split: { ...params.split }, selLines: [], activeLine: null };
    const baseline = JSON.stringify({ verts: nextEdit.verts, lines: nextEdit.lines, sketch: nextEdit.sketch, holder2: nextEdit.holder2, split: nextEdit.split });
    editBaselineRef.current = baseline;
    keptDraftRef.current = null;
    setEditEntry({ sketch, params: cloneParams(params), gcodeOvr: {}, activePreset, baseline });
    setEditBuf(nextEdit);
    flushLiveEditBuf(nextEdit);
    commitRef.current = null;
    setHistVer((v) => v + 1);
  }, [gen, params, sketch, activePreset, flushLiveEditBuf]);

  /* ذخیره محلی (با تأخیر کوتاه تا کشیدن جداکننده پنجره‌ها بدون مکث اجرا شود) */
  const latestPersistPayloadRef = useRef<{
    sketch: SketchSeg[];
    params: Params;
    settings: EdSettings;
    preferences: AppPreferences;
    activePreset: string | null;
    layout: LayoutState;
    gcodeOvr: GcodeOvrMap;
    referenceImages: ReferenceImage[];
    version: number;
  } | null>(null);
  const persistPayloadToStore = (payload: NonNullable<typeof latestPersistPayloadRef.current>) => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(payload));
    } catch {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ ...payload, referenceImages: [] }));
      } catch {
        /* ignore */
      }
    }
  };
  useEffect(() => {
    const payload = { sketch: committedSketch, params: committedParams, settings, preferences, activePreset: committedActivePreset, layout, gcodeOvr: committedGcodeOvr, referenceImages, version: SAVE_VERSION };
    latestPersistPayloadRef.current = payload;
    const timer = window.setTimeout(() => {
      persistPayloadToStore(payload);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [committedSketch, committedParams, settings, preferences, committedActivePreset, layout, committedGcodeOvr, referenceImages]);

  useEffect(() => {
    const flushStore = () => {
      if (!latestPersistPayloadRef.current) return;
      persistPayloadToStore(latestPersistPayloadRef.current);
    };
    window.addEventListener("beforeunload", flushStore);
    return () => window.removeEventListener("beforeunload", flushStore);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    applyThemeToDocument(preferences.themeColors, preferences.theme);
    root.style.setProperty("--profile-line-width", String(preferences.lineWidth));
    root.style.setProperty("--profile-toolbar-scale", String(preferences.toolbarScale));
  }, [preferences]);

  useEffect(() => {
    const limit=Math.min(200,Math.max(1,Math.round(preferences.historyLimit)));
    if(past.current.length>limit)past.current.splice(0,past.current.length-limit);
    if(future.current.length>limit)future.current.splice(0,future.current.length-limit);
    setProjectTabs(tabs=>tabs.map(tab=>({...tab,past:(tab.past??[]).slice(-limit),future:(tab.future??[]).slice(-limit)})));
    setHistVer(v=>v+1);
  },[preferences.historyLimit]);

  useEffect(() => {
    if (!preferences.keepEditDraft) keptDraftRef.current = null;
    if (!preferences.keepEditDraft && !editOpen && editBuf) {
      setEditBuf(null);
      flushLiveEditBuf(null);
    }
  }, [preferences.keepEditDraft, editOpen, editBuf, flushLiveEditBuf]);

  /* هنگام تغییر برنامه در خارج از ویرایش مسیر، هایلایت جی‌کد پاک شود */
  useEffect(() => {
    if (!editOpen) setActiveLine(-1);
  }, [gen, editOpen]);

  /* در طراحی پروفایل، انتخاب خط نیز نزدیک‌ترین حرکت پرداختیِ متناظر را در جی‌کد
     نشان می‌دهد. در Edit path نگاشت دقیق‌تر بر پایهٔ ovrKey داخل ProfileEditor است. */
  useEffect(() => {
    if (mode !== "design" || editOpen) return;
    const selectedSeg = selectedIds.length
      ? sketch.find((segment) => segment.id === selectedIds[selectedIds.length - 1])
      : null;
    if (!selectedSeg) {
      setActiveLine(-1);
      return;
    }
    const target = segMid(selectedSeg);
    const finalPasses = gen.segs.filter((segment) =>
      segment.line >= 0 && segment.motion === 1 && (segment.kind === "finish" || segment.kind === "borefin")
    );
    const candidates = finalPasses.length
      ? finalPasses
      : gen.segs.filter((segment) => segment.line >= 0 && segment.motion === 1);
    let bestLine = -1;
    let bestDistance = Infinity;
    for (const segment of candidates) {
      const az = segment.z1, ar = segment.x1 / 2;
      const bz = segment.z2, br = segment.x2 / 2;
      const dz = bz - az, dr = br - ar;
      const len2 = dz * dz + dr * dr || 1;
      const t = Math.min(1, Math.max(0, ((target.z - az) * dz + (target.r - ar) * dr) / len2));
      const distance = Math.hypot(target.z - (az + dz * t), target.r - (ar + dr * t));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestLine = segment.line;
      }
    }
    setActiveLine(bestLine);
  }, [mode, editOpen, selectedIds, sketch, gen.segs]);

  const selectFromGCode = useCallback((lineIndex: number) => {
    setActiveLine(lineIndex);
    if (!editOpen) return;
    setEditBuf((current) => {
      if (!current) return current;
      const matching = current.lines.find((line) => editLineGCodeIndex(line.id, current.lines, displayGen) === lineIndex);
      if (!matching) return current;
      const next = { ...current, selLines: [matching.id], activeLine: matching.id };
      flushLiveEditBuf(next);
      return next;
    });
  }, [editOpen, displayGen, flushLiveEditBuf]);

  /* اگر عملیاتِ ایزوله‌شده حذف شد، از حالت ایزوله خارج شو */
  useEffect(() => {
    if (isolatedOpId != null && !params.ops.some((o) => o.id === isolatedOpId)) setIsolatedOpId(null);
  }, [params.ops, isolatedOpId]);

  /* واگرد / بازانجام روی اسکچ */
  const commitRef = useRef<HistEntry | null>(null);
  const restore = (e: HistEntry) => {
    /* هر rebase معلق متعلق به وضعیت جدیدتر است و نباید پس از Undo روی Snapshot
       بازیابی‌شده اجرا شود؛ این همان مسیری بود که خطوط و جی‌کد را خالی می‌کرد. */
    pendingParamRebaseRef.current = null;
    presetReseedRef.current = false;
    setSketch(e.sketch);
    setGenerationSketch(e.sketch);
    setGcodeOvr(e.gcodeOvr);
    setEditBuf(e.editBuf);
    flushLiveEditBuf(e.editBuf);
    setParams(e.params);
    const restoredEntry = e.editOpen ? (e.editEntry ?? editEntryRef.current) : null;
    if (restoredEntry?.baseline) editBaselineRef.current = restoredEntry.baseline;
    setEditEntry(restoredEntry);
    /* وجود پیش‌نویس به معنی بازبودن UI نیست. اگر کاربر پیش از تغییر استراتژی
       از ویرایش مسیر خارج شده بود، Undo نیز همان حالت بسته را بازیابی می‌کند. */
    setEditOpen(e.editOpen);
    setHistVer((v) => v + 1);
  };
  const undo = () => {
    if (past.current.length === 0) return;
    future.current.push(snap());
    commitRef.current = null;
    restore(past.current.pop()!);
  };
  const redo = () => {
    if (future.current.length === 0) return;
    past.current.push(snap());
    const limit = Math.min(200, Math.max(1, Math.round(preferences.historyLimit)));
    if (past.current.length > limit) past.current.splice(0, past.current.length - limit);
    commitRef.current = null;
    restore(future.current.pop()!);
  };
  const undoAny=()=>imageHistoryApi.current?.canUndo?imageHistoryApi.current.undo():undo();
  const redoAny=()=>imageHistoryApi.current?.canRedo?imageHistoryApi.current.redo():redo();

  /* ---------- حالت ویرایش مسیر ---------- */
  const openEdit = () => {
    if (editOpenRef.current) return;
    pushPast(snap());
    const seed = seedGcodeEdit(gen.segs, params);
    const cleanSeed: EditBuf = { verts: seed.verts, lines: seed.lines, sketch, off: {}, holder2: { ...params.holder2 }, split: { ...params.split }, selLines: [], activeLine: null };
    const cleanBaseline = JSON.stringify({ verts: cleanSeed.verts, lines: cleanSeed.lines, sketch: cleanSeed.sketch, holder2: cleanSeed.holder2, split: cleanSeed.split });
    const entrySnapshot: EditEntrySnapshot = {
      sketch,
      params: cloneParams(params),
      gcodeOvr: cloneGcodeOvr(gcodeOvr),
      activePreset,
      baseline: cleanBaseline,
    };
    setEditEntry(entrySnapshot);
    /* اگر گزینهٔ «حفظ پیش‌نویس ویرایش مسیر» روشن باشد و پیش‌نویس قبلی نگه داشته شده باشد، بازیابی شود */
    if (preferences.keepEditDraft && keptDraftRef.current) {
      const kept = keptDraftRef.current;
      editBaselineRef.current = cleanBaseline;
      pendingParamRebaseRef.current = null;
      setParams(cloneParams(kept.draftParams));
      setEditBuf(kept.editBuf);
      flushLiveEditBuf(kept.editBuf);
      setEditOpen(true);
      setHistVer((v) => v + 1);
      showToast("پیش‌نویس ویرایش مسیر بازیابی شد");
      return;
    }
    editBaselineRef.current = cleanBaseline;
    setEditBuf(cleanSeed);
    flushLiveEditBuf(cleanSeed);
    setEditOpen(true);
    setHistVer((v) => v + 1);
  };
  const requestExitEdit = (afterExit?: () => void) => {
    if (!editOpenRef.current) {
      afterExit?.();
      return;
    }
    commitRef.current = null;
    const eb = editBufRef.current;
    const entry = editEntryRef.current;
    const geomDirty = !!eb &&
      JSON.stringify({ verts: eb.verts, lines: eb.lines, sketch: eb.sketch, holder2: eb.holder2, split: eb.split }) !== editBaselineRef.current;
    const paramsDirty = !!entry && JSON.stringify(stateRef.current.params) !== JSON.stringify(entry.params);
    if (geomDirty || paramsDirty) {
      pendingExitActionRef.current = afterExit ?? null;
      setPendingEditExit(true);
      return;
    }
    keptDraftRef.current = null;
    setEditEntry(null);
    setEditBuf(null);
    flushLiveEditBuf(null);
    setEditOpen(false);
    afterExit?.();
  };
  const closeEdit = () => {
    requestExitEdit();
  };
  const revertEditAndExit = () => {
    pushPast(snap());
    if (preferences.keepEditDraft && editBufRef.current) {
      keptDraftRef.current = {
        editBuf: editBufRef.current,
        draftParams: cloneParams(params),
        baseline: editBaselineRef.current,
      };
    } else {
      keptDraftRef.current = null;
    }
    const entry = editEntryRef.current;
    commitRef.current = null;
    pendingParamRebaseRef.current = null;
    presetReseedRef.current = false;
    if (entry) {
      setSketch(entry.sketch);
      setGenerationSketch(entry.sketch);
      setParams(cloneParams(entry.params));
      setGcodeOvr(cloneGcodeOvr(entry.gcodeOvr));
      setActivePreset(entry.activePreset);
    }
    setEditEntry(null);
    setEditBuf(null);
    flushLiveEditBuf(null);
    setEditOpen(false);
    setPendingEditExit(false);
    const after = pendingExitActionRef.current;
    pendingExitActionRef.current = null;
    after?.();
    setHistVer((v) => v + 1);
    showToast(
      preferences.keepEditDraft
        ? "تغییرات تأیید نشد — تنظیمات قبلی نمایش داده شد (پیش‌نویس حفظ شد)"
        : "تغییرات تأیید نشد — تنظیمات قبلی بازیابی شد",
      "warn"
    );
  };
  const confirmEditAndExit = () => {
    const eb = editBufRef.current;
    if (eb) {
      const draftHolder2 = eb.holder2 ?? params.holder2;
      const draftSplit = eb.split ?? params.split;
      const sketchChanged = eb.sketch !== sketch;
      const holder2Changed =
        draftHolder2.xOff !== params.holder2.xOff || draftHolder2.yOff !== params.holder2.yOff;
      const splitChanged =
        draftSplit.enabled !== params.split.enabled ||
        draftSplit.z !== params.split.z ||
        draftSplit.r !== params.split.r ||
        draftSplit.swapped !== params.split.swapped;
      const draftParams: Params = holder2Changed ? { ...params, holder2: draftHolder2 } : params;
      const draftGenerationParams: Params = holder2Changed
        ? { ...generationParams, holder2: draftHolder2 }
        : generationParams;
      const draftBranches = sketchChanged
        ? computeProfileBranches(eb.sketch, draftSplit, params.blankD, params.blankL)
        : { points, innerPoints, outerFinishPoints };
      /* آفست H2 روی هندسهٔ ورود امن مولد نیز اثر دارد (گوشهٔ افقی→عمودی).
         پایهٔ پیش‌نویس دقیقاً با آفست زنده ساخته می‌شود تا جابه‌جایی خالص، override نسازد. */
      const draftGenBase = holder2Changed || sketchChanged
        ? generate(draftBranches.points, draftGenerationParams, draftBranches.innerPoints, draftBranches.outerFinishPoints)
        : genBase;
      const nextOvr = deriveGcodeOvr(eb.verts, eb.lines, draftGenBase.segs, gcodeOvr, draftParams);
      pushPast(snap());
      setGcodeOvr(nextOvr);
      if (holder2Changed || splitChanged) {
        /* عمداً از onParamsCb عبور نمی‌کند: بافر از قبل با همین آفست در فضای
           ماشین جابه‌جا شده و rebase دوباره باعث دوبرابرشدن حرکت می‌شود. */
        pendingParamRebaseRef.current = null;
        setParams((p) => ({
          ...p,
          ...(holder2Changed ? { holder2: { ...draftHolder2 } } : {}),
          ...(splitChanged ? { split: { ...draftSplit } } : {}),
        }));
      }
      if (sketchChanged) {
        setActivePreset(null);
        setSketch(eb.sketch);
        setGenerationSketch(eb.sketch);
      }
    }
    keptDraftRef.current = null;
    commitRef.current = null;
    setEditEntry(null);
    setEditBuf(null);
    flushLiveEditBuf(null);
    setEditOpen(false);
    setPendingEditExit(false);
    const after = pendingExitActionRef.current;
    pendingExitActionRef.current = null;
    after?.();
    setHistVer((v) => v + 1);
    showToast("تغییرات ویرایش مسیر تأیید شد ✓");
  };
  /* تغییرات بافر (خطوط/پروفایل/افست) — یک‌گام تاریخچه برای هر ژست + به‌روزرسانی زندهٔ جی‌کد */
  const onEditBuf = (next: EditBuf | null, commit: boolean) => {
    if (!commit) {
      if (!commitRef.current) commitRef.current = snap();
      setEditBuf(next);
      pendingLiveEditBufRef.current = next;
      if (liveEditFrameRef.current == null) {
        liveEditFrameRef.current = requestAnimationFrame(() => {
          liveEditFrameRef.current = null;
          setLiveEditBuf(pendingLiveEditBufRef.current);
        });
      }
      return;
    }
    const pend = commitRef.current ?? snap();
    commitRef.current = null;
    pushPast(pend);
    setEditBuf(next);
    flushLiveEditBuf(next);
    setHistVer((v) => v + 1);
  };

  const showToast = useCallback((msg: string, kind: "ok" | "warn" = "ok") => {
    setToast({ msg, kind });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  /* کال‌بک‌های پایدار: هویت ثابت تا فرزندهای memo هنگام تیک شبیه‌سازی بازرندر نشوند */
  const onParamsCb = useCallback((patch: Partial<Params>) => {
    let historicalChange = false;
    if (patch.split) {
      const before = stateRef.current.params.split;
      historicalChange = before.enabled !== patch.split.enabled || before.z !== patch.split.z ||
        before.r !== patch.split.r || before.swapped !== patch.split.swapped;
    }
    if (patch.ops) {
      historicalChange = historicalChange || JSON.stringify(stateRef.current.params.ops) !== JSON.stringify(patch.ops);
    }
    if (historicalChange) {
      /* تغییر استراتژی نیز باید اتمیک باشد: Params و EditBuf پیش از rebase با هم
         ذخیره می‌شوند تا Undo هر دو را به یک نسل از جی‌کد برگرداند. */
      pushPast(snap());
      setHistVer((v) => v + 1);
    }
    if (!editOpenRef.current) keptDraftRef.current = null;
    if (editBufRef.current && !pendingParamRebaseRef.current) {
      pendingParamRebaseRef.current = { genBase, params, gcodeOvr };
    }
    setParams((p) => {
      const next = { ...p, ...patch };
      /* تعیین Split برای نخستین بار، ذاتاً طرح را دوشاخه می‌کند؛ بنابراین
         استراتژی داخل+خارج و حداقل آفست معتبر H2 هم‌زمان فعال می‌شوند. */
      if (patch.split?.enabled && !p.split.enabled) {
        const bowl = STRATEGIES.find((st) => st.id === "bowl")!;
        next.ops = makeOps(bowl.types);
        next.holder2 = {
          xOff: Math.max(MIN_HOLDER2_OFFSET, p.holder2.xOff),
          yOff: Math.max(MIN_HOLDER2_OFFSET, p.holder2.yOff),
        };
      }
      return next;
    });
  }, [genBase, params, gcodeOvr]);
  const onHolder2SettingsCb = useCallback((value: Holder2State) => {
    const next: Holder2State = {
      xOff: Math.max(MIN_HOLDER2_OFFSET, value.xOff),
      yOff: Math.max(MIN_HOLDER2_OFFSET, value.yOff),
    };
    const eb = editBufRef.current;
    if (editOpenRef.current && eb) {
      const prev = eb.holder2 ?? stateRef.current.params.holder2;
      const verts = translateHolder2Edit(
        eb.verts,
        eb.lines,
        next.xOff - prev.xOff,
        prev.yOff - next.yOff
      );
      onEditBuf({ ...eb, verts, holder2: next }, true);
      return;
    }
    onParamsCb({ holder2: next });
    // onEditBuf بر پایه refهای پایدار کار می‌کند؛ هویت callback فقط با پارامتر مولد عوض می‌شود.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onParamsCb]);
  const onStrategyCb = useCallback((id: string, name: string, types: OpType[]) => {
    /* انتخاب استراتژی یک Reset اتمیک است؛ Snapshot کامل پیش از آن نگه داشته
       می‌شود تا Ctrl+Z پارامترها، Overrideها و Edit Path را یکجا برگرداند. */
    pushPast(snap());
    commitRef.current = null;
    pendingParamRebaseRef.current = null;
    keptDraftRef.current = null;
    setEditEntry(null);
    setGcodeOvr({});
    setEditBuf(null);
    flushLiveEditBuf(null);
    setEditOpen(false);
    setParams((current) => ({
      ...current,
      ops: makeOps(types),
      ...(id === "bowl" ? {
        holder2: {
          xOff: Math.max(MIN_HOLDER2_OFFSET, current.holder2.xOff),
          yOff: Math.max(MIN_HOLDER2_OFFSET, current.holder2.yOff),
        },
      } : {}),
    }));
    setHistVer((value) => value + 1);
    showToast(`استراتژی «${name}» فعال شد`);
  }, [showToast, flushLiveEditBuf]);

  /* ---------- چیدمان داک (پنجره‌ها) ---------- */
  const dockRowRef = useRef<HTMLDivElement>(null);
  const [dockRowState, setDockRowState] = useState<{ width: number; isRow: boolean }>(() => {
    const w = typeof window !== "undefined" ? window.innerWidth : 1280;
    return { width: w, isRow: w >= 896 };
  });
  useEffect(() => {
    const el = dockRowRef.current;
    if (!el) return;
    const sync = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const isRow = getComputedStyle(el).flexDirection.startsWith("row");
      setDockRowState((prev) => (prev.width === w && prev.isRow === isRow ? prev : { width: w, isRow }));
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setPanel = useCallback((id: PanelId, patch: Partial<PanelState>) => {
    setLayout((l) => ({ ...l, [id]: { ...l[id], ...patch } }));
  }, []);
  const togglePanel = useCallback((id: PanelId) => {
    setLayout((l) => ({ ...l, [id]: { ...l[id], open: !l[id].open } }));
  }, []);
  const toggleCollapse = useCallback((id: PanelId) => {
    setLayout((l) => ({ ...l, [id]: { ...l[id], collapsed: !l[id].collapsed } }));
  }, []);
  const resizeSplitter = useCallback((splitIdx: number, dx: number) => {
    const step = Math.round(dx);
    if (step === 0) return;
    const el = dockRowRef.current;
    const rowW = el?.clientWidth || window.innerWidth;
    const isRow = el ? getComputedStyle(el).flexDirection.startsWith("row") : rowW >= 896;
    if (!isRow) return;

    setLayout((l) => {
      const { activeIds, openSideIds, flexPanelId, totalActiveWidth, minById } = computeSideBudget(l, rowW);
      if (splitIdx < 0 || splitIdx >= activeIds.length - 1) return l;

      const eff = getEffectiveSideSizes(l, rowW, true);
      const sideSum = openSideIds.reduce((acc, p) => acc + eff[p], 0);
      const curW: Record<PanelId, number> = { ...eff };
      if (flexPanelId) {
        curW[flexPanelId] = Math.max(minById[flexPanelId], totalActiveWidth - sideSum);
      }
      const maxW = (pid: PanelId) => (pid === flexPanelId ? MAX_UNBOUNDED_PANEL : panelMaxWidth(pid));

      /* در چیدمان RTL (راست به چپ):
         - کشیدن جداکننده به چپ (step < 0): پنلِ سمت راستِ جداکننده فقط از لبهٔ چپش بزرگ می‌شود؛
           پنل‌های سمت راستِ آن کاملاً قفل می‌مانند تا هرگز از سمت راست رشد نکند.
         - کشیدن جداکننده به راست (step > 0): پنلِ سمت چپِ جداکننده فقط از لبهٔ راستش بزرگ می‌شود؛
           پنل‌های سمت چپِ آن کاملاً قفل می‌مانند تا هرگز از سمت چپ رشد نکند. */
      const want = Math.abs(step);
      const growId = step < 0 ? activeIds[splitIdx] : activeIds[splitIdx + 1];
      const shrinkChain =
        step < 0
          ? activeIds.slice(splitIdx + 1)
          : activeIds.slice(0, splitIdx + 1).reverse();

      const growCap = Math.max(0, maxW(growId) - curW[growId]);
      const shrinkCap = shrinkChain.reduce((acc, pid) => acc + Math.max(0, curW[pid] - minById[pid]), 0);
      const delta = Math.min(want, growCap, shrinkCap);
      if (delta <= 0) return l;

      const nextW: Record<PanelId, number> = { ...curW };
      nextW[growId] += delta;
      let rem = delta;
      for (const pid of shrinkChain) {
        if (rem <= 0) break;
        const give = Math.min(rem, Math.max(0, nextW[pid] - minById[pid]));
        nextW[pid] -= give;
        rem -= give;
      }

      let changed = false;
      const nextLayout: LayoutState = { ...l };
      for (const p of openSideIds) {
        if (nextLayout[p].size !== nextW[p]) {
          nextLayout[p] = { ...nextLayout[p], size: nextW[p] };
          changed = true;
        }
      }
      return changed ? nextLayout : l;
    });
  }, []);
  const swapPanels = useCallback((a: PanelId, b: PanelId) => {
    if (a === b) return;
    setLayout((l) => {
      const cur = Array.isArray(l.order) ? l.order : PANEL_IDS;
      const ia = cur.indexOf(a);
      const ib = cur.indexOf(b);
      if (ia < 0 || ib < 0) return l;
      const nextOrder = [...cur];
      nextOrder[ia] = b;
      nextOrder[ib] = a;
      return { ...l, order: nextOrder };
    });
  }, []);
  useEffect(() => {
    if (!Array.isArray(layout.order)) {
      setLayout((l) => normalizeLayout(l));
    }
  }, [layout]);
  const resetPanelSize = useCallback((id: PanelId) => {
    const defSize = defaultLayout()[id].size;
    const el = dockRowRef.current;
    const rowW = el?.clientWidth || window.innerWidth;
    const isRow = el ? getComputedStyle(el).flexDirection.startsWith("row") : rowW >= 896;
    setLayout((l) => {
      if (!isRow) return { ...l, [id]: { ...l[id], size: defSize } };
      const { openSideIds, maxSideSum, minById } = computeSideBudget(l, rowW);
      if (!openSideIds.includes(id)) return { ...l, [id]: { ...l[id], size: defSize } };
      const minSelf = minById[id];
      const eff = getEffectiveSideSizes(l, rowW, true);
      const otherSum = openSideIds.filter((p) => p !== id).reduce((acc, p) => acc + eff[p], 0);
      const clamped = Math.max(minSelf, Math.min(defSize, Math.max(minSelf, maxSideSum - otherSum)));
      const nextLayout: LayoutState = { ...l };
      for (const p of openSideIds) {
        nextLayout[p] = { ...nextLayout[p], size: p === id ? clamped : eff[p] };
      }
      return nextLayout;
    });
  }, []);
  const resetLayout = useCallback(() => {
    setLayout(defaultLayout());
    showToast("چیدمان پنجره‌ها بازنشانی شد");
  }, [showToast]);
  const panelVis = (id: PanelId): PanelVis =>
    !layout[id].open ? "closed" : layout[id].collapsed ? "collapsed" : "open";

  /* درگ نوار بالای پنجره‌ها برای جابه‌جایی جای دو پنجره با هم */
  const [panelDrag, setPanelDrag] = useState<{
    sourceId: PanelId;
    targetId: PanelId | null;
    x: number;
    y: number;
  } | null>(null);
  const panelDragRef = useRef<{
    sourceId: PanelId;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    targetId: PanelId | null;
    prevCursor: string;
    prevSelect: string;
  } | null>(null);

  const startPanelDrag = useCallback((id: PanelId, e: React.PointerEvent<HTMLElement>) => {
    panelDragRef.current = {
      sourceId: id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      targetId: null,
      prevCursor: document.body.style.cursor,
      prevSelect: document.body.style.userSelect,
    };
  }, []);

  useEffect(() => {
    const clearDrag = () => {
      const d = panelDragRef.current;
      if (!d) return;
      if (d.active) {
        document.body.style.cursor = d.prevCursor;
        document.body.style.userSelect = d.prevSelect;
      }
      panelDragRef.current = null;
      setPanelDrag(null);
    };
    const onMove = (e: PointerEvent) => {
      const d = panelDragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      if (!d.active) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return;
        d.active = true;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
      }
      let over: PanelId | null = null;
      for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
        if (el instanceof HTMLElement && el.dataset.dockPanelId) {
          const pid = el.dataset.dockPanelId as PanelId;
          if (pid !== d.sourceId) over = pid;
          break;
        }
      }
      d.targetId = over;
      setPanelDrag({ sourceId: d.sourceId, targetId: over, x: e.clientX, y: e.clientY });
    };
    const onUp = (e: PointerEvent) => {
      const d = panelDragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const shouldSwap = d.active && d.targetId && d.targetId !== d.sourceId ? [d.sourceId, d.targetId] as const : null;
      clearDrag();
      if (shouldSwap) swapPanels(shouldSwap[0], shouldSwap[1]);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && panelDragRef.current) clearDrag();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [swapPanels]);

  /* تغییر اسکچ — با commit=false تغییر زنده (کشیدن) و با true ثبت در تاریخچه */
  const onSketchChange = useCallback((next: SketchSeg[], commit: boolean, splitPatch?: SplitState) => {
    /* در حالت ادیت، ویرایش پروفایل روی کپیِ کاریِ بافر می‌نشیند (فایل تا «تأیید» عوض نمی‌شود) */
    if (editOpenRef.current && editBufRef.current) {
      if (!commit && !commitRef.current) commitRef.current = snap();
      onEditBuf({ ...editBufRef.current, sketch: next, ...(splitPatch ? { split: splitPatch } : {}) }, commit);
      return;
    }
    if (commit) {
      pushPast(commitRef.current ?? snap());
      commitRef.current = null;
      setActivePreset(null);
    } else if (!commitRef.current) {
      commitRef.current = snap(); // وضعیت پیش از شروع کشیدن
    } else if (
      JSON.stringify(next) === JSON.stringify(commitRef.current.sketch) &&
      JSON.stringify(splitPatch ?? stateRef.current.params.split) === JSON.stringify(commitRef.current.params.split)
    ) {
      commitRef.current = null;
    }
    keptDraftRef.current = null;
    setSketch(next);
    if (splitPatch) {
      if (editBufRef.current && !pendingParamRebaseRef.current) {
        pendingParamRebaseRef.current = { genBase, params: stateRef.current.params, gcodeOvr: stateRef.current.gcodeOvr };
      }
      setParams((p) => ({ ...p, split: splitPatch }));
    }
    if (commit) {
      if (generationFrameRef.current != null) cancelAnimationFrame(generationFrameRef.current);
      generationFrameRef.current = null;pendingGenerationSketchRef.current = null;
      setGenerationSketch(next);
    } else if (!allProfileLayersHidden) {
      pendingGenerationSketchRef.current = next;
      if (generationFrameRef.current == null) generationFrameRef.current = requestAnimationFrame(() => {
        generationFrameRef.current = null;
        const latest=pendingGenerationSketchRef.current;pendingGenerationSketchRef.current=null;
        if(latest)setGenerationSketch(latest);
      });
    }
    /* اگر پیش‌نویس پنهان وجود دارد، اسکچ جدید را نیز در آن همگام نگه می‌داریم
       تا بازگشت و تأیید بعدی، تغییرات تازهٔ طراحی را بازنویسی نکند. */
    if (editBufRef.current && !editOpenRef.current) {
      setEditBuf({ ...editBufRef.current, sketch: next, ...(splitPatch ? { split: splitPatch } : {}) });
    }
    setHistVer((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketch, gcodeOvr, genBase, allProfileLayersHidden]);

  const onSplitChange = useCallback((nextSplit: SplitState, commit = true) => {
    if (editOpenRef.current && editBufRef.current) {
      onEditBuf({ ...editBufRef.current, split: nextSplit }, commit);
      return;
    }
    if (!commit) {
      if (!commitRef.current) {
        commitRef.current = snap();
      } else if (JSON.stringify(nextSplit) === JSON.stringify(commitRef.current.params.split)) {
        commitRef.current = null;
      }
      if (editBufRef.current && !pendingParamRebaseRef.current) {
        pendingParamRebaseRef.current = { genBase, params: stateRef.current.params, gcodeOvr: stateRef.current.gcodeOvr };
      }
      setParams((p) => ({ ...p, split: nextSplit }));
      return;
    }
    if (commitRef.current) {
      const pend = commitRef.current;
      commitRef.current = null;
      const before = pend.params.split;
      const changed =
        before.enabled !== nextSplit.enabled ||
        before.z !== nextSplit.z ||
        before.r !== nextSplit.r ||
        before.swapped !== nextSplit.swapped;
      if (changed) {
        pushPast(pend);
        setHistVer((v) => v + 1);
      }
      if (editBufRef.current && !pendingParamRebaseRef.current) {
        pendingParamRebaseRef.current = { genBase, params: stateRef.current.params, gcodeOvr: stateRef.current.gcodeOvr };
      }
      setParams((p) => ({ ...p, split: nextSplit }));
      return;
    }
    onParamsCb({ split: nextSplit });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genBase, onParamsCb]);

  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const onPreferencesChange = useCallback((next: AppPreferences) => {
    const prev = preferencesRef.current;
    const topologyPrefChanged =
      next.continuousPaths !== prev.continuousPaths ||
      next.safeBottomInnerLink !== prev.safeBottomInnerLink ||
      next.innerBoundaryRoutingMode !== prev.innerBoundaryRoutingMode ||
      next.spreadRapid !== prev.spreadRapid;
    if (topologyPrefChanged && editBufRef.current && !pendingParamRebaseRef.current) {
      pendingParamRebaseRef.current = { genBase, params: stateRef.current.params, gcodeOvr: stateRef.current.gcodeOvr };
    }
    setPreferences(next);
    const patch: Partial<Params> = {};
    if (next.defaultGcodeShiftX !== prev.defaultGcodeShiftX && stateRef.current.params.gcodeShiftX === prev.defaultGcodeShiftX) {
      patch.gcodeShiftX = next.defaultGcodeShiftX;
    }
    if (next.defaultGcodeShiftY !== prev.defaultGcodeShiftY && stateRef.current.params.gcodeShiftY === prev.defaultGcodeShiftY) {
      patch.gcodeShiftY = next.defaultGcodeShiftY;
    }
    const prevInnerStart = Math.min(MAX_INNER_DISTANCE, Math.max(MIN_INNER_DISTANCE, prev.defaultInnerStartClearance));
    const nextInnerStart = Math.min(MAX_INNER_DISTANCE, Math.max(MIN_INNER_DISTANCE, next.defaultInnerStartClearance));
    if (nextInnerStart !== prevInnerStart && stateRef.current.params.innerStartClearance === prevInnerStart) {
      patch.innerStartClearance = nextInnerStart;
    }
    const prevInnerEnd = Math.min(MAX_INNER_DISTANCE, Math.max(MIN_INNER_DISTANCE, prev.defaultInnerEndTravel));
    const nextInnerEnd = Math.min(MAX_INNER_DISTANCE, Math.max(MIN_INNER_DISTANCE, next.defaultInnerEndTravel));
    if (nextInnerEnd !== prevInnerEnd && stateRef.current.params.innerEndTravel === prevInnerEnd) {
      patch.innerEndTravel = nextInnerEnd;
    }
    if (Object.keys(patch).length > 0) {
      setEditEntry((prevEntry) => prevEntry ? { ...prevEntry, params: { ...prevEntry.params, ...patch } } : prevEntry);
      onParamsCb(patch);
    }
    const nextH2X = Math.max(MIN_HOLDER2_OFFSET, next.defaultHolder2XOff);
    const nextH2Y = Math.max(MIN_HOLDER2_OFFSET, next.defaultHolder2YOff);
    const curH2 = editOpenRef.current && editBufRef.current ? editBufRef.current.holder2 : stateRef.current.params.holder2;
    const syncH2X = next.defaultHolder2XOff !== prev.defaultHolder2XOff && curH2.xOff === Math.max(MIN_HOLDER2_OFFSET, prev.defaultHolder2XOff);
    const syncH2Y = next.defaultHolder2YOff !== prev.defaultHolder2YOff && curH2.yOff === Math.max(MIN_HOLDER2_OFFSET, prev.defaultHolder2YOff);
    if (syncH2X || syncH2Y) {
      const syncedH2 = {
        xOff: syncH2X ? nextH2X : curH2.xOff,
        yOff: syncH2Y ? nextH2Y : curH2.yOff,
      };
      setEditEntry((prevEntry) => prevEntry ? { ...prevEntry, params: { ...prevEntry.params, holder2: syncedH2 } } : prevEntry);
      onHolder2SettingsCb(syncedH2);
    }
  }, [genBase, onParamsCb, onHolder2SettingsCb]);

  const applyPreset = useCallback((p: Preset) => {
    setWelcomeOpen(false);
    const nextSketch: SketchSeg[] = p.empty
      ? []
      : p.sketch
        ? p.sketch.map((seg, index) => ({ ...seg, id: Date.now() * 10 + index }))
        : p.wall
          ? sketchFromWall(p.wall.map(([z, r, smooth]) => ({ z, r, smooth })))
          : sketchFromPoints(presetPoints(p));
    const hadEditDraft = !!editBufRef.current;
    const newProjectId=`project-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    setProjectTabs(tabs=>[...tabs.map(t=>t.id===activeProjectId?{...t,past:[...past.current],future:[...future.current]}:t),{id:newProjectId,name:p.name,sketch:nextSketch,params,gcodeOvr:{},referenceImages:[],activePreset:p.id,savedSnapshot:null,past:[],future:[]}]);
    setActiveProjectId(newProjectId);

    /* هر پیش‌تنظیم پروژه‌ای مستقل است و تاریخچه پروژه قبلی وارد آن نمی‌شود. */
    past.current=[];future.current=[];
    commitRef.current = null;
    pendingParamRebaseRef.current = null;
    setSketch(nextSketch);
    setGenerationSketch(nextSketch);
    setGcodeOvr({});
    setReferenceImages([]);
    if (hadEditDraft) {
      presetReseedRef.current = true;
      /* یک render بدون بافر، camera-fit و stateهای تعاملی ویرایشگر را نیز برای
         هندسهٔ کاملاً جدید reset می‌کند؛ حالت edit در App باز می‌ماند. */
      setEditBuf(null);
    }

    setParams((prev) => {
      const next: Params = {
        ...prev,
        blankD: p.blankD,
        blankL: p.blankL,
        /* همهٔ پیش‌تنظیم‌ها با مقطع خام مربعی شروع می‌شوند. */
        blankShape: p.shape,
        gcodeShiftX: preferences.defaultGcodeShiftX,
        gcodeShiftY: preferences.defaultGcodeShiftY,
        holder2: {
          xOff: Math.max(MIN_HOLDER2_OFFSET, preferences.defaultHolder2XOff),
          yOff: Math.max(MIN_HOLDER2_OFFSET, preferences.defaultHolder2YOff),
        },
      };
      if (p.strategy) {
        const st = STRATEGIES.find((s) => s.id === p.strategy);
        if (st) next.ops = makeOps(st.types);
        if (p.strategy === "bowl") {
          next.holder2 = {
            xOff: Math.max(MIN_HOLDER2_OFFSET, next.holder2.xOff),
            yOff: Math.max(MIN_HOLDER2_OFFSET, next.holder2.yOff),
          };
        }
      }
      /* پروژه‌های ذخیره‌شده می‌توانند تنظیمات ماشین‌کاری خود را نیز همراه
         پیش‌تنظیم نگه دارند؛ ابعاد، Split و مقادیر پیش‌فرض استارتاپ در پایان قطعی می‌شوند. */
      if (p.params) Object.assign(next, p.params);
      next.gcodeShiftX = preferences.defaultGcodeShiftX;
      next.gcodeShiftY = preferences.defaultGcodeShiftY;
      next.innerStartClearance = Math.min(MAX_INNER_DISTANCE, Math.max(MIN_INNER_DISTANCE, preferences.defaultInnerStartClearance));
      next.innerEndTravel = Math.min(MAX_INNER_DISTANCE, Math.max(MIN_INNER_DISTANCE, preferences.defaultInnerEndTravel));
      next.holder2 = {
        xOff: Math.max(MIN_HOLDER2_OFFSET, preferences.defaultHolder2XOff),
        yOff: Math.max(MIN_HOLDER2_OFFSET, preferences.defaultHolder2YOff),
      };
      next.blankD = p.blankD;
      next.blankL = p.blankL;
      next.blankShape = p.shape;
      next.split = p.split
        ? { enabled: true, z: p.split.z, r: p.split.r }
        : { ...prev.split, enabled: false };
      // پریست در لحظهٔ ایجاد «تمیز» است؛ بنابراین بستن آن بدون ویرایش نباید
      // هشدار تغییرات ذخیره‌نشده نشان دهد.
      setProjectTabs(tabs => tabs.map(tab => tab.id === newProjectId
        ? { ...tab, params: next, savedSnapshot: projectSnapshot(nextSketch, next, {}, []) }
        : tab));
      return next;
    });
    setActivePreset(p.id);
    setSelectedIds([]);
    showToast(
      hadEditDraft
        ? `پیش‌تنظیم «${p.name}» اعمال و پیش‌نویس مسیر بازسازی شد`
        : p.strategy === "bowl"
          ? `پیش‌تنظیم «${p.name}» + استراتژی داخل/خارج فعال شد`
          : `پیش‌تنظیم «${p.name}» اعمال شد`
    );
  }, [showToast, params, activeProjectId, preferences]);

  /* قرار دادن خودکار نقطه Split روی لبه (بیشترین X زنجیره) */
  const autoSplit = useCallback(() => {
    const poly = chainPolyline(orderChain(sketch));
    const auto = autoSplitPoint(poly);
    if (auto) {
      onParamsCb({ split: { enabled: true, z: auto.z, r: auto.r } });
      showToast(`نقطه Split تعیین و استراتژی «کاسه داخل+خارج» فعال شد (X ${auto.z} • ⌀ ${(auto.r * 2).toFixed(1)})`);
    } else {
      showToast("زنجیره پروفیل برای Split خودکار کافی نیست", "warn");
    }
  }, [sketch, showToast, onParamsCb]);

  /* متن جی‌کد با پایان‌خط CRLF (سازگار با CIMCO/ویندوز و کنترلرها) */
  const gcodeText = () => displayGen.lines.join("\r\n");

  const copyGCode = async () => {
    const text = gcodeText();
    /* ۱) Clipboard API مدرن — روی http یا داخل iframe ممکن است در دسترس نباشد */
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        showToast("جی‌کد در کلیپ‌بورد کپی شد");
        return;
      }
    } catch {
      /* ادامه به fallback */
    }
    /* ۲) fallback: textarea موقت + execCommand (روی http هم کار می‌کند) */
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      ta.style.left = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (!ok) throw new Error("copy-failed");
      showToast("جی‌کد در کلیپ‌بورد کپی شد");
    } catch {
      showToast("کپی ممکن نشد — فایل را دانلود کنید", "warn");
    }
  };
  const downloadGCode = () => {
    const blob = new Blob([gcodeText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kharraatcode.cnc";
    a.click();
    URL.revokeObjectURL(url);
    showToast("فایل kharraatcode.cnc آماده شد");
  };

  const downloadDxf = () => {
    const { text, vertexCount, opCount } = buildDxf(displayGen.segs, params.ops, params.blankL, params.blankD / 2);
    const blob = new Blob([text], { type: "application/dxf;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kharraatcode-cutpath.dxf";
    a.click();
    URL.revokeObjectURL(url);
    showToast(`مسیر برشی ${opCount.toLocaleString("fa-IR")} عملیات با ${vertexCount.toLocaleString("fa-IR")} نقطه به DXF تبدیل شد`);
  };

  const projectData = () => JSON.stringify({
    format: "KharraatCode Project", version: SAVE_VERSION, savedAt: new Date().toISOString(),
    /* فایل اشتراکی فقط داده‌های مهندسی پروژه را حمل می‌کند؛ تنظیمات شخصی رابط
       کاربر (تم، رنگ، میانبر، حساسیت اسنپ، لایه‌ها و چیدمان) محلی می‌مانند. */
    project: { sketch: committedSketch, params: committedParams, gcodeOvr: committedGcodeOvr, referenceImages },
    output: { postProcessor: preferences.postProcessor, gcodeUnits: preferences.gcodeUnits, sequenceNumbers: preferences.sequenceNumbers, gcodeFormat: preferences.gcodeFormat, continuousPaths: preferences.continuousPaths, optimizeFeeds: preferences.optimizeFeeds, spreadRapid: preferences.spreadRapid, spindleSpeed: preferences.spindleSpeed, operationFeeds: preferences.operationFeeds },
  }, null, 2);
  const downloadProject = (name = "project.kharraat") => {
    const url = URL.createObjectURL(new Blob([projectData()], { type: "application/json;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  };
  const askProjectName=()=>new Promise<string|null>(resolve=>{saveAsResolver.current=resolve;setSaveAsName(projectTabs.find(t=>t.id===activeProjectId)?.name||"project");});
  const saveProjectAs = async (): Promise<boolean> => {
    try {
      if(!preferences.useWindowsSaveDialog){const entered=await askProjectName();if(!entered)return false;const clean=entered.trim().replace(/[\\/:*?"<>|]+/g,"-").replace(/\.kharraat$/i,"")||"project";downloadProject(`${clean}.kharraat`);setProjectTabs(tabs=>tabs.map(t=>t.id===activeProjectId?{...t,name:clean,savedSnapshot:projectSnapshot(committedSketch,committedParams,committedGcodeOvr,referenceImages)}:t));showToast("پروژه ذخیره شد");return true;}
      const picker = (window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<{ name?: string; createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
      if (picker) {
        const handle = await picker({ suggestedName: "project.kharraat", types: [{ description: "KharraatCode Project", accept: { "application/json": [".kharraat"] } }] });
        if (!handle) return false; projectHandlesRef.current.set(activeProjectId,handle);
        const writable = await handle.createWritable(); await writable.write(projectData()); await writable.close();
        if(handle.name)setProjectTabs(tabs=>tabs.map(t=>t.id===activeProjectId?{...t,name:handle.name!.replace(/\.kharraat$/i,"")}:t));
      } else {const entered=await askProjectName();if(!entered)return false;downloadProject(`${entered.trim().replace(/[\\/:*?"<>|]+/g,"-").replace(/\.kharraat$/i,"")||"project"}.kharraat`);}
      setProjectTabs(tabs=>tabs.map(t=>t.id===activeProjectId?{...t,savedSnapshot:projectSnapshot(committedSketch,committedParams,committedGcodeOvr,referenceImages)}:t));
      showToast("پروژه ذخیره شد"); return true;
    } catch (error) { if ((error as {name?:string}).name !== "AbortError") showToast("ذخیره پروژه ممکن نشد", "warn"); return false; }
  };
  const saveProject = async (): Promise<boolean> => {
    const handle = projectHandlesRef.current.get(activeProjectId);
    if (!handle) return saveProjectAs();
    try { const writable = await handle.createWritable(); await writable.write(projectData()); await writable.close(); setProjectTabs(tabs=>tabs.map(t=>t.id===activeProjectId?{...t,savedSnapshot:projectSnapshot(committedSketch,committedParams,committedGcodeOvr,referenceImages)}:t)); showToast("پروژه ذخیره شد"); return true; }
    catch { showToast("ذخیره مستقیم ممکن نشد؛ از Save As استفاده کنید", "warn"); return false; }
  };
  useEffect(() => {
    if(!saveThenCloseProject || activeProjectId!==saveThenCloseProject)return;
    let live=true;void saveProject().then(ok=>{if(live&&ok)finishCloseProject(saveThenCloseProject);if(live)setSaveThenCloseProject(null);});
    return()=>{live=false;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[saveThenCloseProject,activeProjectId]);

  const openProjectFile = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text()) as Saved & {
        format?: string;
        project?: { sketch?: SketchSeg[]; params?: Partial<Params>; gcodeOvr?: Saved["gcodeOvr"]; referenceImages?: ReferenceImage[] };
        output?: { postProcessor?: string; gcodeUnits?: string; sequenceNumbers?: boolean };
      };
      const data = raw.project ?? raw; // پشتیبانی از فایل‌های پروژه نسخهٔ قبلی
      if (raw.format !== "KharraatCode Project" || !data.sketch) throw new Error("invalid-project");
      const nextSketch = normalizeSketch(data.sketch); if (!nextSketch) throw new Error("invalid-sketch");
      const nextParams=normalizeParams(data.params,false), nextOvr=normGcodeOvr(data.gcodeOvr), nextImages=data.referenceImages??[], newProjectId=`project-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
      setProjectTabs(tabs=>[...tabs.map(t=>t.id===activeProjectId?{...t,past:[...past.current],future:[...future.current]}:t),{id:newProjectId,name:file.name.replace(/\.kharraat$/i,""),sketch:nextSketch,params:nextParams,gcodeOvr:nextOvr,referenceImages:nextImages,activePreset:null,savedSnapshot:projectSnapshot(nextSketch,nextParams,nextOvr,nextImages),past:[],future:[]}]);setActiveProjectId(newProjectId);
      setSketch(nextSketch); setGenerationSketch(nextSketch); setParams(nextParams);
      /* settings/preferences/layout عمداً بارگذاری نمی‌شوند تا محیط شخصی گیرنده تغییر نکند. */
      keptDraftRef.current=null; pendingExitActionRef.current=null; setPendingEditExit(false); setEditEntry(null);
      setActivePreset(null); setGcodeOvr(nextOvr); setReferenceImages(nextImages);
      setSelectedIds([]); setEditBuf(null); flushLiveEditBuf(null); setEditOpen(false); setMode("design");
      past.current=[]; future.current=[]; setHistVer(v=>v+1);
      const outputDiffers = !!raw.output && (raw.output.postProcessor !== preferences.postProcessor || raw.output.gcodeUnits !== preferences.gcodeUnits || raw.output.sequenceNumbers !== preferences.sequenceNumbers);
      showToast(outputDiffers ? `پروژه باز شد؛ تنظیمات خروجی پروژه با Preferences شما متفاوت است` : `پروژه «${file.name}» باز شد`, outputDiffers ? "warn" : "ok");
    } catch { showToast("این فایل پروژه معتبر خراط‌کد نیست", "warn"); }
  };

  const importAi = (segments: SketchSeg[], length: number, diameter: number) => {
    /* حذف نویز ممیز شناور (مثلاً 28.000000000000004) پیش از ثبت ابعاد خام. */
    length = Math.round(length * 1e6) / 1e6;
    diameter = Math.round(diameter * 1e6) / 1e6;
    pushPast(snap());
    keptDraftRef.current = null;
    pendingExitActionRef.current = null;
    setPendingEditExit(false);
    setEditEntry(null);
    setSketch(segments);
    setGenerationSketch(segments);
    setParams((current) => normalizeParams({ ...current, blankL: Math.max(1, length), blankD: Math.max(1, diameter) }, false));
    setSelectedIds([]);
    setActivePreset(null);
    setGcodeOvr({});
    setEditBuf(null);
    flushLiveEditBuf(null);
    setEditOpen(false);
    setShowAiImport(false);
    setMode("design");
    showToast(`فایل AI با ابعاد ${length.toFixed(1)} × ${diameter.toFixed(1)} میلی‌متر وارد شد`);
  };

  useEffect(() => {
    const onProjectKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const rc = typeof e.code === "string" ? e.code : "";
      const rk = typeof e.key === "string" ? e.key : "";
      const key=/^Key[A-Z]$/.test(rc)?rc.slice(3).toLowerCase():rk.toLowerCase();
      if(key==="s"){e.preventDefault();void (e.shiftKey?saveProjectAs():saveProject());}
      if(key==="o"){e.preventDefault();projectInputRef.current?.click();}
    };
    window.addEventListener("keydown",onProjectKey);return()=>window.removeEventListener("keydown",onProjectKey);
  });

  /* وقتی پنجره نمای سه‌بعدی بسته یا جمع شده است، هیچ محاسبه مش، پروفایل سه‌بعدی یا WebGL اجرا نمی‌شود */
  const view3dActive = layout.view3d.open && !layout.view3d.collapsed;
  const view3dSketch = view3dActive ? (editOpen && editBuf ? editBuf.sketch : sketch) : null;
  const tabChrome = useMemo(
    () => computeTabChromeColors(preferences.themeColors.uiHeaderBg, preferences.themeColors.uiInk),
    [preferences.themeColors.uiHeaderBg, preferences.themeColors.uiInk]
  );

  const editorTitle = mode === "design" ? "طراحی پروفایل" : "شبیه‌سازی تراش";
  const panelTitleMap: Record<PanelId, string> = {
    controls: "تنظیمات",
    view3d: "نمای سه‌بعدی",
    editor: editorTitle,
    gcode: "جی‌کد",
  };
  const panelOrder = Array.isArray(layout.order) ? layout.order : PANEL_IDS;
  const menuItems: WindowMenuItem[] = panelOrder.map((id) => ({
    id,
    label: panelTitleMap[id],
    vis: panelVis(id),
  }));
  const slotOrder = (id: PanelId) => panelOrder.indexOf(id) * 2;
  const { activeIds: activeDockIds, flexPanelId } = computeSideBudget(layout, dockRowState.width);
  const effectiveSideSizes = getEffectiveSideSizes(layout, dockRowState.width, dockRowState.isRow);
  const panelWidthPx = (id: PanelId): number | undefined =>
    dockRowState.isRow && flexPanelId === id ? undefined : effectiveSideSizes[id];

  const dockSplitters = (() => {
    const flexIdx = flexPanelId ? panelOrder.indexOf(flexPanelId) : -1;
    const items: {
      key: string;
      splitIdx: number;
      orderIndex: number;
      resetTargetId: PanelId;
      title: string;
    }[] = [];
    for (let k = 0; k < activeDockIds.length - 1; k++) {
      const rId = activeDockIds[k];
      const lId = activeDockIds[k + 1];
      const rSlot = panelOrder.indexOf(rId);
      const lSlot = panelOrder.indexOf(lId);
      if (flexIdx === -1 || lSlot <= flexIdx) {
        items.push({
          key: `split-${rId}-${lId}`,
          splitIdx: k,
          orderIndex: rSlot * 2 + 1,
          resetTargetId: rId,
          title: `تغییر عرض بین «${panelTitleMap[rId]}» و «${panelTitleMap[lId]}» (دابل‌کلیک: اندازه پیش‌فرض)`,
        });
      } else {
        items.push({
          key: `split-${rId}-${lId}`,
          splitIdx: k,
          orderIndex: lSlot * 2 - 1,
          resetTargetId: lId,
          title: `تغییر عرض بین «${panelTitleMap[rId]}» و «${panelTitleMap[lId]}» (دابل‌کلیک: اندازه پیش‌فرض)`,
        });
      }
    }
    return items;
  })();

  const clearRecentProjects = () => {
    const hasUnsaved = recentProjects.some(tab => tab.savedSnapshot !== projectSnapshot(tab.sketch, tab.params, tab.gcodeOvr, tab.referenceImages));
    if (hasUnsaved) { setConfirmClearRecent(true); return; }
    setRecentProjects([]);
    try { localStorage.removeItem("kharraat-recent-projects"); } catch {}
  };

  const activateRecentTabs = (tabs: ProjectTab[], targetId?: string) => {
    if (!tabs.length) return;
    const normalized = tabs.map(normalizeStoredTab).filter((x): x is ProjectTab => x !== null);
    if (!normalized.length) return;
    const t = (targetId ? normalized.find((x) => x.id === targetId) : undefined) ?? normalized[0];
    setWelcomeOpen(false);
    setProjectTabs(normalized);
    setActiveProjectId(t.id);
    setSketch(t.sketch);
    setGenerationSketch(t.sketch);
    setParams(t.params);
    setGcodeOvr(t.gcodeOvr);
    setReferenceImages(normalizeReferenceImages(t.referenceImages));
    setActivePreset(t.activePreset);
    keptDraftRef.current = null;
    pendingExitActionRef.current = null;
    setPendingEditExit(false);
    setEditEntry(null);
    setSelectedIds([]);
    setEditBuf(null);
    flushLiveEditBuf(null);
    setEditOpen(false);
    past.current = [];
    future.current = [];
    setHistVer((v) => v + 1);
  };

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={e => {
        if (Array.from(e.dataTransfer.items).some(i => i.kind === "file")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={e => {
        if (e.dataTransfer.files.length > 0) {
          /* همیشه از هدایت مرورگر --app به مسیر فایل محلی جلوگیری شود */
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          const lower = (file.name || "").toLowerCase();
          if (lower.endsWith(".kharraat") || file.type === "application/json") {
            void openProjectFile(file);
          } else if (lower.endsWith(".ai")) {
            setShowAiImport(true);
            showToast("فایل AI را در پنجره ورود AI رها یا انتخاب کنید");
          } else if (file.type.startsWith("image/") || /\.(avif|bmp|gif|jpe?g|png|svg|webp|ico|tiff?)$/i.test(lower)) {
            showToast("برای افزودن تصویر مرجع، فایل عکس را مستقیماً روی بوم «طراحی پروفایل» رها کنید");
          }
        }
      }}
    >
      <input ref={projectInputRef} type="file" accept=".kharraat,application/json" className="hidden" onChange={e=>{const file=e.target.files?.[0];if(file)void openProjectFile(file);e.currentTarget.value="";}} />
      {showAiImport && <AIImportDialog onClose={() => setShowAiImport(false)} onImport={importAi} themeColors={preferences.themeColors} />}
      {showPreferences && <PreferencesDialog value={preferences} snapTolerance={settings.snapTolerancePx} onChange={onPreferencesChange} onSnapTolerance={(snapTolerancePx) => setSettings((s) => ({ ...s, snapTolerancePx }))} onClose={() => setShowPreferences(false)} />}
      {(welcomeOpen||projectTabs.length===0)&&<div className="fixed inset-0 z-[95] grid place-items-center overflow-hidden bg-bg p-8" dir="rtl"><div className="pointer-events-none absolute inset-0 opacity-80" style={{backgroundImage:"radial-gradient(circle at 18% 20%, rgba(var(--rgb-brass), .18), transparent 28%), radial-gradient(circle at 82% 78%, rgba(var(--rgb-teal), .13), transparent 30%), linear-gradient(rgba(var(--rgb-brass), .045) 1px, transparent 1px), linear-gradient(90deg, rgba(var(--rgb-brass), .045) 1px, transparent 1px)",backgroundSize:"100% 100%, 100% 100%, 42px 42px, 42px 42px"}}/><div className="pointer-events-none absolute left-1/2 top-1/2 h-[min(72vw,760px)] w-[min(72vw,760px)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-brass/10 shadow-[0_0_0_34px_rgba(var(--rgb-brass),.025),0_0_0_70px_rgba(var(--rgb-teal),.025),0_0_100px_rgba(0,0,0,.8)]"/><div className="pointer-events-none absolute inset-0 opacity-20" style={{backgroundImage:"repeating-conic-gradient(from 12deg at 50% 50%, rgba(var(--rgb-brass), .08) 0deg, transparent 8deg, rgba(var(--rgb-teal), .05) 16deg, transparent 26deg)"}}/><div className="relative z-10 w-full max-w-5xl"><h1 className="text-2xl font-bold text-brass2">خراط‌کد</h1><p className="mt-1 text-sm text-dim">مدیریت پروژه‌ها</p><div className="mt-8 grid gap-5 md:grid-cols-3"><section className="rounded-xl border border-edge2 bg-panel p-5"><div className="flex items-center justify-between gap-2"><h2 className="font-bold text-ink">پروژه‌های اخیر</h2>{recentProjects.length>0&&<button className="rounded-md bg-teal/15 px-2.5 py-1.5 text-[10px] font-bold text-teal hover:bg-teal/25" onClick={()=>activateRecentTabs(recentProjects)}>باز کردن همه پروژه‌ها</button>}</div>{recentProjects.length?<><div className="mt-3 grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pl-1">{recentProjects.map(p=><button key={p.id} className={`rounded-md border px-3 py-2 text-right transition-colors ${p.savedSnapshot!==projectSnapshot(p.sketch,p.params,p.gcodeOvr,p.referenceImages)?"border-orange-400/80 bg-orange-500/15 hover:bg-orange-500/25":"border-edge bg-panel2 hover:border-brass/60 hover:bg-brass/10"}`} onClick={()=>{const found=recentProjects.find(x=>x.id===p.id);if(found)activateRecentTabs([found],found.id);}}><span className="block truncate text-[11px] font-bold text-ink">{p.name}</span><small className="mt-1 block font-mono text-[8px] text-dim">D{p.params.blankD} × L{p.params.blankL} mm</small></button>)}</div><button className="mt-2 w-full rounded-md border border-edge bg-panel2 px-3 py-2 text-xs font-bold text-mute hover:border-danger/60 hover:text-danger" onClick={clearRecentProjects}>تمیز کردن لیست</button></>:<p className="mt-3 text-xs leading-6 text-dim">پروژه اخیری وجود ندارد.</p>}<button className="mt-3 w-full rounded-md border border-edge px-3 py-2 text-xs text-mute" onClick={()=>{setWelcomeOpen(false);projectInputRef.current?.click()}}>باز کردن فایل پروژه</button></section><section className="rounded-xl border border-brass/60 bg-brass/10 p-5"><h2 className="font-bold text-brass2">ایجاد پروژه جدید</h2><p className="mt-3 text-xs leading-6 text-mute">یک پروژه خالی برای طراحی پروفایل بسازید.</p><button className="mt-5 w-full rounded-md bg-brass px-3 py-2 text-xs font-bold text-[var(--color-brass-ink)]" onClick={openNewProject}>طراحی پروفایل جدید</button></section><section className="rounded-xl border border-edge2 bg-panel p-5"><h2 className="font-bold text-ink">پیش‌تنظیم‌های طراحی</h2><div className="mt-3 grid max-h-64 grid-cols-2 gap-2 overflow-y-auto">{PRESETS.map(p=><button key={p.id} className="rounded-md border border-edge bg-panel2 px-3 py-2 text-right transition-colors hover:border-brass/60 hover:bg-brass/10" onClick={()=>applyPreset(p)}><span className="block text-[11px] font-bold text-ink">{p.name}</span><small className="mt-1 block font-mono text-[8px] text-dim">D{p.blankD} × L{p.blankL} mm</small></button>)}</div></section></div></div></div>}{confirmClearRecent&&<div className="fixed inset-0 z-[160] grid place-items-center bg-black/55 p-4" dir="rtl"><div className="w-full max-w-md rounded-xl border border-orange-400/60 bg-panel p-5 shadow-2xl"><h3 className="text-sm font-bold text-orange-300">پروژه ذخیره‌نشده</h3><p className="mt-3 text-[12px] leading-6 text-mute">یک یا چند پروژه با هایلایت نارنجی ذخیره نشده‌اند. آیا می‌خواهید کل فهرست پروژه‌های اخیر پاک شود؟</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={()=>setConfirmClearRecent(false)} className="rounded-md border border-edge px-4 py-1.5 text-xs text-mute">انصراف</button><button type="button" onClick={()=>{setConfirmClearRecent(false);setRecentProjects([]);try{localStorage.removeItem("kharraat-recent-projects");}catch{}}} className="rounded-md bg-danger px-4 py-1.5 text-xs font-bold text-white">پاک کردن فهرست</button></div></div></div>}{newProjectDraft&&<div className="fixed inset-0 z-[140] grid place-items-center bg-black/50 p-4" dir="rtl"><form onSubmit={e=>{e.preventDefault();createNewProject();}} className="w-full max-w-md overflow-hidden rounded-xl border border-edge2 bg-panel shadow-2xl"><div className="border-b border-edge bg-panel2 px-5 py-4"><h3 className="text-sm font-bold text-brass2">ایجاد پروژه جدید</h3><label className="mt-3 block text-[10.5px] text-mute">نام پروژه<input autoFocus value={newProjectDraft.name} onChange={e=>setNewProjectDraft({...newProjectDraft,name:e.target.value})} onFocus={e=>e.currentTarget.select()} className="field-input mt-1.5 w-full"/></label></div><div className="p-5"><div className="grid grid-cols-2 gap-3"><label className="text-[10.5px] text-mute">قطر قطعه (mm)<input type="number" min="0.01" max="10000" step="0.01" value={newProjectDraft.diameter} onChange={e=>setNewProjectDraft({...newProjectDraft,diameter:e.target.value})} className="field-input mt-1.5 w-full"/></label><label className="text-[10.5px] text-mute">طول قطعه (mm)<input type="number" min="0.01" max="10000" step="0.01" value={newProjectDraft.length} onChange={e=>setNewProjectDraft({...newProjectDraft,length:e.target.value})} className="field-input mt-1.5 w-full"/></label></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={()=>setNewProjectDraft(null)} className="rounded-md border border-edge px-4 py-1.5 text-xs text-mute hover:text-ink">لغو</button><button type="submit" className="rounded-md bg-brass px-4 py-1.5 text-xs font-bold text-[var(--color-brass-ink)]">ایجاد پروژه</button></div></div></form></div>}
      {saveAsName!==null&&<div className="fixed inset-0 z-[130] grid place-items-center bg-black/45 p-4" dir="rtl"><form onSubmit={e=>{e.preventDefault();const value=saveAsName;setSaveAsName(null);saveAsResolver.current?.(value);saveAsResolver.current=null;}} className="w-full max-w-sm rounded-xl border border-edge2 bg-panel p-5 shadow-2xl"><h3 className="text-sm font-bold text-brass2">ذخیره پروژه با نام</h3><label className="mt-4 block text-[11px] text-mute">نام پروژه<input autoFocus value={saveAsName} onChange={e=>setSaveAsName(e.target.value)} onFocus={e=>e.currentTarget.select()} className="field-input mt-2 w-full"/></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={()=>{setSaveAsName(null);saveAsResolver.current?.(null);saveAsResolver.current=null;}} className="rounded-md border border-edge px-4 py-1.5 text-xs text-mute">لغو</button><button type="submit" className="rounded-md bg-brass px-4 py-1.5 text-xs font-bold text-[var(--color-brass-ink)]">ذخیره</button></div></form></div>}
      {pendingEditExit && <div className="fixed inset-0 z-[120] grid place-items-center bg-black/45 p-4" dir="rtl"><div className="w-full max-w-md rounded-xl border border-edge2 bg-panel p-5 shadow-2xl"><h3 className="text-sm font-bold text-brass2">تغییرات تأییدنشده ویرایش مسیر</h3><p className="mt-3 text-[12px] leading-6 text-mute">تغییراتی در مسیر یا تنظیمات انجام شده که هنوز تأیید نشده‌اند. آیا می‌خواهید تغییرات را تأیید و سپس از حالت ویرایش مسیر خارج شوید؟</p><div className="mt-5 flex justify-center gap-2"><button onClick={()=>{pendingExitActionRef.current=null;setPendingEditExit(false);}} className="rounded-md border border-edge px-4 py-1.5 text-xs text-mute">لغو</button><button onClick={revertEditAndExit} className="rounded-md border border-danger/50 bg-danger/10 px-4 py-1.5 text-xs font-bold text-danger">خیر</button><button onClick={confirmEditAndExit} className="rounded-md bg-brass px-4 py-1.5 text-xs font-bold text-[var(--color-brass-ink)]">بله</button></div></div></div>}
      {pendingCloseProject && <div className="fixed inset-0 z-[120] grid place-items-center bg-black/45 p-4" dir="rtl"><div className="w-full max-w-md rounded-xl border border-edge2 bg-panel p-5 shadow-2xl"><h3 className="text-sm font-bold text-brass2">تغییرات ذخیره‌نشده</h3><p className="mt-3 text-[12px] leading-6 text-mute">تغییرات پروژه «{projectTabs.find(t=>t.id===pendingCloseProject)?.name}» ذخیره نشده است. آیا می‌خواهید پیش از بستن پروژه آن را ذخیره کنید؟</p><div className="mt-5 flex justify-center gap-2"><button onClick={()=>setPendingCloseProject(null)} className="rounded-md border border-edge px-4 py-1.5 text-xs text-mute">لغو</button><button onClick={()=>finishCloseProject(pendingCloseProject)} className="rounded-md border border-danger/50 bg-danger/10 px-4 py-1.5 text-xs font-bold text-danger">خیر</button><button onClick={()=>{const id=pendingCloseProject;setSaveThenCloseProject(id);if(id!==activeProjectId)switchProject(id);}} className="rounded-md bg-brass px-4 py-1.5 text-xs font-bold text-[var(--color-brass-ink)]">بله</button></div></div></div>}
      <DesktopMenuBar
        tabChrome={tabChrome}
        projects={projectTabs.map(tab=>({id:tab.id,name:tab.name,dirty:tab.savedSnapshot!==projectSnapshot(tab.sketch,tab.params,tab.gcodeOvr,tab.referenceImages)}))}
        activeProjectId={activeProjectId}
        onSwitchProject={switchProject}
        onCloseProject={requestCloseProject}
        onCloseAllProjects={() => { keptDraftRef.current = null; pendingExitActionRef.current = null; setPendingEditExit(false); setEditEntry(null); setProjectTabs([]); setWelcomeOpen(true); setPendingCloseProject(null); setEditBuf(null); flushLiveEditBuf(null); setEditOpen(false); }}
        onNewProject={openNewProject}
        onOpenProject={() => projectInputRef.current?.click()}
        onSaveProject={() => void saveProject()}
        onSaveProjectAs={() => void saveProjectAs()}
        onImportAi={() => setShowAiImport(true)}
        onImportImage={() => setImageImportRequest(v=>v+1)}
        onExportGcode={downloadGCode}
        onExportDxf={downloadDxf}
        onPreferences={() => setShowPreferences(true)}
        onUndo={undoAny}
        onRedo={redoAny}
        canUndo={past.current.length > 0||imageHistoryState.canUndo}
        canRedo={future.current.length > 0||imageHistoryState.canRedo}
      />
      {/* ---------- سربرگ ---------- */}
      <header
        className="relative z-40 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge px-3.5 py-2 pl-14"
        style={{ backgroundColor: tabChrome.toolbarBg }}
      >
        <button onClick={() => setShowPreferences(true)} title="Preferences" aria-label="Preferences" className="absolute top-2.5 left-3 grid h-8 w-8 place-items-center rounded-lg border border-edge bg-panel2 text-mute shadow-lg transition-colors hover:border-brass/50 hover:text-brass2">
          <IconSettings className="h-4.5 w-4.5" />
        </button>
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-brass/40 bg-gradient-to-b from-panel3 to-panel text-brass shadow-[0_0_18px_rgba(var(--rgb-brass),0.18)]">
            <IconSpindle className="h-5 w-5" />
          </span>
          <div className="leading-none">
            <h1 className="font-display text-[22px] leading-6 text-brass2">خراط‌کد</h1>
            <p className="mt-0.5 text-[10px] font-medium text-mute">شبیه‌ساز و جی‌کدساز خراطی دومحور CNC</p>
          </div>
        </div>

        {/* تب‌ها */}
        <nav className="mx-auto flex rounded-lg border border-edge bg-panel2 p-0.5">
          <TabBtn on={mode === "design"} onClick={() => setMode("design")} icon={<IconPen className="h-3.5 w-3.5" />} label="طراحی پروفایل" />
          <TabBtn on={mode === "sim"} onClick={() => (editOpen ? requestExitEdit(() => setMode("sim")) : setMode("sim"))} icon={<IconSim className="h-3.5 w-3.5" />} label="شبیه‌سازی تراش" />
        </nav>

        <div className="flex items-center gap-1.5">
          <WindowMenu items={menuItems} onToggle={togglePanel} onReset={resetLayout} />
          <span className="mx-1 h-5 w-px bg-edge" />
          <button className="btn !px-2 !py-1.5" onClick={redoAny} disabled={future.current.length === 0&&!imageHistoryState.canRedo} title="بازانجام (Ctrl+Y)">
            <IconArrowRight className="h-4 w-4" />
          </button>
          <button className="btn !px-2 !py-1.5" onClick={undoAny} disabled={past.current.length === 0&&!imageHistoryState.canUndo} title="واگرد (Ctrl+Z)">
            <IconArrowLeft className="h-4 w-4" />
          </button>
          <span className="mx-1 h-5 w-px bg-edge" />
          {preferences.showHeaderImportAi && <button className="btn !px-2.5 !py-1.5 text-[11.5px]" onClick={() => setShowAiImport(true)} title="وارد کردن فایل Adobe Illustrator با پیش‌نمایش و مقیاس">
            <IconDownload className="h-3.5 w-3.5 rotate-180" />
            ورود AI
          </button>}
          {preferences.showHeaderExportDxf && <button
            className="btn btn-teal !px-2.5 !py-1.5 text-[11.5px]"
            onClick={downloadDxf}
            title="فقط مسیر عملیات تراش به ترتیب استراتژی — یکپارچه + لایهٔ مجزا برای هر عملیات"
          >
            <IconLayers className="h-3.5 w-3.5" />
            خروجی DXF
          </button>}
          {preferences.showHeaderCopyGcode && <button className="btn !px-2.5 !py-1.5 text-[11.5px]" onClick={copyGCode}>
            کپی جی‌کد
          </button>}
          {preferences.showHeaderDownloadNc && <button className="btn btn-brass !px-2.5 !py-1.5 text-[11.5px]" onClick={downloadGCode}>
            <IconDownload className="h-3.5 w-3.5" />
            دانلود CNC
          </button>}
        </div>
      </header>

      {/* ---------- بدنه ---------- */}
      <div
        ref={dockRowRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 min-[56rem]:flex-row min-[56rem]:gap-2 min-[56rem]:overflow-hidden"
      >
        {layout.controls.open && (
          <DockPanel
            panelId="controls"
            title="تنظیمات"
            icon={<IconLayers className="h-3.5 w-3.5" />}
            state={layout.controls}
            onCollapse={() => toggleCollapse("controls")}
            onClose={() => setPanel("controls", { open: false })}
            widthPx={panelWidthPx("controls")}
            orderIndex={slotOrder("controls")}
            isDragSource={panelDrag?.sourceId === "controls"}
            isDropTarget={panelDrag?.targetId === "controls"}
            onHeaderDragStart={startPanelDrag}
            className="w-full shrink-0"
            expandedClassName={flexPanelId === "controls" ? "min-[56rem]:w-auto min-[56rem]:min-w-0 min-[56rem]:flex-1" : undefined}
          >
            {!layout.controls.collapsed && (
              <PanelErrorBoundary panelTitle="تنظیمات">
                <ControlsPanel
                  params={generationParams}
                  holder2Draft={editOpen && editBuf ? editBuf.holder2 : null}
                  onHolder2={onHolder2SettingsCb}
                  onParams={onParamsCb}
                  points={points}
                  outerDisplayPoints={outerFinishPoints}
                  innerPoints={innerPoints}
                  splitInfo={splitInfo}
                  onAutoSplit={autoSplit}
                  activePreset={activePreset}
                  onApplyPreset={applyPreset}
                  onStrategy={onStrategyCb}
                  isolatedOpId={isolatedOpId}
                  onIsolate={setIsolatedOpId}
                  onNotify={showToast}
                  themeColors={preferences.themeColors}
                />
              </PanelErrorBoundary>
            )}
          </DockPanel>
        )}

        {layout.view3d.open && (
          <DockPanel
            panelId="view3d"
            title="نمای سه‌بعدی"
            icon={<IconCube className="h-3.5 w-3.5" />}
            state={layout.view3d}
            onCollapse={() => toggleCollapse("view3d")}
            onClose={() => setPanel("view3d", { open: false })}
            widthPx={panelWidthPx("view3d")}
            orderIndex={slotOrder("view3d")}
            isDragSource={panelDrag?.sourceId === "view3d"}
            isDropTarget={panelDrag?.targetId === "view3d"}
            onHeaderDragStart={startPanelDrag}
            className="w-full shrink-0"
            expandedClassName={cn("h-[54vh] min-[56rem]:h-auto", flexPanelId === "view3d" && "min-[56rem]:w-auto min-[56rem]:min-w-0 min-[56rem]:flex-1")}
          >
            {view3dActive && view3dSketch && (
              <PanelErrorBoundary panelTitle="نمای سه‌بعدی">
                <Lathe3DView
                  key={activeProjectId}
                  projectId={activeProjectId}
                  sketch={view3dSketch}
                  blankD={params.blankD}
                  blankL={params.blankL}
                  split={params.split.enabled}
                  themeColors={preferences.themeColors}
                />
              </PanelErrorBoundary>
            )}
          </DockPanel>
        )}

        {layout.editor.open ? (
          <DockPanel
            panelId="editor"
            title={editorTitle}
            icon={mode === "design" ? <IconPen className="h-3.5 w-3.5" /> : <IconSim className="h-3.5 w-3.5" />}
            state={layout.editor}
            onCollapse={() => toggleCollapse("editor")}
            onClose={() => setPanel("editor", { open: false })}
            orderIndex={slotOrder("editor")}
            isDragSource={panelDrag?.sourceId === "editor"}
            isDropTarget={panelDrag?.targetId === "editor"}
            onHeaderDragStart={startPanelDrag}
            className="min-w-0"
            expandedClassName="h-[54vh] flex-1 min-[56rem]:h-auto"
          >
            <PanelErrorBoundary panelTitle={editorTitle}>
              {mode === "design" ? (
                <ProfileEditor
                  key={activeProjectId}
                  projectId={activeProjectId}
                  referenceImages={referenceImages}
                  onReferenceImages={setReferenceImages}
                  imageImportRequest={imageImportRequest}
                  registerImageHistory={registerImageHistory}
                  segs={editOpen && editBuf ? editBuf.sketch : sketch}
                  onSegs={onSketchChange}
                  edit={editOpen ? editBuf : null}
                  onEditToggle={(open) => (open ? openEdit() : closeEdit())}
                  onEditBuf={onEditBuf}
                  onEditCancel={closeEdit}
                  showCanvasPaintTool={preferences.showCanvasPaintTool}
                  rightClickToolToggle={preferences.rightClickToolToggle}
                  deferMarqueeControlPoints={preferences.deferMarqueeControlPoints}
                  profileLineWidth={preferences.lineWidth}
                  pointScale={preferences.pointScale}
                  disableSelectionGlow={preferences.disableSelectionGlow}
                  themeColors={preferences.themeColors}
                  selected={selectedIds}
                  onSelected={setSelectedIds}
                  params={generationParams}
                  gen={displayGen}
                  split={params.split}
                  onSplit={onSplitChange}
                  settings={settings}
                  onSettings={(patch) => setSettings((s) => ({ ...s, ...patch }))}
                  toolShortcuts={preferences.shortcuts}
                  ops={params.ops}
                  isolatedOpId={isolatedOpId}
                  onClearIsolate={() => setIsolatedOpId(null)}
                  onActiveGCodeLine={setActiveLine}
                  onUndo={undo}
                  onRedo={redo}
                  canUndo={past.current.length > 0}
                  canRedo={future.current.length > 0}
                />
              ) : (
                <SimulationView gen={gen} params={generationParams} onActiveLine={setActiveLine} themeColors={preferences.themeColors} />
              )}
            </PanelErrorBoundary>
          </DockPanel>
        ) : (
          <div
            data-dock-panel-id="editor"
            style={{ order: slotOrder("editor") }}
            className={cn(
              "relative grid min-h-[220px] min-w-0 flex-1 place-items-center rounded-lg border border-dashed bg-panel/40 p-6 text-center min-[56rem]:h-auto",
              panelDrag?.targetId === "editor" ? "border-brass bg-brass/10 ring-2 ring-brass" : "border-edge2"
            )}
          >
            <div>
              <p className="text-[13px] font-bold text-mute">پنجره ویرایشگر بسته است</p>
              <p className="mt-1 text-[11.5px] text-dim">از منوی «پنجره» بالای صفحه دوباره بازش کنید</p>
              <button type="button" className="btn mx-auto mt-3 !px-3 !py-1.5 text-[12px]" onClick={() => setPanel("editor", { open: true })}>
                باز کردن ویرایشگر
              </button>
            </div>
          </div>
        )}

        {layout.gcode.open && (
          <DockPanel
            panelId="gcode"
            title="جی‌کد"
            icon={<IconCode className="h-3.5 w-3.5" />}
            state={layout.gcode}
            onCollapse={() => toggleCollapse("gcode")}
            onClose={() => setPanel("gcode", { open: false })}
            widthPx={panelWidthPx("gcode")}
            orderIndex={slotOrder("gcode")}
            isDragSource={panelDrag?.sourceId === "gcode"}
            isDropTarget={panelDrag?.targetId === "gcode"}
            onHeaderDragStart={startPanelDrag}
            className="w-full shrink-0"
            expandedClassName={cn("h-[420px] min-[56rem]:h-auto", flexPanelId === "gcode" && "min-[56rem]:w-auto min-[56rem]:min-w-0 min-[56rem]:flex-1")}
          >
            {!layout.gcode.collapsed && (
              <PanelErrorBoundary panelTitle="جی‌کد">
                <GCodePanel gen={displayGen} activeLine={activeLine} onLineClick={selectFromGCode} />
              </PanelErrorBoundary>
            )}
          </DockPanel>
        )}

        {dockSplitters.map((sp) => (
          <DockSplitter
            key={sp.key}
            orderIndex={sp.orderIndex}
            onResize={(dx) => resizeSplitter(sp.splitIdx, dx)}
            onResetSize={() => resetPanelSize(sp.resetTargetId)}
            title={sp.title}
          />
        ))}
      </div>

      {/* پیش‌نمایش شناور هنگام درگ نوار بالای پنجره برای جابه‌جایی */}
      {panelDrag && (
        <div
          dir="rtl"
          style={{ left: panelDrag.x + 14, top: panelDrag.y + 14 }}
          className="pointer-events-none fixed z-[200] flex items-center gap-2 rounded-lg border border-brass/80 bg-panel/95 px-3 py-1.5 text-[12px] font-bold text-brass2 shadow-2xl shadow-black/70 backdrop-blur"
        >
          <span>{panelTitleMap[panelDrag.sourceId]}</span>
          {panelDrag.targetId && (
            <span className="text-[11px] font-medium text-teal">
              ⇄ {panelTitleMap[panelDrag.targetId]}
            </span>
          )}
        </div>
      )}

      {/* ---------- توست ---------- */}
      {toast && (
        <div
          key={toast.msg}
          className={cn(
            "toast-anim fixed bottom-5 left-1/2 z-50 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[12.5px] font-semibold shadow-xl shadow-black/50 backdrop-blur",
            toast.kind === "ok" ? "border-ok/40 bg-panel/95 text-ok" : "border-danger/40 bg-panel/95 text-danger"
          )}
          style={{ transform: "translate(-50%,0)" }}
        >
          {toast.kind === "ok" ? <IconCheck className="h-4 w-4" /> : <IconWarn className="h-4 w-4" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

interface TabChromeColors {
  stripBg: string;
  toolbarBg: string;
  hoverPillBg: string;
  dividerBg: string;
  iconBadgeBg: string;
  controlHoverBg: string;
}

function mixHexColors(aHex: string, bHex: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(aHex);
  const [br, bg, bb] = hexToRgb(bHex);
  const k = Math.max(0, Math.min(1, t));
  const ch = (a: number, b: number) =>
    Math.max(0, Math.min(255, Math.round(a + (b - a) * k)))
      .toString(16)
      .padStart(2, "0");
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}

function computeTabChromeColors(headerBg: string, inkHex: string): TabChromeColors {
  const [r, g, b] = hexToRgb(headerBg);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum >= 140) {
    const toolbarBg = headerBg;
    const stripBg = shadeHex(headerBg, -0.14);
    return {
      stripBg,
      toolbarBg,
      hoverPillBg: mixHexColors(stripBg, toolbarBg, 0.58),
      dividerBg: rgbaCss(inkHex, 0.24),
      iconBadgeBg: rgbaCss("#000000", 0.08),
      controlHoverBg: rgbaCss(inkHex, 0.11),
    };
  }
  const stripBg = lum < 28 ? shadeHex(headerBg, -0.58) : shadeHex(headerBg, -0.44);
  const [sr, sg, sb] = hexToRgb(stripBg);
  const stripLum = 0.299 * sr + 0.587 * sg + 0.114 * sb;
  const minDelta = 20;
  const toolbarBg =
    lum - stripLum < minDelta
      ? shadeHex(headerBg, Math.min(0.16, (minDelta - (lum - stripLum)) / 220))
      : headerBg;
  return {
    stripBg,
    toolbarBg,
    hoverPillBg: mixHexColors(stripBg, toolbarBg, 0.56),
    dividerBg: rgbaCss(inkHex, 0.22),
    iconBadgeBg: rgbaCss("#000000", 0.35),
    controlHoverBg: rgbaCss(inkHex, 0.13),
  };
}

function DesktopMenuBar({ tabChrome, projects, activeProjectId, onSwitchProject, onCloseProject, onCloseAllProjects, onNewProject, onOpenProject, onSaveProject, onSaveProjectAs, onImportAi, onImportImage, onExportGcode, onExportDxf, onPreferences, onUndo, onRedo, canUndo, canRedo }: {
  tabChrome: TabChromeColors; projects: {id:string;name:string;dirty:boolean}[]; activeProjectId:string; onSwitchProject:(id:string)=>void; onCloseProject:(id:string)=>void; onCloseAllProjects:()=>void;
  onNewProject:()=>void; onOpenProject: () => void; onSaveProject: () => void; onSaveProjectAs: () => void;
  onImportAi: () => void; onImportImage: () => void; onExportGcode: () => void; onExportDxf: () => void; onPreferences: () => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
}) {
  const [open, setOpen] = useState<"file" | "edit" | null>(null);
  const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);
  const [hoveredCloseId, setHoveredCloseId] = useState<string | null>(null);
  const [plusHovered, setPlusHovered] = useState(false);
  const [stripWidth, setStripWidth] = useState(1200);
  const ref = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => setStripWidth(el.clientWidth || 1200);
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  const run = (fn: () => void) => { setOpen(null); fn(); };
  /* عرض تخمینی هر تب پس از کسر فضاهای ثابت (بدون اسکرول افقی؛ تب‌ها فشرده می‌شوند) */
  const estTabW = projects.length > 0
    ? Math.min(216, (stripWidth - 20 - projects.length * 11 - 30) / projects.length)
    : 216;
  const isCompact = estTabW < 96;
  const isTiny = estTabW < 56;
  const dividerSlotCls = isTiny ? "w-[5px]" : "w-[11px]";
  const lastTabInactive = projects.length > 0 && projects[projects.length - 1].id !== activeProjectId;
  return (
    <div
      ref={ref}
      dir="ltr"
      onPointerDown={(e) => { if (e.target === e.currentTarget) setOpen(null); }}
      className="relative z-[60] flex h-[38px] shrink-0 select-none items-center px-2 text-[11px] text-mute"
      style={{ backgroundColor: tabChrome.stripBg }}
    >
      <div className="flex shrink-0 items-center gap-0.5 pr-1.5">
        <MenuTop label="File" active={open === "file"} hoverBg={tabChrome.hoverPillBg} onClick={() => setOpen(open === "file" ? null : "file")} />
        <MenuTop label="Edit" active={open === "edit"} hoverBg={tabChrome.hoverPillBg} onClick={() => setOpen(open === "edit" ? null : "edit")} />
      </div>
      <span className="h-4 w-px shrink-0 rounded-full" style={{ backgroundColor: tabChrome.dividerBg }} />

      <div
        ref={stripRef}
        className="-mb-px flex h-[39px] min-w-0 flex-1 items-stretch self-start overflow-hidden px-[10px]"
        dir="ltr"
      >
        {projects.map((project, index) => {
          const isActive = project.id === activeProjectId;
          const isHovered = hoveredTabId === project.id;
          const prevProject = index > 0 ? projects[index - 1] : null;
          /* خط جداکننده | دقیقاً مثل کروم بین تب‌های غیرفعال نمایش داده می‌شود */
          const showDivider = !!prevProject && !isActive && prevProject.id !== activeProjectId;
          const showCloseBtn = isTiny ? (isActive || isHovered) : isCompact ? (isActive || isHovered) : true;
          const showIcon = !isTiny || (!isActive && !isHovered);
          const showTitle = !isTiny;
          return (
            <Fragment key={project.id}>
              {index > 0 && (
                <div className={cn("mb-px flex shrink-0 items-center justify-center self-center", dividerSlotCls)} aria-hidden="true">
                  <span
                    className="h-4 w-px rounded-full transition-opacity duration-150"
                    style={{ backgroundColor: tabChrome.dividerBg, opacity: showDivider ? 1 : 0 }}
                  />
                </div>
              )}

              <div
                onMouseEnter={() => setHoveredTabId(project.id)}
                onMouseLeave={() => {
                  setHoveredTabId((cur) => (cur === project.id ? null : cur));
                  setHoveredCloseId((cur) => (cur === project.id ? null : cur));
                }}
                onClick={() => { setOpen(null); onSwitchProject(project.id); }}
                title={project.name}
                style={
                  isActive
                    ? { backgroundColor: tabChrome.toolbarBg }
                    : isHovered
                      ? { backgroundColor: tabChrome.hoverPillBg }
                      : undefined
                }
                className={cn(
                  "group relative mt-[5px] flex min-w-0 max-w-[216px] basis-[216px] shrink cursor-pointer transition-colors duration-150",
                  isActive
                    ? "z-10 h-[34px] rounded-t-[10px] pb-[6px] text-ink"
                    : "mb-[6px] h-[28px] rounded-[10px] text-ink/75 hover:text-ink"
                )}
              >
                {/* انحنای مقعر بیرونی پایین تب فعال برای ادغام یکپارچه با نوار بالایی */}
                {isActive && (
                  <>
                    <svg
                      viewBox="0 0 10 11"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                      className={cn("pointer-events-none absolute bottom-0 h-[11px]", isTiny ? "-left-[5px] w-[5px]" : "-left-[10px] w-[10px]")}
                    >
                      <path d="M10 0 A10 10 0 0 1 0 10 L0 11 L10 11 Z" fill={tabChrome.toolbarBg} />
                    </svg>
                    <svg
                      viewBox="0 0 10 11"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                      className={cn("pointer-events-none absolute bottom-0 h-[11px]", isTiny ? "-right-[5px] w-[5px]" : "-right-[10px] w-[10px]")}
                    >
                      <path d="M0 0 A10 10 0 0 0 10 10 L10 11 L0 11 Z" fill={tabChrome.toolbarBg} />
                    </svg>
                  </>
                )}

                <div
                  className={cn(
                    "flex h-[28px] w-full min-w-0 items-center",
                    isTiny ? "justify-center px-0.5" : isCompact ? "gap-1 px-1.5" : "gap-2 pr-1.5 pl-2.5"
                  )}
                >
                  {showIcon && (
                    <span
                      className="relative grid h-4 w-4 shrink-0 place-items-center rounded-[4px]"
                      style={{ backgroundColor: tabChrome.iconBadgeBg }}
                    >
                      <IconSpindle className="h-3 w-3 text-brass" />
                      {isTiny && project.dirty && (
                        <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-brass" />
                      )}
                    </span>
                  )}
                  {showTitle && (
                    <span dir="auto" className="min-w-0 flex-1 truncate text-[11.5px] font-medium leading-none">
                      {project.dirty && <span className="mr-1 inline-block text-brass">•</span>}
                      {project.name}
                    </span>
                  )}
                  {showCloseBtn && (
                    <button
                      type="button"
                      onMouseEnter={() => setHoveredCloseId(project.id)}
                      onMouseLeave={() => setHoveredCloseId((cur) => (cur === project.id ? null : cur))}
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseProject(project.id);
                      }}
                      title="بستن پروژه"
                      aria-label="بستن پروژه"
                      style={hoveredCloseId === project.id ? { backgroundColor: tabChrome.controlHoverBg } : undefined}
                      className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-ink/70 transition-colors hover:text-ink"
                    >
                      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
                        <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}

        {/* جداکنندهٔ | بین آخرین تب (در صورت غیرفعال بودن) و دکمهٔ + */}
        {projects.length > 0 && (
          <div className={cn("mb-px flex shrink-0 items-center justify-center self-center", dividerSlotCls)} aria-hidden="true">
            <span
              className="h-4 w-px rounded-full transition-opacity duration-150"
              style={{ backgroundColor: tabChrome.dividerBg, opacity: lastTabInactive ? 1 : 0 }}
            />
          </div>
        )}

        {/* دکمهٔ + بدون کادر، دقیقاً در وسط عمودی نوار تب‌ها */}
        <button
          type="button"
          onClick={() => { setOpen(null); onNewProject(); }}
          onMouseEnter={() => setPlusHovered(true)}
          onMouseLeave={() => setPlusHovered(false)}
          title="ایجاد پروژه جدید"
          aria-label="ایجاد پروژه جدید"
          style={plusHovered ? { backgroundColor: tabChrome.controlHoverBg } : undefined}
          className="mb-px ml-0.5 grid h-7 w-7 shrink-0 self-center place-items-center rounded-full border-0 bg-transparent text-ink/80 transition-colors hover:text-ink"
        >
          <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round">
            <path d="M7 1.75v10.5M1.75 7h10.5" />
          </svg>
        </button>
      </div>

      {open === "file" && <div className="absolute top-full left-1 z-50 w-52 overflow-hidden rounded-b-md border border-edge2 bg-panel/98 py-1 shadow-2xl shadow-black/60" dir="rtl">
        <MenuItem label="ایجاد پروژه جدید…" hint="New" onClick={() => run(onNewProject)} />
        <MenuItem label="بازکردن پروژه…" hint="Ctrl+O" onClick={() => run(onOpenProject)} />
        <MenuItem label="ذخیره" hint="Ctrl+S" onClick={() => run(onSaveProject)} />
        <MenuItem label="ذخیره با نام…" hint="Ctrl+Shift+S" onClick={() => run(onSaveProjectAs)} />
        <div className="my-1 border-t border-edge" />
        <MenuItem label="ورود فایل AI…" hint="Import" onClick={() => run(onImportAi)} />
        <MenuItem label="وارد کردن عکس…" onClick={() => run(onImportImage)} />
        <div className="my-1 border-t border-edge" />
        <MenuItem label="خروجی G-code…" hint="CNC" onClick={() => run(onExportGcode)} />
        <MenuItem label="خروجی DXF…" hint="DXF" onClick={() => run(onExportDxf)} />
        <div className="my-1 border-t border-edge" />
        <MenuItem label="Preferences…" onClick={() => run(onPreferences)} />
      </div>}
      {open === "edit" && <div className="absolute top-full left-[46px] z-50 w-52 overflow-hidden rounded-b-md border border-edge2 bg-panel/98 py-1 shadow-2xl shadow-black/60" dir="rtl">
        <MenuItem label="واگرد" hint="Ctrl+Z" disabled={!canUndo} onClick={() => run(onUndo)} />
        <MenuItem label="بازانجام" hint="Ctrl+Y" disabled={!canRedo} onClick={() => run(onRedo)} />
        <div className="my-1 border-t border-edge" />
        <MenuItem label="بستن همه پروژه‌ها" onClick={() => run(onCloseAllProjects)} />
      </div>}
    </div>
  );
}
function MenuTop({ label, active, hoverBg, onClick }: { label: string; active: boolean; hoverBg: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={active || hovered ? { backgroundColor: hoverBg } : undefined}
      className={cn(
        "h-[26px] rounded-[7px] px-2.5 text-[11px] font-medium transition-colors",
        active ? "text-ink" : "text-ink/75 hover:text-ink"
      )}
    >
      {label}
    </button>
  );
}
function MenuItem({label,hint,onClick,disabled=false}:{label:string;hint?:string;onClick:()=>void;disabled?:boolean}) { return <button disabled={disabled} onClick={onClick} className="flex w-full items-center justify-between px-3 py-1.5 text-right text-[11px] text-ink hover:bg-panel3 disabled:opacity-35 disabled:hover:bg-transparent"><span>{label}</span>{hint&&<span dir="ltr" className="font-mono text-[9px] text-dim">{hint}</span>}</button>; }

function TabBtn({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-bold transition-all",
        on ? "bg-brass text-[var(--color-brass-ink)] shadow-[0_2px_10px_rgba(var(--rgb-brass),0.35)]" : "text-mute hover:text-ink"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
