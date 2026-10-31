/* ------------------------------------------------------------------ */
/*  موتور اسکچ — خط، منحنی درجه۲/۳ و کمان سه‌نقطه‌ای برای طراحی پروفایل   */
/*  مختصات: z = طول قطعه (محور X نمایش) ، r = شعاع (محور Y نمایش)        */
/* ------------------------------------------------------------------ */

import type { PPoint } from "./lathe";

export interface SPoint {
  z: number;
  r: number;
}

export type SketchKind = "line" | "quad" | "cubic" | "arc";

export interface SketchSeg {
  id: number;
  kind: SketchKind;
  a: SPoint; // نقطه شروع
  b: SPoint; // نقطه پایان
  c1?: SPoint; // منحنی درجه۲: تنها نقطه کنترل | درجه۳: دستهٔ اول
  c2?: SPoint; // منحنی درجه۳: دستهٔ دوم
  via?: SPoint; // کمان: نقطهٔ روی کمان
  /** شناسه مشترک بخش‌های یک Polyline؛ بخش‌ها از نظر هندسی Line می‌مانند. */
  polylineId?: number;
  /** شناسهٔ دو خط سازنده؛ برای جایگزینی Fillet قبلی روی همان جفت خط */
  filletOf?: [number, number];
  /** تعداد پاره‌خط‌های نمایش/تبدیل کمان؛ در نبود آن مقدار خودکار استفاده می‌شود. */
  arcDivisions?: number;
  /** دستهٔ این انتها از قرینگی رأس نرم جدا شده و مستقل حرکت می‌کند. */
  independentA?: boolean;
  independentB?: boolean;
}

export const KIND_FA: Record<SketchKind, string> = {
  line: "خط",
  quad: "منحنی ساده",
  cubic: "منحنی کنترلی",
  arc: "کمان",
};

let segUid = 5000;
export const newSegId = () => ++segUid;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist = (p: SPoint, q: SPoint) => Math.hypot(p.z - q.z, p.r - q.r);

/* ---------------- کمان از سه نقطه ---------------- */

export interface ArcInfo {
  center: SPoint;
  radius: number;
  a0: number; // زاویه شروع
  sweep: number; // بازهٔ زاویه (علامت = جهت)
}

export function arcInfo(s: SketchSeg): ArcInfo | null {
  const { a, b, via } = s;
  if (!via) return null;
  const d = 2 * (a.z * (via.r - b.r) + via.z * (b.r - a.r) + b.z * (a.r - via.r));
  if (Math.abs(d) < 1e-9) return null; // هم‌خط
  const aa = a.z * a.z + a.r * a.r;
  const mm = via.z * via.z + via.r * via.r;
  const bb = b.z * b.z + b.r * b.r;
  const cz = (aa * (via.r - b.r) + mm * (b.r - a.r) + bb * (a.r - via.r)) / d;
  const cr = (aa * (b.z - via.z) + mm * (a.z - b.z) + bb * (via.z - a.z)) / d;
  const center = { z: cz, r: cr };
  const radius = Math.hypot(a.z - cz, a.r - cr);
  if (!Number.isFinite(radius) || radius > 1e6) return null;
  const TAU = Math.PI * 2;
  const norm = (x: number) => ((x % TAU) + TAU) % TAU;
  const a0 = Math.atan2(a.r - cr, a.z - cz);
  const a1 = Math.atan2(b.r - cr, b.z - cz);
  const am = Math.atan2(via.r - cr, via.z - cz);
  const dCCW = norm(a1 - a0);
  const mCCW = norm(am - a0);
  const ccw = mCCW <= dCCW;
  const sweep = ccw ? dCCW : -(TAU - dCCW);
  return { center, radius, a0, sweep };
}

/* ---------------- ارزیابی نقطه روی المان ---------------- */

export function evalSeg(s: SketchSeg, t: number): SPoint {
  const { a, b } = s;
  if (s.kind === "line") return { z: lerp(a.z, b.z, t), r: lerp(a.r, b.r, t) };
  if (s.kind === "quad" && s.c1) {
    const u = 1 - t;
    return {
      z: u * u * a.z + 2 * u * t * s.c1.z + t * t * b.z,
      r: u * u * a.r + 2 * u * t * s.c1.r + t * t * b.r,
    };
  }
  if (s.kind === "cubic" && s.c1 && s.c2) {
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    return {
      z: w0 * a.z + w1 * s.c1.z + w2 * s.c2.z + w3 * b.z,
      r: w0 * a.r + w1 * s.c1.r + w2 * s.c2.r + w3 * b.r,
    };
  }
  if (s.kind === "arc") {
    const info = arcInfo(s);
    if (!info) return { z: lerp(a.z, b.z, t), r: lerp(a.r, b.r, t) };
    const ang = info.a0 + info.sweep * t;
    return { z: info.center.z + info.radius * Math.cos(ang), r: info.center.r + info.radius * Math.sin(ang) };
  }
  return { z: lerp(a.z, b.z, t), r: lerp(a.r, b.r, t) };
}

