import type { OpType, SegKind } from "./lathe";

export interface ThemeColors {
  /* ۱. رابط کاربری عمومی و پنل‌ها */
  uiBg: string;
  uiHeaderBg: string;
  uiPanel: string;
  uiPanel2: string;
  uiPanel3: string;
  uiInputBg: string;
  uiEdge: string;
  uiEdge2: string;
  uiInk: string;
  uiMute: string;
  uiDim: string;
  uiAccent: string;
  uiAccent2: string;
  uiAccentInk: string;
  uiSecondary: string;
  uiCopper: string;
  uiSteel: string;
  uiOk: string;
  uiDanger: string;

  /* ۲. طراحی پروفایل و ترسیم دوبعدی */
  editorBg: string;
  editorGrid: string;
  editorCenterAxis: string;
  editorBlankBox: string;
  editorRotEnv: string;
  profileOuter: string;
  profileInner: string;
  profileSelected: string;
  profileHover: string;
  pointRing: string;
  pointFill: string;
  controlHandle: string;
  arcViaPoint: string;
  transformGuide: string;
  splitPoint: string;
  splitMirrorPoint: string;
  marqueeWindow: string;
  marqueeCrossing: string;
  paintArrow: string;

  /* ۳. حالت ویرایش مسیر */
  pathEditBg: string;
  pathEditAxisX: string;
  pathEditAxisY: string;
  pathEditSelected: string;
  pathEditStart: string;
  pathEditEnd: string;
  pathEditInnerZone: string;
  pathEditOffsetCurve: string;

  /* ۴. مسیر عملیات‌های تراشکاری */
  opRapid: string;
  opRound: string;
  opFace: string;
  opRoughD: string;
  opRoughZ: string;
  opCopy: string;
  opOffset: string;
  opFinish: string;
  opBottom: string;
  opInnerRough: string;
  opInnerOffset: string;
  opInnerFinish: string;

  /* ۵. نمای سه‌بعدی */
  view3dBg: string;
  view3dPart: string;
  view3dRim: string;
  view3dWire: string;
  view3dStock: string;
  view3dGrid: string;
  view3dAxis: string;

  /* ۶. شبیه‌سازی دوبعدی و ابزار */
  simBg: string;
  simWorkpiece: string;
  simChuck: string;
  simTargetOutline: string;
  simToolBody: string;
  simToolInsert: string;
  simToolTip: string;
  simHolder2Tip: string;
  simChips: string;

  /* ۷. پنل جی‌کد و رنگ‌بندی دستورات */
  gcodeBg: string;
  gcodeActiveLine: string;
  gcodeTokG: string;
  gcodeTokM: string;
  gcodeTokAxisX: string;
  gcodeTokAxisY: string;
  gcodeTokAxisZ: string;
  gcodeTokFeed: string;
  gcodeTokComment: string;
  gcodeTokLineNum: string;
}

export type ThemeColorKey = keyof ThemeColors;

export interface CustomThemePreset {
  id: string;
  name: string;
  colors: ThemeColors;
}

export interface ThemePresetDefinition {
  id: string;
  name: string;
  builtIn: boolean;
  colors: ThemeColors;
}

export type ThemeCategoryIcon = "ui" | "editor" | "pathedit" | "ops" | "view3d" | "sim" | "gcode";

export interface ThemeCategoryDef {
  id: string;
  title: string;
  icon: ThemeCategoryIcon;
  items: { key: ThemeColorKey; label: string }[];
}