/** نقاط گسسته روی المان (برای ترسیم و تخت‌سازی) */
export function segPoints(s: SketchSeg, n?: number): SPoint[] {
  if (s.kind === "line") return [s.a, s.b];
  const configured = s.kind === "arc" && Number.isFinite(s.arcDivisions)
    ? Math.max(2, Math.min(500, Math.round(s.arcDivisions!)))
    : undefined;
  const steps = n ?? configured ?? Math.max(10, Math.min(90, Math.ceil(segLength(s) / 1.2)));
  const out: SPoint[] = [];
  for (let i = 0; i <= steps; i++) out.push(evalSeg(s, i / steps));
  return out;
}

export function segLength(s: SketchSeg): number {
  if (s.kind === "line") return dist(s.a, s.b);
  if (s.kind === "arc") {
    const info = arcInfo(s);
    if (info) return Math.abs(info.sweep) * info.radius;
  }
  let len = 0;
  let prev = evalSeg(s, 0);
  for (let i = 1; i <= 24; i++) {
    const p = evalSeg(s, i / 24);
    len += dist(prev, p);
    prev = p;
  }
  return len;
}

export const segMid = (s: SketchSeg): SPoint => evalSeg(s, 0.5);

export interface SegBounds {
  minZ: number;
  maxZ: number;
  minR: number;
  maxR: number;
}

/**
 * کران دقیق هندسهٔ قابل‌مشاهدهٔ المان.
 *
 * نقاط کنترل بزیه عمداً جزو کران نیستند: ممکن است بیرون قطعهٔ خام باشند،
 * درحالی‌که خود منحنی هنوز کاملاً داخل قطعه است.
 */
export function segBounds(s: SketchSeg): SegBounds {
  const pts: SPoint[] = [s.a, s.b];
  const addAt = (t: number) => {
    if (Number.isFinite(t) && t > 1e-10 && t < 1 - 1e-10) pts.push(evalSeg(s, t));
  };

  if (s.kind === "quad" && s.c1) {
    /* نمونهٔ میانی، کران را در برابر ورودی‌های عددی بسیار بزرگ هم fail-safe می‌کند. */
    addAt(0.5);
    const addQuadRoot = (p0: number, p1: number, p2: number) => {
      const den = p0 - 2 * p1 + p2;
      if (Math.abs(den) > 1e-12) addAt((p0 - p1) / den);
    };
    addQuadRoot(s.a.z, s.c1.z, s.b.z);
    addQuadRoot(s.a.r, s.c1.r, s.b.r);
  } else if (s.kind === "cubic" && s.c1 && s.c2) {
    addAt(0.25);
    addAt(0.5);
    addAt(0.75);
    const addCubicRoots = (p0: number, p1: number, p2: number, p3: number) => {
      /* B'(t) / 3 = A t² + B t + C */
      const A = -p0 + 3 * p1 - 3 * p2 + p3;
      const B = 2 * (p0 - 2 * p1 + p2);
      const C = p1 - p0;
      if (Math.abs(A) < 1e-12) {
        if (Math.abs(B) > 1e-12) addAt(-C / B);
        return;
      }
      const disc = B * B - 4 * A * C;
      if (disc < -1e-12) return;
      const root = Math.sqrt(Math.max(0, disc));
      addAt((-B - root) / (2 * A));
      addAt((-B + root) / (2 * A));
    };
    addCubicRoots(s.a.z, s.c1.z, s.c2.z, s.b.z);
    addCubicRoots(s.a.r, s.c1.r, s.c2.r, s.b.r);
  } else if (s.kind === "arc") {
    const info = arcInfo(s);
    if (info) {
      const TAU = Math.PI * 2;
      const norm = (x: number) => ((x % TAU) + TAU) % TAU;
      const onSweep = (angle: number) =>
        info.sweep >= 0
          ? norm(angle - info.a0) <= info.sweep + 1e-10
          : norm(info.a0 - angle) <= -info.sweep + 1e-10;
      for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
        if (onSweep(angle)) {
          pts.push({
            z: info.center.z + info.radius * Math.cos(angle),
            r: info.center.r + info.radius * Math.sin(angle),
          });
        }
      }
    }
  }

  return {
    minZ: Math.min(...pts.map((p) => p.z)),
    maxZ: Math.max(...pts.map((p) => p.z)),
    minR: Math.min(...pts.map((p) => p.r)),
    maxR: Math.max(...pts.map((p) => p.r)),
  };
}

/* ---------------- ساخت المان‌ها ---------------- */

export function makeSeg(kind: SketchKind, pts: SPoint[]): SketchSeg | null {
  const id = newSegId();
  if (kind === "line" && pts.length >= 2) return { id, kind, a: pts[0], b: pts[1] };
  if (kind === "quad" && pts.length >= 3) return { id, kind, a: pts[0], b: pts[1], c1: pts[2] };
  if (kind === "cubic" && pts.length >= 4) return { id, kind, a: pts[0], b: pts[1], c1: pts[2], c2: pts[3] };
  if (kind === "arc" && pts.length >= 3) return { id, kind, a: pts[0], b: pts[1], via: pts[2] };
  return null;
}

/** دستهٔ پیش‌فرض برای منحنی درجه۳ بین دو نقطه */
export function defaultCubicHandles(a: SPoint, b: SPoint): [SPoint, SPoint] {
  return [
    { z: lerp(a.z, b.z, 1 / 3), r: lerp(a.r, b.r, 1 / 3) },
    { z: lerp(a.z, b.z, 2 / 3), r: lerp(a.r, b.r, 2 / 3) },
  ];
}

/* ---------------- کنترل دقیق هندسی ---------------- */

export const lineAngle = (a: SPoint, b: SPoint) => (Math.atan2(b.r - a.r, b.z - a.z) * 180) / Math.PI;

/** نقطهٔ پایان جدید بر اساس طول و زاویهٔ دقیق */
export function endFromLenAngle(a: SPoint, len: number, angDeg: number): SPoint {
  const rad = (angDeg * Math.PI) / 180;
  return { z: a.z + len * Math.cos(rad), r: a.r + len * Math.sin(rad) };
}

/** تنظیم شعاع کمان با جابه‌جایی نقطهٔ میانی روی عمودمنصف وتر */
export function arcWithRadius(s: SketchSeg, radius: number): SketchSeg {
  const { a, b } = s;
  const mz = (a.z + b.z) / 2;
  const mr = (a.r + b.r) / 2;
  const half = dist(a, b) / 2;
  if (half < 1e-6) return s;
  const R = Math.max(radius, half + 1e-4);
  const dz = (b.z - a.z) / (2 * half);
  const dr = (b.r - a.r) / (2 * half);
  const nz = -dr;
  const nr = dz;
  const info = arcInfo(s);
  let side = 1;
  if (info && s.via) {
    const cur = (s.via.z - mz) * nz + (s.via.r - mr) * nr;
    side = cur >= 0 ? 1 : -1;
  }
  const sag = R - Math.sqrt(Math.max(0, R * R - half * half));
  return { ...s, via: { z: mz + nz * sag * side, r: mr + nr * sag * side } };
}

export function arcRadius(s: SketchSeg): number {
  const info = arcInfo(s);
  return info ? info.radius : 0;
}

/* ---------------- جابه‌جایی و کپی ---------------- */

const movePt = (p: SPoint, dz: number, dr: number): SPoint => ({ z: p.z + dz, r: p.r + dr });

export function moveSeg(s: SketchSeg, dz: number, dr: number): SketchSeg {
  return {
    ...s,
    a: movePt(s.a, dz, dr),
    b: movePt(s.b, dz, dr),
    c1: s.c1 ? movePt(s.c1, dz, dr) : undefined,
    c2: s.c2 ? movePt(s.c2, dz, dr) : undefined,
    via: s.via ? movePt(s.via, dz, dr) : undefined,
    filletOf: s.filletOf ? [...s.filletOf] : undefined,
    arcDivisions: s.arcDivisions,
  };
}

export function cloneSeg(s: SketchSeg, dz = 0, dr = 0): SketchSeg {
  return { ...moveSeg(s, dz, dr), id: newSegId() };
}

/* ---------------- اسنپ هوشمند ---------------- */

export type SnapType = "end" | "mid" | "center" | "ctrl" | "cross" | "axis" | "grid" | "split";

export interface SnapPoint {
  p: SPoint;
  type: SnapType;
  segId?: number;
  segId2?: number;
}

export const SNAP_FA: Record<SnapType, string> = {
  end: "نقطهٔ انتها",
  mid: "وسط",
  center: "مرکز کمان",
  ctrl: "نقطهٔ کنترل",
  cross: "تقاطع",
  axis: "محور",
  grid: "شبکه",
  split: "نقطهٔ Split",
};

/** نقاط مهم هندسی برای چسبندگی (به‌جز شبکه که پویا محاسبه می‌شود) */
export function snapCandidates(segs: SketchSeg[]): SnapPoint[] {
  const out: SnapPoint[] = [];
  for (const s of segs) {
    out.push({ p: s.a, type: "end", segId: s.id });
    out.push({ p: s.b, type: "end", segId: s.id });
    out.push({ p: segMid(s), type: "mid", segId: s.id });
    if (s.c1) out.push({ p: s.c1, type: "ctrl", segId: s.id });
    if (s.c2) out.push({ p: s.c2, type: "ctrl", segId: s.id });
    if (s.kind === "arc") {
      const info = arcInfo(s);
      if (info) out.push({ p: info.center, type: "center", segId: s.id });
      if (s.via) out.push({ p: s.via, type: "ctrl", segId: s.id });
    }
  }
  return out;
}