export const THEME_CATEGORIES: ThemeCategoryDef[] = [
  {
    id: "ui",
    title: "رابط کاربری عمومی و پنجره‌ها",
    icon: "ui",
    items: [
      { key: "uiBg", label: "پس‌زمینه اصلی پنجره" },
      { key: "uiAccent", label: "رنگ تأکیدی / طلایی" },
      { key: "uiPanel", label: "پس‌زمینه پنل‌ها و پنجره‌ها" },
      { key: "uiAccent2", label: "رنگ تأکیدی روشن (هاور)" },
      { key: "uiHeaderBg", label: "نوار منو و سربرگ بالا" },
      { key: "uiAccentInk", label: "متن روی دکمه‌های تأکیدی" },
      { key: "uiPanel2", label: "کارت‌ها و دکمه‌های عمومی" },
      { key: "uiSecondary", label: "رنگ مکمل / فیروزه‌ای" },
      { key: "uiPanel3", label: "سطح هاور دکمه‌ها و تب‌ها" },
      { key: "uiCopper", label: "رنگ مسی / شاخص فرعی" },
      { key: "uiInputBg", label: "پس‌زمینه کادرهای ورودی" },
      { key: "uiSteel", label: "رنگ فولادی / خاکستری فنی" },
      { key: "uiEdge", label: "خطوط جداکننده و کادر پنل‌ها" },
      { key: "uiEdge2", label: "کادرهای فعال و اسکرول‌بار" },
      { key: "uiInk", label: "متون و فونت استاندارد" },
      { key: "uiMute", label: "متون فرعی و برچسب‌ها" },
      { key: "uiDim", label: "متون کم‌رنگ و واحدها" },
      { key: "uiOk", label: "وضعیت آماده و تأیید" },
      { key: "uiDanger", label: "رنگ هشدار، خطا و حذف" },
    ],
  },
  {
    id: "editor",
    title: "بوم طراحی پروفایل و ترسیم دوبعدی",
    icon: "editor",
    items: [
      { key: "editorBg", label: "پس‌زمینه بوم طراحی پروفایل" },
      { key: "editorGrid", label: "شبکه گرید و اعداد مقیاس" },
      { key: "editorCenterAxis", label: "خط‌چین محور مرکزی قطعه" },
      { key: "editorBlankBox", label: "کادر محدوده قطعه خام" },
      { key: "editorRotEnv", label: "پوشش دورانی مقاطع چندضلعی" },
      { key: "profileOuter", label: "خط پروفایل بیرونی" },
      { key: "profileInner", label: "خط پروفایل داخلی (کاسه)" },
      { key: "profileSelected", label: "خط و المان انتخاب‌شده" },
      { key: "profileHover", label: "هایلایت المان زیر موس" },
      { key: "pointRing", label: "حلقه و دات نقاط هندسی" },
      { key: "pointFill", label: "پس‌زمینه داخل نقاط هندسی" },
      { key: "controlHandle", label: "دسته‌های منحنی کنترلی" },
      { key: "arcViaPoint", label: "نقطه میانی کمان (Via)" },
      { key: "transformGuide", label: "کادر و راهنمای ابزارهای تبدیل" },
      { key: "splitPoint", label: "نشانگر نقطه Split اصلی" },
      { key: "splitMirrorPoint", label: "نشانگر Split قرینه (هلدر ۲)" },
      { key: "marqueeWindow", label: "باکس انتخاب پنجره‌ای" },
      { key: "marqueeCrossing", label: "باکس انتخاب متقاطع" },
      { key: "paintArrow", label: "ابزار نقاشی جهت‌دار بوم" },
    ],
  },
  {
    id: "pathedit",
    title: "حالت ویرایش مسیر ابزار",
    icon: "pathedit",
    items: [
      { key: "pathEditBg", label: "پس‌زمینه بوم ویرایش مسیر" },
      { key: "pathEditSelected", label: "مسیر انتخاب‌شده در ویرایش مسیر" },
      { key: "pathEditAxisX", label: "محور طولی X در ویرایش مسیر" },
      { key: "pathEditAxisY", label: "محور شعاعی Y در ویرایش مسیر" },
      { key: "pathEditStart", label: "نشانگر نقطه شروع مسیر (S)" },
      { key: "pathEditEnd", label: "نشانگر نقطه پایان مسیر (E)" },
      { key: "pathEditInnerZone", label: "محدوده مجاز داخل‌تراشی" },
      { key: "pathEditOffsetCurve", label: "منحنی راهنمای افست" },
    ],
  },
  {
    id: "ops",
    title: "رنگ مسیر عملیات‌های تراشکاری",
    icon: "ops",
    items: [
      { key: "opRapid", label: "حرکت سریع ابزار (G0)" },
      { key: "opRound", label: "گرد کردن گوشه‌های مقطع" },
      { key: "opFace", label: "پیشانی‌تراشی" },
      { key: "opRoughD", label: "خشن شعاعی بیرون (G71)" },
      { key: "opRoughZ", label: "خشن محوری بیرون (G72)" },
      { key: "opCopy", label: "کپی‌تراشی" },
      { key: "opOffset", label: "افست بیرونی" },
      { key: "opFinish", label: "پرداخت نهایی بیرون" },
      { key: "opBottom", label: "کف‌تراشی (هلدر دوم)" },
      { key: "opInnerRough", label: "خشن داخل کاسه (هلدر دوم)" },
      { key: "opInnerOffset", label: "افست داخل‌تراشی (هلدر دوم)" },
      { key: "opInnerFinish", label: "پرداخت داخل کاسه (هلدر دوم)" },
    ],
  },
  {
    id: "view3d",
    title: "نمای سه‌بعدی قطعه",
    icon: "view3d",
    items: [
      { key: "view3dBg", label: "پس‌زمینه صحنه سه‌بعدی" },
      { key: "view3dPart", label: "رنگ بدنه قطعه سه‌بعدی" },
      { key: "view3dRim", label: "بازتاب نور و درخشش لبه قطعه" },
      { key: "view3dWire", label: "مش سیمی قطعه (سیمی)" },
      { key: "view3dStock", label: "سیم‌کشی قطعه خام اولیه (خام)" },
      { key: "view3dGrid", label: "شبکه کف صحنه سه‌بعدی (شبکه)" },
      { key: "view3dAxis", label: "خط‌چین محور چرخش (محور)" },
    ],
  },
  {
    id: "sim",
    title: "شبیه‌سازی زنده دوبعدی و ابزار",
    icon: "sim",
    items: [
      { key: "simBg", label: "پس‌زمینه بوم شبیه‌سازی" },
      { key: "simWorkpiece", label: "قطعه در حال تراش" },
      { key: "simChuck", label: "اسپیندل و سه‌نظام" },
      { key: "simTargetOutline", label: "خط‌چین پروفایل هدف و محور" },
      { key: "simToolBody", label: "بدنه هلدر ابزار تراش" },
      { key: "simToolInsert", label: "الماسه و اینسرت تراشکاری" },
      { key: "simToolTip", label: "لبه برنده و هاله برش" },
      { key: "simHolder2Tip", label: "نوک ابزار داخل‌تراشی (هلدر ۲)" },
      { key: "simChips", label: "براده‌های تراشکاری" },
    ],
  },
  {
    id: "gcode",
    title: "پنل جی‌کد و رنگ‌بندی دستورات",
    icon: "gcode",
    items: [
      { key: "gcodeBg", label: "پس‌زمینه پنل کدهای جی‌کد" },
      { key: "gcodeActiveLine", label: "هایلایت خط فعال در حال اجرا" },
      { key: "gcodeTokG", label: "دستورات حرکتی (کدهای G)" },
      { key: "gcodeTokM", label: "دستورات ماشین و ابزار (M / T / S)" },
      { key: "gcodeTokAxisX", label: "مختصات محور X در جی‌کد" },
      { key: "gcodeTokAxisY", label: "مختصات محور Y در جی‌کد (حالت Modal)" },
      { key: "gcodeTokAxisZ", label: "مختصات محور Z در جی‌کد (حالت Fanuc)" },
      { key: "gcodeTokFeed", label: "سرعت پیشروی و توقف (F / P)" },
      { key: "gcodeTokComment", label: "توضیحات و کامنت‌ها" },
      { key: "gcodeTokLineNum", label: "شماره خطوط و برنامه (N / O / %)" },
    ],
  },
];