function segIntersect(p1: SPoint, p2: SPoint, p3: SPoint, p4: SPoint): SPoint | null {
  const d = (p2.z - p1.z) * (p4.r - p3.r) - (p2.r - p1.r) * (p4.z - p3.z);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((p3.z - p1.z) * (p4.r - p3.r) - (p3.r - p1.r) * (p4.z - p3.z)) / d;
  const u = ((p3.z - p1.z) * (p2.r - p1.r) - (p3.r - p1.r) * (p2.z - p1.z)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { z: p1.z + t * (p2.z - p1.z), r: p1.r + t * (p2.r - p1.r) };
}

/** نقاط تقاطع بین المان‌ها (روی چندضلعی تقریبی) */
export function intersectionPoints(segs: SketchSeg[]): SnapPoint[] {
  const polys = segs.map((s) => segPoints(s, s.kind === "line" ? 1 : 26));
  const out: SnapPoint[] = [];
  for (let i = 0; i < polys.length && out.length < 60; i++) {
    for (let j = i + 1; j < polys.length && out.length < 60; j++) {
      const sA = segs[i];
      const sB = segs[j];
      const A = polys[i];
      const B = polys[j];
      for (let x = 0; x < A.length - 1; x++) {
        for (let y = 0; y < B.length - 1; y++) {
          const hit = segIntersect(A[x], A[x + 1], B[y], B[y + 1]);
          if (!hit) continue;
          /* رئوس مشترک دو ضلع متصل (مانند Polyline) نقطه انتها هستند، نه تقاطع مستقل */
          const onEndA = dist(hit, sA.a) < 1e-6 || dist(hit, sA.b) < 1e-6;
          const onEndB = dist(hit, sB.a) < 1e-6 || dist(hit, sB.b) < 1e-6;
          if (onEndA && onEndB) continue;
          if (!out.some((o) => dist(o.p, hit) < 0.4)) {
            out.push({ p: hit, type: "cross", segId: sA.id, segId2: sB.id });
          }
        }
      }
    }
  }
  return out;
}

/* ---------------- نزدیک‌ترین نقطه روی المان (برای انتخاب) ---------------- */

export function distToPoly(pts: SPoint[], p: SPoint): number {
  if (pts.length === 0) return Infinity;
  if (pts.length === 1) return Math.hypot(p.z - pts[0].z, p.r - pts[0].r);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dz = b.z - a.z;
    const dr = b.r - a.r;
    const L2 = dz * dz + dr * dr;
    let t = L2 > 1e-12 ? ((p.z - a.z) * dz + (p.r - a.r) * dr) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(p.z - (a.z + t * dz), p.r - (a.r + t * dr));
    if (d < best) best = d;
  }
  return best;
}

export function distToSeg(s: SketchSeg, p: SPoint): number {
  const pts = segPoints(s, s.kind === "line" ? 1 : 40);
  return distToPoly(pts, p);
}

/* ---------------- تبدیل به پروفایل موتور تراش ---------------- */

let ppUid = 90000;

/**
 * تخت‌سازی اسکچ به نقاط پروفایل با حفظ ترتیب زنجیره و خطوط قائم (+۹۰° و −۹۰°)
 * تا شیارهای Uشکل، پله‌های عمودی و گوشه‌های تیز در عملیات خشن شعاعی و افست حذف نشوند.
 */
export function flattenSketch(segs: SketchSeg[], blankR: number, blankL: number): PPoint[] {
  if (segs.length === 0) return [];
  const ordered = chainPolyline(orderChain(segs));
  if (ordered.length >= 2) {
    return branchPathPoints(ordered, blankR, blankL);
  }
  const raw: SPoint[] = [];
  for (const s of segs) {
    const pts = s.kind === "line" ? [s.a, s.b] : segPoints(s);
    for (const p of pts) {
      if (!Number.isFinite(p.z) || !Number.isFinite(p.r)) continue;
      raw.push({ z: Math.min(blankL, Math.max(0, p.z)), r: Math.min(blankR, Math.max(0, p.r)) });
    }
  }
  if (raw.length < 2) return [];
  raw.sort((x, y) => x.z - y.z);
  return raw.map((p) => ({ id: ++ppUid, z: p.z, r: p.r, smooth: false }));
}

/**
 * ساخت اسکچ از نقاط قدیمی: بازه‌های «صاف» به منحنی درجه۳ معادل کاتمول‑رام
 * (دقیقاً همان شکل قبلی) و بقیه به خط تبدیل می‌شوند.
 */
export function sketchFromPoints(pts: { z: number; r: number; smooth: boolean }[]): SketchSeg[] {
  const p = [...pts].sort((x, y) => x.z - y.z);
  const out: SketchSeg[] = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[Math.min(p.length - 1, i + 2)];
    if (p1.smooth && p2.smooth) {
      out.push({
        id: newSegId(),
        kind: "cubic",
        a: { z: p1.z, r: p1.r },
        b: { z: p2.z, r: p2.r },
        c1: { z: p1.z + (p2.z - p0.z) / 6, r: p1.r + (p2.r - p0.r) / 6 },
        c2: { z: p2.z - (p3.z - p1.z) / 6, r: p2.r - (p3.r - p1.r) / 6 },
      });
    } else {
      out.push({ id: newSegId(), kind: "line", a: { z: p1.z, r: p1.r }, b: { z: p2.z, r: p2.r } });
    }
  }
  return out;
}

/* ---------------- زنجیره‌سازی پروفیل و نقطه Split (کاسه) ---------------- */

export interface ChainItem {
  seg: SketchSeg;
  reversed: boolean;
}

const VERT_TOL = 1e-3;

function branchMidRAtZ(branch: SPoint[], z: number): number | null {
  let lo = Infinity;
  let hi = -Infinity;
  let hit = false;
  for (let i = 0; i < branch.length - 1; i++) {
    const a = branch[i];
    const b = branch[i + 1];
    const dz = b.z - a.z;
    if (Math.abs(dz) <= 1e-7) {
      if (Math.abs(z - a.z) <= 1e-5) {
        const rMin = Math.min(a.r, b.r);
        const rMax = Math.max(a.r, b.r);
        if (rMin < lo) lo = rMin;
        if (rMax > hi) hi = rMax;
        hit = true;
      }
    } else if ((a.z <= z + 1e-9 && b.z >= z - 1e-9) || (b.z <= z + 1e-9 && a.z >= z - 1e-9)) {
      const t = Math.max(0, Math.min(1, (z - a.z) / dz));
      const r = a.r + (b.r - a.r) * t;
      if (r < lo) lo = r;
      if (r > hi) hi = r;
      hit = true;
    }
  }
  return hit ? 0.5 * (lo + hi) : null;
}

function branchWeightedMean(branch: SPoint[]): SPoint {
  if (branch.length === 0) return { z: 0, r: 0 };
  if (branch.length === 1) return { z: branch[0].z, r: branch[0].r };
  let sumLen = 0;
  let sumZ = 0;
  let sumR = 0;
  for (let i = 0; i < branch.length - 1; i++) {
    const a = branch[i];
    const b = branch[i + 1];
    const len = Math.hypot(b.z - a.z, b.r - a.r);
    sumLen += len;
    sumZ += 0.5 * (a.z + b.z) * len;
    sumR += 0.5 * (a.r + b.r) * len;
  }
  if (sumLen <= 1e-9) {
    return {
      z: 0.5 * (branch[0].z + branch[branch.length - 1].z),
      r: 0.5 * (branch[0].r + branch[branch.length - 1].r),
    };
  }
  return { z: sumZ / sumLen, r: sumR / sumLen };
}

/**
 * مقایسهٔ پادمتقارن دو شاخه برای تشخیص «شاخهٔ خارجی (مثبت) در برابر شاخهٔ داخلی (منفی)»:
 * ۱) اگر دو شاخه در بازهٔ طولی Z هم‌پوشانی دارند (پروفیل برگشتی مانند کاسه/لیوان/گلدان)،
 *    شاخه‌ای که در بازهٔ مشترک شعاع بزرگ‌تری دارد شاخهٔ بیرونی است.
 * ۲) در غیر این صورت، شاخهٔ سمت سه‌نظام (Z کوچک‌تر) شاخهٔ اول/بیرونی و شاخهٔ سمت دهانه (Z بزرگ‌تر)
 *    شاخهٔ دوم/داخلی است؛ و در حالت کاملاً قائم، شعاع بزرگ‌تر بیرونی است.
 */
function compareOuterVsInnerBranches(branchA: SPoint[], branchB: SPoint[]): number {
  let minZA = Infinity, maxZA = -Infinity;
  for (const p of branchA) {
    if (p.z < minZA) minZA = p.z;
    if (p.z > maxZA) maxZA = p.z;
  }
  let minZB = Infinity, maxZB = -Infinity;
  for (const p of branchB) {
    if (p.z < minZB) minZB = p.z;
    if (p.z > maxZB) maxZB = p.z;
  }
  const ovLo = Math.max(minZA, minZB);
  const ovHi = Math.min(maxZA, maxZB);
  if (ovHi - ovLo > 0.2) {
    const SAMPLES = 24;
    let sumDiff = 0;
    let count = 0;
    for (let k = 0; k < SAMPLES; k++) {
      const z = ovLo + ((k + 0.5) / SAMPLES) * (ovHi - ovLo);
      const rA = branchMidRAtZ(branchA, z);
      const rB = branchMidRAtZ(branchB, z);
      if (rA != null && rB != null) {
        sumDiff += rA - rB;
        count++;
      }
    }
    if (count > 0) {
      const avgDiff = sumDiff / count;
      if (Math.abs(avgDiff) > 1e-4) return avgDiff;
    }
  }
  const meanA = branchWeightedMean(branchA);
  const meanB = branchWeightedMean(branchB);
  const dz = meanB.z - meanA.z;
  if (Math.abs(dz) > 1e-4) return dz;
  return meanA.r - meanB.r;
}

function reverseChainItems(chain: ChainItem[]): ChainItem[] {
  const out: ChainItem[] = new Array(chain.length);
  for (let i = 0; i < chain.length; i++) {
    const it = chain[chain.length - 1 - i];
    out[i] = { seg: it.seg, reversed: !it.reversed };
  }
  return out;
}

function orientChainCanonically(chain: ChainItem[]): ChainItem[] {
  if (chain.length === 0) return chain;
  const pts = chainPolyline(chain);
  const m = pts.length - 1;
  if (m < 1) return chain;

  /* حلقهٔ بسته: جهت ساعت‌گرد در مختصات (Z به راست، R به بالا) یعنی بیرون در بالا به +Z و داخل در پایین به -Z */
  if (dist(pts[0], pts[m]) <= VERT_TOL && pts.length >= 4) {
    let area2 = 0;
    for (let i = 0; i < m; i++) {
      area2 += pts[i].z * pts[i + 1].r - pts[i + 1].z * pts[i].r;
    }
    area2 += pts[m].z * pts[0].r - pts[0].z * pts[m].r;
    return area2 > 1e-6 ? reverseChainItems(chain) : chain;
  }

  let maxZ = -Infinity;
  for (const p of pts) if (p.z > maxZ) maxZ = p.z;
  let firstMax = -1;
  let lastMax = -1;
  for (let i = 0; i <= m; i++) {
    if (pts[i].z >= maxZ - 1e-5) {
      if (firstMax < 0) firstMax = i;
      lastMax = i;
    }
  }

  /* اگر بیشترین Z درون زنجیره باشد (لبهٔ برگشتی کاسه/لیوان)، دو نیمهٔ زنجیره حول لبه مقایسه می‌شوند */
  if (firstMax > 0 && lastMax < m) {
    const branchA = pts.slice(0, lastMax + 1);
    const branchB = pts.slice(firstMax);
    const score = compareOuterVsInnerBranches(branchA, branchB);
    return score < -1e-6 ? reverseChainItems(chain) : chain;
  }

  /* پروفیل تک‌شاخه (بدون برگشت از لبه): از چپ به راست (Z کوچک‌تر به Z بزرگ‌تر) */
  const dz = pts[m].z - pts[0].z;
  if (Math.abs(dz) > 1e-5) return dz < 0 ? reverseChainItems(chain) : chain;
  const dr = pts[0].r - pts[m].r;
  if (Math.abs(dr) > 1e-5) return dr < 0 ? reverseChainItems(chain) : chain;
  return chain;
}