export const DEFAULT_THEME_COLORS: ThemeColors = {
  /* ۱. رابط کاربری عمومی */
  uiBg: "#14100b",
  uiHeaderBg: "#1d1710",
  uiPanel: "#1d1710",
  uiPanel2: "#251d13",
  uiPanel3: "#2d2318",
  uiInputBg: "#14100b",
  uiEdge: "#3b2f20",
  uiEdge2: "#4d3d28",
  uiInk: "#f1e7d4",
  uiMute: "#a8946f",
  uiDim: "#6f6047",
  uiAccent: "#e3a94e",
  uiAccent2: "#f3c26b",
  uiAccentInk: "#241a0c",
  uiSecondary: "#45b394",
  uiCopper: "#e0703c",
  uiSteel: "#9aa7b4",
  uiOk: "#8fbf5a",
  uiDanger: "#d95848",

  /* ۲. طراحی پروفایل */
  editorBg: "#120e09",
  editorGrid: "#8b7c5f",
  editorCenterAxis: "#e3a94e",
  editorBlankBox: "#e3a94e",
  editorRotEnv: "#45b394",
  profileOuter: "#e3a94e",
  profileInner: "#4cc9f0",
  profileSelected: "#45b394",
  profileHover: "#fff3dc",
  pointRing: "#45b394",
  pointFill: "#0f2a22",
  controlHandle: "#6ab0d8",
  arcViaPoint: "#b48ee0",
  transformGuide: "#28dfc2",
  splitPoint: "#f72585",
  splitMirrorPoint: "#168cff",
  marqueeWindow: "#4aa3ff",
  marqueeCrossing: "#3faf5d",
  paintArrow: "#ef4444",

  /* ۳. حالت ویرایش مسیر */
  pathEditBg: "#08111f",
  pathEditAxisX: "#754052",
  pathEditAxisY: "#3b7373",
  pathEditSelected: "#ffffff",
  pathEditStart: "#45d19f",
  pathEditEnd: "#ff756f",
  pathEditInnerZone: "#69d7ff",
  pathEditOffsetCurve: "#d9b36a",

  /* ۴. عملیات‌های تراشکاری */
  opRapid: "#93a1ad",
  opRound: "#b48ee0",
  opFace: "#e3a94e",
  opRoughD: "#45b394",
  opRoughZ: "#6ab0d8",
  opCopy: "#a3c15c",
  opOffset: "#f59a80",
  opFinish: "#e0703c",
  opBottom: "#ffd166",
  opInnerRough: "#4cc9f0",
  opInnerOffset: "#c77dff",
  opInnerFinish: "#f72585",

  /* ۵. نمای سه‌بعدی */
  view3dBg: "#14100b",
  view3dPart: "#b0b8c4",
  view3dRim: "#e3a94e",
  view3dWire: "#f3c76b",
  view3dStock: "#45b394",
  view3dGrid: "#8c7857",
  view3dAxis: "#e3a94e",

  /* ۶. شبیه‌سازی دوبعدی */
  simBg: "#120e09",
  simWorkpiece: "#c9955a",
  simChuck: "#4c5c6e",
  simTargetOutline: "#e3a94e",
  simToolBody: "#333c45",
  simToolInsert: "#8a97a4",
  simToolTip: "#f3c26b",
  simHolder2Tip: "#4cc9f0",
  simChips: "#d8a86c",

  /* ۷. پنل جی‌کد */
  gcodeBg: "#1d1710",
  gcodeActiveLine: "#e3a94e",
  gcodeTokG: "#e3a94e",
  gcodeTokM: "#e0703c",
  gcodeTokAxisX: "#63c8ac",
  gcodeTokAxisY: "#74bff2",
  gcodeTokAxisZ: "#b995f0",
  gcodeTokFeed: "#c9b78d",
  gcodeTokComment: "#77684c",
  gcodeTokLineNum: "#6f6047",
};

export const BUILTIN_THEMES: ThemePresetDefinition[] = [
  {
    id: "lathe",
    name: "کهربایی صنعتی خراط‌کد",
    builtIn: true,
    colors: DEFAULT_THEME_COLORS,
  },
  {
    id: "midnight",
    name: "آبی نیمه‌شب مهندسی",
    builtIn: true,
    colors: {
      ...DEFAULT_THEME_COLORS,
      uiBg: "#0a1018",
      uiHeaderBg: "#070b11",
      uiPanel: "#101925",
      uiPanel2: "#162231",
      uiPanel3: "#1d2c3f",
      uiInputBg: "#0b131d",
      uiEdge: "#253549",
      uiEdge2: "#334963",
      uiInk: "#e7eff8",
      uiMute: "#94a8bf",
      uiDim: "#60758c",
      uiAccent: "#4ea8de",
      uiAccent2: "#7cc6f2",
      uiAccentInk: "#071624",
      uiSecondary: "#38d9a9",
      uiCopper: "#f48c58",
      uiSteel: "#9ab0c7",
      uiOk: "#69db7c",
      uiDanger: "#ef5753",

      editorBg: "#080f18",
      editorGrid: "#5c748f",
      editorCenterAxis: "#4ea8de",
      editorBlankBox: "#4ea8de",
      editorRotEnv: "#38d9a9",
      profileOuter: "#56b6f0",
      profileInner: "#a58bff",
      profileSelected: "#38d9a9",
      profileHover: "#e6f4ff",
      pointRing: "#38d9a9",
      pointFill: "#0a2220",

      pathEditBg: "#060c14",
      pathEditOffsetCurve: "#6db8e8",

      view3dBg: "#0a1018",
      view3dPart: "#b7c6d8",
      view3dRim: "#56b6f0",
      view3dWire: "#7cc6f2",
      view3dStock: "#38d9a9",
      view3dGrid: "#4b627c",
      view3dAxis: "#56b6f0",

      simBg: "#080f18",
      simWorkpiece: "#9eb3c9",
      simChuck: "#3d5169",
      simTargetOutline: "#56b6f0",
      simToolBody: "#2c3846",
      simToolInsert: "#96a8ba",
      simToolTip: "#7cc6f2",
      simChips: "#b8cce0",

      gcodeBg: "#0d1520",
      gcodeActiveLine: "#4ea8de",
      gcodeTokG: "#62b8f0",
      gcodeTokM: "#f48c58",
      gcodeTokAxisX: "#46d6b0",
      gcodeTokAxisY: "#ffd166",
      gcodeTokAxisZ: "#c792ea",
      gcodeTokFeed: "#b9cde3",
      gcodeTokComment: "#5d738b",
      gcodeTokLineNum: "#51667d",
    },
  },
  {
    id: "graphite",
    name: "گرافیت کارگاهی تیره",
    builtIn: true,
    colors: {
      ...DEFAULT_THEME_COLORS,
      uiBg: "#121316",
      uiHeaderBg: "#0c0d10",
      uiPanel: "#1a1c20",
      uiPanel2: "#22252b",
      uiPanel3: "#2b2f37",
      uiInputBg: "#131519",
      uiEdge: "#343943",
      uiEdge2: "#464d5b",
      uiInk: "#eceef2",
      uiMute: "#a4acb9",
      uiDim: "#6f7785",
      uiAccent: "#d8a85b",
      uiAccent2: "#ecc27d",
      uiAccentInk: "#1c160c",
      uiSecondary: "#4ec4a5",

      editorBg: "#101215",
      editorGrid: "#727a88",
      editorCenterAxis: "#d8a85b",
      editorBlankBox: "#d8a85b",
      profileOuter: "#d8a85b",

      view3dBg: "#121316",
      view3dPart: "#bcc2cc",
      view3dRim: "#d8a85b",
      view3dGrid: "#636a78",
      view3dAxis: "#d8a85b",

      simBg: "#101215",
      simWorkpiece: "#b89f80",
      simChuck: "#505866",
      simTargetOutline: "#d8a85b",

      gcodeBg: "#181a1f",
      gcodeActiveLine: "#d8a85b",
      gcodeTokG: "#e0b368",
      gcodeTokAxisX: "#5ed1b3",
      gcodeTokAxisY: "#6ab8f7",
      gcodeTokAxisZ: "#c792ea",
      gcodeTokFeed: "#c6ccd6",
      gcodeTokComment: "#707887",
      gcodeTokLineNum: "#616875",
    },
  },
  {
    id: "emerald",
    name: "زمردی مدرن CNC",
    builtIn: true,
    colors: {
      ...DEFAULT_THEME_COLORS,
      uiBg: "#091310",
      uiHeaderBg: "#060d0b",
      uiPanel: "#10201b",
      uiPanel2: "#162b24",
      uiPanel3: "#1d372f",
      uiInputBg: "#0b1713",
      uiEdge: "#25453b",
      uiEdge2: "#335c4f",
      uiInk: "#e5f5ef",
      uiMute: "#90b5a7",
      uiDim: "#5b7f72",
      uiAccent: "#34c79b",
      uiAccent2: "#63dfb9",
      uiAccentInk: "#062118",
      uiSecondary: "#eab354",
      uiCopper: "#ee8456",

      editorBg: "#08110e",
      editorGrid: "#597e71",
      editorCenterAxis: "#34c79b",
      editorBlankBox: "#34c79b",
      editorRotEnv: "#eab354",
      profileOuter: "#42d6aa",
      profileInner: "#5cc8ff",
      profileSelected: "#ffd166",
      pointRing: "#ffd166",
      pointFill: "#26200d",

      view3dBg: "#091310",
      view3dPart: "#b3c9c1",
      view3dRim: "#42d6aa",
      view3dWire: "#63dfb9",
      view3dStock: "#eab354",
      view3dGrid: "#486e60",
      view3dAxis: "#42d6aa",

      simBg: "#08110e",
      simWorkpiece: "#c79a63",
      simChuck: "#3d5e54",
      simTargetOutline: "#42d6aa",
      simToolTip: "#63dfb9",

      gcodeBg: "#0d1b17",
      gcodeActiveLine: "#34c79b",
      gcodeTokG: "#42d6aa",
      gcodeTokM: "#f08c5b",
      gcodeTokAxisX: "#f2c46d",
      gcodeTokAxisY: "#66ccff",
      gcodeTokAxisZ: "#d49bf5",
      gcodeTokFeed: "#b3d6c8",
      gcodeTokComment: "#587c6f",
      gcodeTokLineNum: "#4b6c60",
    },
  },
  {
    id: "studio-light",
    name: "روشن مهندسی (روز)",
    builtIn: true,
    colors: {
      ...DEFAULT_THEME_COLORS,
      uiBg: "#eef2f6",
      uiHeaderBg: "#e2e8f0",
      uiPanel: "#f8fafc",
      uiPanel2: "#edf2f7",
      uiPanel3: "#e2e8f0",
      uiInputBg: "#ffffff",
      uiEdge: "#cbd5e1",
      uiEdge2: "#94a3b8",
      uiInk: "#0f172a",
      uiMute: "#475569",
      uiDim: "#64748b",
      uiAccent: "#b7791f",
      uiAccent2: "#975a16",
      uiAccentInk: "#ffffff",
      uiSecondary: "#0f766e",
      uiCopper: "#c2410c",
      uiSteel: "#475569",
      uiOk: "#15803d",
      uiDanger: "#dc2626",

      editorBg: "#f4f7fa",
      editorGrid: "#94a3b8",
      editorCenterAxis: "#b7791f",
      editorBlankBox: "#b7791f",
      editorRotEnv: "#0f766e",
      profileOuter: "#b45309",
      profileInner: "#0284c7",
      profileSelected: "#0f766e",
      profileHover: "#1e293b",
      pointRing: "#0f766e",
      pointFill: "#e6fffa",
      controlHandle: "#2563eb",
      arcViaPoint: "#7c3aed",
      transformGuide: "#0891b2",
      splitPoint: "#db2777",
      splitMirrorPoint: "#0284c7",
      marqueeWindow: "#2563eb",
      marqueeCrossing: "#16a34a",
      paintArrow: "#dc2626",

      pathEditBg: "#eef4fb",
      pathEditAxisX: "#be123c",
      pathEditAxisY: "#0f766e",
      pathEditSelected: "#0f172a",
      pathEditStart: "#059669",
      pathEditEnd: "#dc2626",
      pathEditInnerZone: "#0284c7",
      pathEditOffsetCurve: "#b45309",

      opRapid: "#64748b",
      opRound: "#7c3aed",
      opFace: "#b45309",
      opRoughD: "#0f766e",
      opRoughZ: "#0284c7",
      opCopy: "#4d7c0f",
      opOffset: "#ea580c",
      opFinish: "#c2410c",
      opBottom: "#ca8a04",
      opInnerRough: "#0369a1",
      opInnerOffset: "#9333ea",
      opInnerFinish: "#be185d",

      view3dBg: "#e9eff5",
      view3dPart: "#7d8b9c",
      view3dRim: "#b7791f",
      view3dWire: "#334155",
      view3dStock: "#0f766e",
      view3dGrid: "#94a3b8",
      view3dAxis: "#b7791f",

      simBg: "#f1f5f9",
      simWorkpiece: "#b7834a",
      simChuck: "#64748b",
      simTargetOutline: "#b45309",
      simToolBody: "#334155",
      simToolInsert: "#64748b",
      simToolTip: "#d97706",
      simHolder2Tip: "#0284c7",
      simChips: "#b47b41",

      gcodeBg: "#f8fafc",
      gcodeActiveLine: "#b7791f",
      gcodeTokG: "#b45309",
      gcodeTokM: "#c2410c",
      gcodeTokAxisX: "#0f766e",
      gcodeTokAxisY: "#0284c7",
      gcodeTokAxisZ: "#7c3aed",
      gcodeTokFeed: "#334155",
      gcodeTokComment: "#64748b",
      gcodeTokLineNum: "#94a3b8",
    },
  },
  {
    id: "blender-dark",
    name: "بلندر تیره (Blender Dark)",
    builtIn: true,
    colors: {
      ...DEFAULT_THEME_COLORS,
      uiBg: "#1d1d1d",
      uiHeaderBg: "#282828",
      uiPanel: "#303030",
      uiPanel2: "#3d3d3d",
      uiPanel3: "#474747",
      uiInputBg: "#1d1d1d",
      uiEdge: "#424242",
      uiEdge2: "#545454",
      uiInk: "#e6e6e6",
      uiMute: "#b8b8b8",
      uiDim: "#858585",
      uiAccent: "#4772b3",
      uiAccent2: "#6b99de",
      uiAccentInk: "#ffffff",
      uiSecondary: "#3ab4c9",
      uiCopper: "#eb7528",
      uiSteel: "#9ba3ad",
      uiOk: "#70c456",
      uiDanger: "#e04f4f",

      editorBg: "#262626",
      editorGrid: "#5c5c5c",
      editorCenterAxis: "#ff3352",
      editorBlankBox: "#eb7528",
      editorRotEnv: "#3ab4c9",
      profileOuter: "#ff9f2c",
      profileInner: "#4db8ff",
      profileSelected: "#ffa726",
      profileHover: "#ffe0b2",
      pointRing: "#ff8500",
      pointFill: "#1f1f1f",
      controlHandle: "#e64553",
      arcViaPoint: "#8bdc00",
      transformGuide: "#47b5ff",
      splitPoint: "#ff3352",
      splitMirrorPoint: "#2b95ff",
      marqueeWindow: "#4772b3",
      marqueeCrossing: "#70c456",
      paintArrow: "#ff4d4d",

      pathEditBg: "#1f2328",
      pathEditAxisX: "#ff3352",
      pathEditAxisY: "#8bdc00",
      pathEditSelected: "#ffa726",
      pathEditStart: "#70c456",
      pathEditEnd: "#ff4d4d",
      pathEditInnerZone: "#4db8ff",
      pathEditOffsetCurve: "#d69e5c",

      opRapid: "#8f98a0",
      opRound: "#b388ff",
      opFace: "#ff9f2c",
      opRoughD: "#3ab4c9",
      opRoughZ: "#569cd6",
      opCopy: "#8bdc00",
      opOffset: "#ff8a65",
      opFinish: "#ff6d00",
      opBottom: "#ffd54f",
      opInnerRough: "#4db8ff",
      opInnerOffset: "#ce93d8",
      opInnerFinish: "#ff4081",

      view3dBg: "#303030",
      view3dPart: "#c2c2c2",
      view3dRim: "#ffffff",
      view3dWire: "#ff8500",
      view3dStock: "#4772b3",
      view3dGrid: "#626262",
      view3dAxis: "#ff3352",

      simBg: "#242424",
      simWorkpiece: "#b89068",
      simChuck: "#5c646d",
      simTargetOutline: "#ff9f2c",
      simToolBody: "#3a4047",
      simToolInsert: "#9da6b0",
      simToolTip: "#ffa726",
      simHolder2Tip: "#4db8ff",
      simChips: "#d4a373",

      gcodeBg: "#1d1d1d",
      gcodeActiveLine: "#4772b3",
      gcodeTokG: "#ff8f40",
      gcodeTokM: "#c678dd",
      gcodeTokAxisX: "#ff5c77",
      gcodeTokAxisY: "#8bdc00",
      gcodeTokAxisZ: "#4db8ff",
      gcodeTokFeed: "#e6c07b",
      gcodeTokComment: "#7a7a7a",
      gcodeTokLineNum: "#6e6e6e",
    },
  },
];