/**
 * مرتب‌سازی المان‌ها به ترتیب مسیر (زنجیره): المان‌های متصل را دوطرفه به هم
 * می‌چسباند و جهت زنجیره را به‌صورت هندسی و مستقل از ترتیب آرایهٔ segs
 * (خارج ← لبه ← داخل، یا چپ به راست) تثبیت می‌کند تا افزودن خط جدید به هر سر
 * پلی‌لاین هرگز جای شاخهٔ داخلی و خارجی را عوض نکند.
 */
export function orderChain(segs: SketchSeg[]): ChainItem[] {
  if (segs.length === 0) return [];

  /* خوشه‌بندی نقاط انتهایی با تلرانس فاصلهٔ واقعی (بدون خطای مرزی گردکردن شبکه‌ای) */
  const clusters: SPoint[] = [];
  const vertOf = (p: SPoint): number => {
    for (let i = 0; i < clusters.length; i++) {
      if (Math.hypot(clusters[i].z - p.z, clusters[i].r - p.r) <= VERT_TOL) return i;
    }
    clusters.push({ z: p.z, r: p.r });
    return clusters.length - 1;
  };
  const vEnds = new Map<number, { va: number; vb: number }>();
  const deg = new Map<number, number>();
  for (const s of segs) {
    const va = vertOf(s.a);
    const vb = vertOf(s.b);
    vEnds.set(s.id, { va, vb });
    deg.set(va, (deg.get(va) ?? 0) + 1);
    deg.set(vb, (deg.get(vb) ?? 0) + 1);
  }

  const unused = new Map<number, SketchSeg>(segs.map((s) => [s.id, s]));
  const chains: ChainItem[][] = [];
  const itemStartV = (it: ChainItem): number => {
    const e = vEnds.get(it.seg.id)!;
    return it.reversed ? e.vb : e.va;
  };
  const itemEndV = (it: ChainItem): number => {
    const e = vEnds.get(it.seg.id)!;
    return it.reversed ? e.va : e.vb;
  };

  /* در گره‌های چندشاخه (T-junction)، ادامهٔ هم‌گروه در Polyline و شاخه‌های غیردنباله‌کوتاه اولویت دارند */
  const pickBestNeighbor = (tipV: number, preferPolyId: number | undefined, asTail: boolean): ChainItem | null => {
    let best: ChainItem | null = null;
    let bestScore = -Infinity;
    for (const s of unused.values()) {
      const e = vEnds.get(s.id)!;
      if (e.va !== tipV && e.vb !== tipV) continue;
      const reversed = asTail ? e.va !== tipV : e.vb !== tipV;
      const otherV = e.va === tipV ? e.vb : e.va;
      let otherUnused = 0;
      for (const rem of unused.values()) {
        if (rem.id === s.id) continue;
        const re = vEnds.get(rem.id)!;
        if (re.va === otherV || re.vb === otherV) otherUnused++;
      }
      const samePoly = preferPolyId != null && s.polylineId === preferPolyId ? 100 : 0;
      const continues = otherUnused > 0 ? 10 : 0;
      const len = Math.min(9, segLength(s) * 0.01);
      const score = samePoly + continues + len;
      if (score > bestScore) {
        bestScore = score;
        best = { seg: s, reversed };
      }
    }
    return best;
  };

  while (unused.size) {
    let first: SketchSeg | undefined;
    for (const s of unused.values()) {
      const e = vEnds.get(s.id)!;
      if ((deg.get(e.va) ?? 0) <= 1 || (deg.get(e.vb) ?? 0) <= 1) {
        first = s;
        break;
      }
    }
    if (!first) first = unused.values().next().value as SketchSeg;
    unused.delete(first.id);
    const fe = vEnds.get(first.id)!;
    const aFree = (deg.get(fe.va) ?? 0) <= 1;
    const bFree = (deg.get(fe.vb) ?? 0) <= 1;
    const chain: ChainItem[] = [{ seg: first, reversed: !aFree && bFree }];

    /* گسترش از انتها */
    for (let guard = 0; guard <= segs.length; guard++) {
      const lastItem = chain[chain.length - 1];
      const next = pickBestNeighbor(itemEndV(lastItem), lastItem.seg.polylineId, true);
      if (!next) break;
      unused.delete(next.seg.id);
      chain.push(next);
    }
    /* گسترش از ابتدا (در صورتی که نقطهٔ شروع وسط زنجیره یا گره بوده باشد) */
    for (let guard = 0; guard <= segs.length; guard++) {
      const firstItem = chain[0];
      const prev = pickBestNeighbor(itemStartV(firstItem), firstItem.seg.polylineId, false);
      if (!prev) break;
      unused.delete(prev.seg.id);
      chain.unshift(prev);
    }

    chains.push(orientChainCanonically(chain));
  }

  if (chains.length > 1) {
    chains.sort((cA, cB) => {
      const pA = chainPolyline(cA);
      const pB = chainPolyline(cB);
      let minZA = Infinity, maxZA = -Infinity;
      for (const q of pA) { if (q.z < minZA) minZA = q.z; if (q.z > maxZA) maxZA = q.z; }
      let minZB = Infinity, maxZB = -Infinity;
      for (const q of pB) { if (q.z < minZB) minZB = q.z; if (q.z > maxZB) maxZB = q.z; }
      const disjointZ = maxZA <= minZB + 1e-3 || maxZB <= minZA + 1e-3;
      if (disjointZ) return minZA - minZB;
      if (cB.length !== cA.length) return cB.length - cA.length;
      return (pA[0]?.z ?? 0) - (pB[0]?.z ?? 0);
    });
  }

  return chains.flat();
}