const ALL_THEME_KEYS = Object.keys(DEFAULT_THEME_COLORS) as ThemeColorKey[];

function toAsciiDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** تبدیل ورودی کاربر (با یا بدون #، سه یا شش رقمی، یا rgb) به #rrggbb استاندارد */
export function normalizeHexColor(raw: string): string | null {
  const s = toAsciiDigits(raw).trim();
  if (!s) return null;
  const hexMatch = s.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hexMatch) {
    const h = hexMatch[1].toLowerCase();
    if (h.length === 3) {
      return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    }
    return `#${h}`;
  }
  const rgbMatch = s.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i);
  if (rgbMatch) {
    const clamp = (n: number) => Math.max(0, Math.min(255, n));
    const r = clamp(Number(rgbMatch[1])).toString(16).padStart(2, "0");
    const g = clamp(Number(rgbMatch[2])).toString(16).padStart(2, "0");
    const b = clamp(Number(rgbMatch[3])).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }
  return null;
}

/** تشخیص کد ۶ رقمی کامل هنگام تایپ زنده (بدون تبدیل زودهنگام ۳ رقمی وسط تایپ) */
export function normalizeLiveHexInput(raw: string): string | null {
  const s = toAsciiDigits(raw).trim();
  const hex6 = s.match(/^#?([0-9a-fA-F]{6})$/);
  if (hex6) return `#${hex6[1].toLowerCase()}`;
  const rgbMatch = s.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*\)$/i);
  if (rgbMatch) return normalizeHexColor(s);
  return null;
}