/** نمونه‌برداری زنجیره به چندضلعی پیوسته (به ترتیب مسیر) */
export function chainPolyline(chain: ChainItem[]): SPoint[] {
  const out: SPoint[] = [];
  for (const it of chain) {
    const pts = it.seg.kind === "line" ? [it.seg.a, it.seg.b] : segPoints(it.seg);
    const arr = it.reversed ? [...pts].reverse() : pts;
    for (const p of arr) {
      if (!out.length || dist(out[out.length - 1], p) > 1e-6) out.push({ z: p.z, r: p.r });
    }
  }
  return out;
}

export interface SplitResult {
  outer: SPoint[]; // شاخه خارج کاسه (از انتهای آزاد خارجی تا نقطه Split)
  inner: SPoint[]; // شاخه داخل کاسه (از نقطه Split تا انتهای آزاد داخلی)
  splitIndex: number; // اندیس رأس Split در چندضلعی زنجیره
  splitAt: SPoint; // نزدیک‌ترین نقطه زنجیره به نقطه Split
  outerDir: 1 | -1; // جهت حرکت طولی شاخه خارجی (+۱ پیشرو / ‎−۱‎ برگشت)
  innerDir: 1 | -1; // جهت حرکت طولی شاخه داخلی
}

/**
 * تقسیم زنجیره در نزدیک‌ترین نقطهٔ مسیر به Split + تشخیص جهت و سمت هندسی هر شاخه.
 * نزدیک‌ترین نقطه روی خودِ پاره‌خط‌ها (پرتو) پیدا می‌شود — نه فقط رأس‌ها —
 * تا مثلاً نقطهٔ وسط لبه دقیقاً روی ضخامت لبه بیفتد و شاخه داخلی تمیز جدا شود.
 * همچنین حتی اگر زنجیرهٔ ورودی از داخل به خارج پیمایش شده باشد، شاخهٔ خارجی همیشه
 * از انتهای آزاد به Split و شاخهٔ داخلی از Split به انتهای آزاد برگردانده می‌شود.
 */
export function splitChainAt(poly: SPoint[], split: SPoint): SplitResult {
  let bi = 0;
  let bd = Infinity;
  let proj: SPoint = { ...poly[0] };
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const dz = b.z - a.z;
    const dr = b.r - a.r;
    const L2 = dz * dz + dr * dr;
    let t = L2 > 1e-12 ? ((split.z - a.z) * dz + (split.r - a.r) * dr) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = a.z + t * dz;
    const pr = a.r + t * dr;
    const d = Math.hypot(split.z - px, split.r - pr);
    if (d < bd) {
      bd = d;
      bi = i;
      proj = { z: px, r: pr };
    }
  }
  const rawOuter = [...poly.slice(0, bi + 1), { ...proj }];
  const rawInner = [{ ...proj }, ...poly.slice(bi + 1)];
  const reversedBranches = compareOuterVsInnerBranches(rawOuter, rawInner) < -1e-6;
  const outer = reversedBranches ? [...rawInner].reverse() : rawOuter;
  const inner = reversedBranches ? [...rawOuter].reverse() : rawInner;
  const dir = (arr: SPoint[]): 1 | -1 => (arr.length < 2 || arr[arr.length - 1].z >= arr[0].z ? 1 : -1);
  return { outer, inner, splitIndex: bi, splitAt: proj, outerDir: dir(outer), innerDir: dir(inner) };
}

/** نقطه Split خودکار: وسط لبه (بیشترین Z زنجیره) */
export function autoSplitPoint(poly: SPoint[]): SPoint | null {
  if (poly.length < 3) return null;
  let maxZ = -Infinity;
  for (const p of poly) if (p.z > maxZ) maxZ = p.z;
  const cands = poly.filter((p) => Math.abs(p.z - maxZ) < 0.6);
  if (!cands.length) return null;
  const avgR = cands.reduce((s, p) => s + p.r, 0) / cands.length;
  return { z: Math.round(maxZ * 10) / 10, r: Math.round(avgR * 10) / 10 };
}