export function sanitizeThemeColors(
  partial: Partial<Record<ThemeColorKey, unknown>> | null | undefined,
  fallback: ThemeColors = DEFAULT_THEME_COLORS
): ThemeColors {
  const out: ThemeColors = { ...fallback };
  if (!partial || typeof partial !== "object") return out;
  for (const key of ALL_THEME_KEYS) {
    const raw = partial[key];
    if (typeof raw === "string") {
      const clean = normalizeHexColor(raw);
      if (clean) out[key] = clean;
    }
  }
  return out;
}

export function isBuiltInThemeId(id: string): boolean {
  return BUILTIN_THEMES.some((t) => t.id === id);
}

export function getThemeBaseColors(themeId: string, customThemes: CustomThemePreset[]): ThemeColors {
  const builtIn = BUILTIN_THEMES.find((t) => t.id === themeId);
  if (builtIn) return { ...builtIn.colors };
  const custom = customThemes.find((t) => t.id === themeId);
  if (custom) return sanitizeThemeColors(custom.colors);
  return { ...DEFAULT_THEME_COLORS };
}

export function areThemeColorsEqual(a: ThemeColors, b: ThemeColors): boolean {
  for (const key of ALL_THEME_KEYS) {
    if (a[key].toLowerCase() !== b[key].toLowerCase()) return false;
  }
  return true;
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = normalizeHexColor(hex) ?? "#000000";
  const n = parseInt(clean.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexToRgb01(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
}

export function rgbaCss(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** روشن‌تر یا تیره‌تر کردن رنگ هگز: factor مثبت (0..1) به سمت سفید، منفی (-1..0) به سمت سیاه */
export function shadeHex(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = Math.max(-1, Math.min(1, factor));
  const mix = (c: number) =>
    Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f))
      .toString(16)
      .padStart(2, "0");
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}

export function opColorFromTheme(colors: ThemeColors, op: OpType): string {
  switch (op) {
    case "round": return colors.opRound;
    case "face": return colors.opFace;
    case "rough-d": return colors.opRoughD;
    case "rough-z": return colors.opRoughZ;
    case "copy": return colors.opCopy;
    case "offset": return colors.opOffset;
    case "finish": return colors.opFinish;
    case "bottom": return colors.opBottom;
    case "inner-rough": return colors.opInnerRough;
    case "inner-offset": return colors.opInnerOffset;
    case "inner-finish": return colors.opInnerFinish;
  }
}

export function segColorFromTheme(colors: ThemeColors, kind: SegKind): string {
  switch (kind) {
    case "rapid": return colors.opRapid;
    case "round": return colors.opRound;
    case "rough": return colors.opRoughD;
    case "roughz": return colors.opRoughZ;
    case "copy": return colors.opCopy;
    case "face": return colors.opFace;
    case "finish": return colors.opFinish;
    case "offset": return colors.opOffset;
    case "bore": return colors.opInnerRough;
    case "boreoff": return colors.opInnerOffset;
    case "borefin": return colors.opInnerFinish;
    case "bottom": return colors.opBottom;
  }
}

/** اعمال تمام متغیرهای رنگی تم روی ریشهٔ سند */
export function applyThemeToDocument(colors: ThemeColors, themeId: string): void {
  const root = document.documentElement;
  root.dataset.theme = themeId;

  /* متغیرهای پایهٔ Tailwind و لایهٔ عمومی */
  root.style.setProperty("--color-bg", colors.uiBg);
  root.style.setProperty("--color-header-bg", colors.uiHeaderBg);
  root.style.setProperty("--color-panel", colors.uiPanel);
  root.style.setProperty("--color-panel2", colors.uiPanel2);
  root.style.setProperty("--color-panel3", colors.uiPanel3);
  root.style.setProperty("--color-input-bg", colors.uiInputBg);
  root.style.setProperty("--color-edge", colors.uiEdge);
  root.style.setProperty("--color-edge2", colors.uiEdge2);
  root.style.setProperty("--color-ink", colors.uiInk);
  root.style.setProperty("--color-mute", colors.uiMute);
  root.style.setProperty("--color-dim", colors.uiDim);
  root.style.setProperty("--color-brass", colors.uiAccent);
  root.style.setProperty("--color-brass2", colors.uiAccent2);
  root.style.setProperty("--color-brass-ink", colors.uiAccentInk);
  root.style.setProperty("--color-teal", colors.uiSecondary);
  root.style.setProperty("--color-copper", colors.uiCopper);
  root.style.setProperty("--color-steel", colors.uiSteel);
  root.style.setProperty("--color-ok", colors.uiOk);
  root.style.setProperty("--color-danger", colors.uiDanger);

  /* متغیرهای بوم طراحی، پیش‌نمایش‌ها و ویرایش مسیر */
  root.style.setProperty("--profile-line-color", colors.profileOuter);
  root.style.setProperty("--selected-line-color", colors.profileSelected);
  root.style.setProperty("--guide-line-color", colors.pathEditSelected);
  root.style.setProperty("--theme-editor-bg", colors.editorBg);
  root.style.setProperty("--theme-pathedit-bg", colors.pathEditBg);
  root.style.setProperty("--theme-sim-bg", colors.simBg);
  root.style.setProperty("--theme-view3d-bg", colors.view3dBg);

  /* متغیرهای کمکی RGB برای هاله‌ها و کلاس‌های نیمه‌شفاف سازگار با ویندوز ۱۰ */
  const setRgb = (name: string, hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    root.style.setProperty(`--rgb-${name}`, `${r}, ${g}, ${b}`);
  };
  setRgb("bg", colors.uiBg);
  setRgb("panel", colors.uiPanel);
  setRgb("panel2", colors.uiPanel2);
  setRgb("panel3", colors.uiPanel3);
  setRgb("edge", colors.uiEdge);
  setRgb("edge2", colors.uiEdge2);
  setRgb("ink", colors.uiInk);
  setRgb("mute", colors.uiMute);
  setRgb("dim", colors.uiDim);
  setRgb("brass", colors.uiAccent);
  setRgb("brass2", colors.uiAccent2);
  setRgb("copper", colors.uiCopper);
  setRgb("teal", colors.uiSecondary);
  setRgb("steel", colors.uiSteel);
  setRgb("ok", colors.uiOk);
  setRgb("danger", colors.uiDanger);
  setRgb("gcode-active", colors.gcodeActiveLine);
  root.style.setProperty("--theme-profile-hover", colors.profileHover);

  /* متغیرهای پنل جی‌کد و رنگ‌بندی دستورات */
  root.style.setProperty("--theme-gcode-bg", colors.gcodeBg);
  root.style.setProperty("--theme-gcode-active", colors.gcodeActiveLine);
  root.style.setProperty("--theme-gcode-tok-g", colors.gcodeTokG);
  root.style.setProperty("--theme-gcode-tok-m", colors.gcodeTokM);
  root.style.setProperty("--theme-gcode-tok-x", colors.gcodeTokAxisX);
  root.style.setProperty("--theme-gcode-tok-y", colors.gcodeTokAxisY);
  root.style.setProperty("--theme-gcode-tok-z", colors.gcodeTokAxisZ);
  root.style.setProperty("--theme-gcode-tok-f", colors.gcodeTokFeed);
  root.style.setProperty("--theme-gcode-tok-c", colors.gcodeTokComment);
  root.style.setProperty("--theme-gcode-tok-n", colors.gcodeTokLineNum);
}

export interface SerializedThemeFile {
  format: "kharraat-theme";
  version: 1;
  name: string;
  colors: ThemeColors;
}

export function serializeThemeFile(name: string, colors: ThemeColors): string {
  const payload: SerializedThemeFile = {
    format: "kharraat-theme",
    version: 1,
    name: name.trim() || "تم سفارشی خراط‌کد",
    colors: sanitizeThemeColors(colors),
  };
  return JSON.stringify(payload, null, 2);
}

export function parseThemeFile(rawJson: string): { name: string; colors: ThemeColors } | null {
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const rawColors =
      parsed.colors && typeof parsed.colors === "object"
        ? (parsed.colors as Partial<Record<ThemeColorKey, unknown>>)
        : (parsed as Partial<Record<ThemeColorKey, unknown>>);
    const hasAnyKnownKey = ALL_THEME_KEYS.some(
      (k) => typeof rawColors[k] === "string" && normalizeHexColor(rawColors[k] as string) !== null
    );
    if (!hasAnyKnownKey) return null;
    const name =
      typeof parsed.name === "string" && parsed.name.trim()
        ? parsed.name.trim().slice(0, 60)
        : "تم بارگذاری‌شده";
    return {
      name,
      colors: sanitizeThemeColors(rawColors),
    };
  } catch {
    return null;
  }
}

export function toPersianDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => String.fromCharCode(0x06f0 + Number(d)));
}