/**
 * ساخت اسکچ از دیواره کاسه: مانند sketchFromPoints ولی **بدون مرتب‌سازی** —
 * ترتیب مسیر (خارج ← لبه ← داخل) حفظ می‌شود.
 */
export function sketchFromWall(wall: { z: number; r: number; smooth: boolean }[]): SketchSeg[] {
  const p = wall;
  const out: SketchSeg[] = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[Math.min(p.length - 1, i + 2)];
    if (p1.smooth && p2.smooth) {
      out.push({
        id: newSegId(),
        kind: "cubic",
        a: { z: p1.z, r: p1.r },
        b: { z: p2.z, r: p2.r },
        c1: { z: p1.z + (p2.z - p0.z) / 6, r: p1.r + (p2.r - p0.r) / 6 },
        c2: { z: p2.z - (p3.z - p1.z) / 6, r: p2.r - (p3.r - p1.r) / 6 },
      });
    } else {
      out.push({ id: newSegId(), kind: "line", a: { z: p1.z, r: p1.r }, b: { z: p2.z, r: p2.r } });
    }
  }
  return out;
}

let branchUid = 95000;

/**
 * تبدیل یک شاخه زنجیره به نقاط پروفیل موتور تراش.
 * keep = "max" برای شاخه خارجی (پوشش بیرونی) و "min" برای شاخه داخلی
 * (مرز حفره — در Zهای مشترک مثل لبه، شعاع کوچک‌تر مرز داخلی است).
 */
/** شاخهٔ داخلی با ترتیب توپولوژیک اصلی؛ برای Offset و Finish نباید برحسب Z مرتب شود. */
export function branchPathPoints(branch: SPoint[], blankR: number, blankL: number): PPoint[] {
  return branch
    .filter((p) => Number.isFinite(p.z) && Number.isFinite(p.r))
    /* شاخهٔ داخلی باید نقطهٔ واقعی R=0 را حفظ کند. حداقل‌کردن شعاع روی ۰٫۲mm
       یک پاره‌خط اضافه بین محور و ابتدای پرداخت داخل می‌ساخت و مسیر قرمز را از
       پروفایل آبی جدا نشان می‌داد. */
    .map((p) => ({ id: ++branchUid, z: Math.min(blankL, Math.max(0, p.z)), r: Math.min(blankR, Math.max(0, p.r)), smooth: false }));
}

export function branchPoints(branch: SPoint[], blankR: number, blankL: number, _keep: "max" | "min"): PPoint[] {
  const raw: SPoint[] = [];
  for (const p of branch) {
    if (!Number.isFinite(p.z) || !Number.isFinite(p.r)) continue;
    const clamped = { z: Math.min(blankL, Math.max(0, p.z)), r: Math.min(blankR, Math.max(0, p.r)) };
    const last = raw[raw.length - 1];
    if (!last || Math.hypot(clamped.z - last.z, clamped.r - last.r) > 1e-6) {
      raw.push(clamped);
    }
  }
  if (raw.length < 2) return [];
  if (raw[raw.length - 1].z < raw[0].z - 1e-6) raw.reverse();
  return raw.map((p) => ({ id: ++branchUid, z: p.z, r: p.r, smooth: false }));
}

/** اعتبارسنجی داده‌های ذخیره‌شده */
export function normalizeSketch(raw: unknown): SketchSeg[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const ok = (v: unknown): v is SPoint =>
    !!v && typeof (v as SPoint).z === "number" && typeof (v as SPoint).r === "number" &&
    Number.isFinite((v as SPoint).z) && Number.isFinite((v as SPoint).r);
  const out: SketchSeg[] = [];
  for (const s of raw as SketchSeg[]) {
    if (!s || !ok(s.a) || !ok(s.b)) continue;
    if (s.kind !== "line" && s.kind !== "quad" && s.kind !== "cubic" && s.kind !== "arc") continue;
    if (s.kind === "quad" && !ok(s.c1)) continue;
    if (s.kind === "cubic" && (!ok(s.c1) || !ok(s.c2))) continue;
    if (s.kind === "arc" && !ok(s.via)) continue;
    out.push({
      id: typeof s.id === "number" ? s.id : newSegId(),
      kind: s.kind,
      a: { z: s.a.z, r: s.a.r },
      b: { z: s.b.z, r: s.b.r },
      c1: s.c1 ? { z: s.c1.z, r: s.c1.r } : undefined,
      c2: s.c2 ? { z: s.c2.z, r: s.c2.r } : undefined,
      via: s.via ? { z: s.via.z, r: s.via.r } : undefined,
      polylineId: typeof s.polylineId === "number" && Number.isFinite(s.polylineId) ? s.polylineId : undefined,
      filletOf: Array.isArray(s.filletOf) && s.filletOf.length === 2 && s.filletOf.every(Number.isFinite)
        ? [s.filletOf[0], s.filletOf[1]]
        : undefined,
      arcDivisions: typeof s.arcDivisions === "number" && Number.isFinite(s.arcDivisions)
        ? Math.max(2, Math.min(500, Math.round(s.arcDivisions)))
        : undefined,
      independentA: typeof s.independentA === "boolean" ? s.independentA : undefined,
      independentB: typeof s.independentB === "boolean" ? s.independentB : undefined,
    });
  }
  for (const s of out) segUid = Math.max(segUid, s.id);
  return out.length ? out : null;
}
