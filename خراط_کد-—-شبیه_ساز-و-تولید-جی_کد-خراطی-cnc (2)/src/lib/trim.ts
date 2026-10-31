/* ------------------------------------------------------------------ */
/*  موتور Trim دقیق دوبعدی — تشخیص تقاطع، استخراج زیرالمان بدون خطا،    */
/*  حذف بخش‌های اضافی و اتصال پیوسته به یک Polyline واحد               */
/* ------------------------------------------------------------------ */

import {
  arcInfo,
  dist,
  evalSeg,
  newSegId,
  segLength,
  segPoints,
  type SPoint,
  type SketchSeg,
} from "./sketch";

const EPS_CLUSTER = 1e-4;
const EPS_END = 1e-4;
const EPS_DEGEN = 1e-5;

const mixPt = (a: SPoint, b: SPoint, t: number): SPoint => ({
  z: a.z + (b.z - a.z) * t,
  r: a.r + (b.r - a.r) * t,
});

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** مشتق اول منحنی نسبت به پارامتر t در بازه [0, 1] */
export function derivSeg(s: SketchSeg, t: number): SPoint {
  const { a, b } = s;
  if (s.kind === "line") return { z: b.z - a.z, r: b.r - a.r };
  if (s.kind === "quad" && s.c1) {
    const u = 1 - t;
    return {
      z: 2 * u * (s.c1.z - a.z) + 2 * t * (b.z - s.c1.z),
      r: 2 * u * (s.c1.r - a.r) + 2 * t * (b.r - s.c1.r),
    };
  }
  if (s.kind === "cubic" && s.c1 && s.c2) {
    const u = 1 - t;
    const w0 = 3 * u * u;
    const w1 = 6 * u * t;
    const w2 = 3 * t * t;
    return {
      z: w0 * (s.c1.z - a.z) + w1 * (s.c2.z - s.c1.z) + w2 * (b.z - s.c2.z),
      r: w0 * (s.c1.r - a.r) + w1 * (s.c2.r - s.c1.r) + w2 * (b.r - s.c2.r),
    };
  }
  if (s.kind === "arc") {
    const info = arcInfo(s);
    if (info) {
      const ang = info.a0 + info.sweep * t;
      return {
        z: -info.radius * info.sweep * Math.sin(ang),
        r: info.radius * info.sweep * Math.cos(ang),
      };
    }
  }
  return { z: b.z - a.z, r: b.r - a.r };
}

/** تبدیل زاویه روی دایره به پارامتر t روی کمان جهت‌دار؛ خارج از بازه = null */
function arcAngleParam(a0: number, sweep: number, ang: number, tolParam = 1e-7): number | null {
  if (Math.abs(sweep) < 1e-12) return null;
  const TAU = Math.PI * 2;
  const norm = (x: number) => ((x % TAU) + TAU) % TAU;
  let t: number;
  if (sweep > 0) {
    let diff = norm(ang - a0);
    if (diff > sweep && TAU - diff < Math.abs(sweep) * tolParam + 1e-7) diff = 0;
    t = diff / sweep;
  } else {
    let diff = norm(a0 - ang);
    const absSweep = -sweep;
    if (diff > absSweep && TAU - diff < absSweep * tolParam + 1e-7) diff = 0;
    t = diff / absSweep;
  }
  if (t < -tolParam || t > 1 + tolParam) return null;
  return clamp01(t);
}

/** نزدیک‌ترین پارامتر t و نقطهٔ متناظر روی المان با دقت بالا */
export function closestParamOnSeg(
  s: SketchSeg,
  p: SPoint
): { t: number; point: SPoint; d: number } {
  if (s.kind === "line") {
    const dz = s.b.z - s.a.z;
    const dr = s.b.r - s.a.r;
    const L2 = dz * dz + dr * dr;
    const t = L2 > 1e-16 ? clamp01(((p.z - s.a.z) * dz + (p.r - s.a.r) * dr) / L2) : 0;
    const pt = evalSeg(s, t);
    return { t, point: pt, d: dist(pt, p) };
  }
  if (s.kind === "arc") {
    const info = arcInfo(s);
    if (info) {
      let bestT = 0;
      let bestPt = s.a;
      let bestD = dist(s.a, p);
      const dB = dist(s.b, p);
      if (dB < bestD) {
        bestT = 1;
        bestPt = s.b;
        bestD = dB;
      }
      const ang = Math.atan2(p.r - info.center.r, p.z - info.center.z);
      const candT = arcAngleParam(info.a0, info.sweep, ang, 1e-7);
      if (candT != null) {
        const pt = evalSeg(s, candT);
        const d = dist(pt, p);
        if (d < bestD) {
          bestT = candT;
          bestPt = pt;
          bestD = d;
        }
      }
      return { t: bestT, point: bestPt, d: bestD };
    }
  }

  /* منحنی‌های بزیه درجه ۲ و ۳: نمونه‌برداری ریز + پالایش گوس-نیوتن */
  const N = 96;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const d = dist(evalSeg(s, t), p);
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }
  let t = bestT;
  for (let iter = 0; iter < 12; iter++) {
    const c = evalSeg(s, t);
    const dc = derivSeg(s, t);
    const denom = dc.z * dc.z + dc.r * dc.r;
    if (denom < 1e-18) break;
    const step = ((c.z - p.z) * dc.z + (c.r - p.r) * dc.r) / denom;
    const nextT = clamp01(t - step);
    const nextD = dist(evalSeg(s, nextT), p);
    if (nextD <= bestD + 1e-14) {
      t = nextT;
      bestD = nextD;
    } else {
      t = clamp01(t - 0.5 * step);
      bestD = dist(evalSeg(s, t), p);
    }
    if (Math.abs(step) < 1e-13) break;
  }
  const d0 = dist(s.a, p);
  const d1 = dist(s.b, p);
  if (d0 < bestD) {
    t = 0;
    bestD = d0;
  }
  if (d1 < bestD) {
    t = 1;
    bestD = d1;
  }
  const pt = evalSeg(s, t);
  return { t, point: pt, d: dist(pt, p) };
}

interface RawPairHit {
  tA: number;
  tB: number;
  point: SPoint;
}

/** پالایش نیوتن-رافسون دوبعدی برای تقاطع دقیق دو منحنی پارامتری */
function refineCurveIntersection(
  sA: SketchSeg,
  sB: SketchSeg,
  initTA: number,
  initTB: number
): RawPairHit | null {
  let tA = clamp01(initTA);
  let tB = clamp01(initTB);
  for (let iter = 0; iter < 16; iter++) {
    const pA = evalSeg(sA, tA);
    const pB = evalSeg(sB, tB);
    const fz = pA.z - pB.z;
    const fr = pA.r - pB.r;
    const err = Math.hypot(fz, fr);
    if (err < 1e-13) break;
    const dA = derivSeg(sA, tA);
    const dB = derivSeg(sB, tB);
    /* J = [ dA.z  -dB.z ; dA.r  -dB.r ] */
    const det = -dA.z * dB.r + dA.r * dB.z;
    if (Math.abs(det) > 1e-12) {
      const dtA = (-fz * -dB.r + fr * -dB.z) / det;
      const dtB = (dA.z * -fr - dA.r * -fz) / det;
      let stepScale = 1;
      let improved = false;
      for (let ls = 0; ls < 6; ls++) {
        const candA = clamp01(tA + dtA * stepScale);
        const candB = clamp01(tB + dtB * stepScale);
        const candErr = dist(evalSeg(sA, candA), evalSeg(sB, candB));
        if (candErr < err || ls === 5) {
          tA = candA;
          tB = candB;
          improved = candErr < err;
          break;
        }
        stepScale *= 0.5;
      }
      if (!improved && Math.abs(dtA) + Math.abs(dtB) < 1e-11) break;
    } else {
      /* مماس یا تقریباً موازی: تصویر متناوب روی هر دو منحنی */
      const cB = closestParamOnSeg(sB, pA);
      const cA = closestParamOnSeg(sA, cB.point);
      if (Math.abs(cA.t - tA) + Math.abs(cB.t - tB) < 1e-12) {
        tA = cA.t;
        tB = cB.t;
        break;
      }
      tA = cA.t;
      tB = cB.t;
    }
  }
  const pA = evalSeg(sA, tA);
  const pB = evalSeg(sB, tB);
  if (dist(pA, pB) > 1e-4) return null;
  return { tA, tB, point: mixPt(pA, pB, 0.5) };
}

function lineArcHits(line: SketchSeg, arc: SketchSeg): { tLine: number; tArc: number; point: SPoint }[] {
  const info = arcInfo(arc);
  if (!info) return [];
  const out: { tLine: number; tArc: number; point: SPoint }[] = [];
  const vx = line.b.z - line.a.z;
  const vy = line.b.r - line.a.r;
  const ox = line.a.z - info.center.z;
  const oy = line.a.r - info.center.r;
  const A = vx * vx + vy * vy;
  if (A < 1e-16) return out;
  const B = 2 * (ox * vx + oy * vy);
  const C = ox * ox + oy * oy - info.radius * info.radius;
  const disc = B * B - 4 * A * C;
  const tolDisc = 1e-8 * Math.max(1, info.radius * info.radius) * A;
  if (disc < -tolDisc) return out;
  const sqrtD = Math.sqrt(Math.max(0, disc));
  const roots = sqrtD < 1e-13 ? [-B / (2 * A)] : [(-B - sqrtD) / (2 * A), (-B + sqrtD) / (2 * A)];
  for (const rawT of roots) {
    if (rawT < -1e-6 || rawT > 1 + 1e-6) continue;
    const tLine = clamp01(rawT);
    const pt = evalSeg(line, tLine);
    const ang = Math.atan2(pt.r - info.center.r, pt.z - info.center.z);
    const tArc = arcAngleParam(info.a0, info.sweep, ang, 1e-6);
    if (tArc == null) continue;
    out.push({ tLine, tArc, point: pt });
  }
  return out;
}

function arcArcHits(sA: SketchSeg, sB: SketchSeg): RawPairHit[] {
  const iA = arcInfo(sA);
  const iB = arcInfo(sB);
  if (!iA || !iB) return [];
  const out: RawPairHit[] = [];
  const dz = iB.center.z - iA.center.z;
  const dr = iB.center.r - iA.center.r;
  const d = Math.hypot(dz, dr);
  const rA = iA.radius;
  const rB = iB.radius;
  if (d < 1e-10) return out; // هم‌مرکز (عبور نقطهٔ انتهایی جداگانه بررسی می‌شود)
  if (d > rA + rB + 1e-6 || d < Math.abs(rA - rB) - 1e-6) return out;
  const a = (rA * rA - rB * rB + d * d) / (2 * d);
  const h2 = rA * rA - a * a;
  if (h2 < -1e-6 * Math.max(1, rA * rA)) return out;
  const h = Math.sqrt(Math.max(0, h2));
  const mz = iA.center.z + (a * dz) / d;
  const mr = iA.center.r + (a * dr) / d;
  const pz = (-dr * h) / d;
  const pr = (dz * h) / d;
  const candidates: SPoint[] =
    h < 1e-12 ? [{ z: mz, r: mr }] : [{ z: mz + pz, r: mr + pr }, { z: mz - pz, r: mr - pr }];
  for (const pt of candidates) {
    const angA = Math.atan2(pt.r - iA.center.r, pt.z - iA.center.z);
    const angB = Math.atan2(pt.r - iB.center.r, pt.z - iB.center.z);
    const tA = arcAngleParam(iA.a0, iA.sweep, angA, 1e-6);
    const tB = arcAngleParam(iB.a0, iB.sweep, angB, 1e-6);
    if (tA != null && tB != null) out.push({ tA, tB, point: pt });
  }
  return out;
}

/** همهٔ تقاطع‌های دقیق و نقاط عبور انتهایی بین دو المان */
export function findPairIntersections(sA: SketchSeg, sB: SketchSeg): RawPairHit[] {
  if (sA.id === sB.id) return [];
  const raw: RawPairHit[] = [];

  const aIsLine = sA.kind === "line" || (sA.kind === "arc" && !arcInfo(sA));
  const bIsLine = sB.kind === "line" || (sB.kind === "arc" && !arcInfo(sB));
  const aIsArc = sA.kind === "arc" && !aIsLine;
  const bIsArc = sB.kind === "arc" && !bIsLine;

  if (aIsLine && bIsLine) {
    const d = (sA.b.z - sA.a.z) * (sB.b.r - sB.a.r) - (sA.b.r - sA.a.r) * (sB.b.z - sB.a.z);
    if (Math.abs(d) > 1e-12) {
      const qz = sB.a.z - sA.a.z;
      const qr = sB.a.r - sA.a.r;
      const tA = (qz * (sB.b.r - sB.a.r) - qr * (sB.b.z - sB.a.z)) / d;
      const tB = (qz * (sA.b.r - sA.a.r) - qr * (sA.b.z - sA.a.z)) / d;
      if (tA >= -1e-6 && tA <= 1 + 1e-6 && tB >= -1e-6 && tB <= 1 + 1e-6) {
        const cA = clamp01(tA);
        const cB = clamp01(tB);
        raw.push({ tA: cA, tB: cB, point: evalSeg(sA, cA) });
      }
    }
  } else if (aIsLine && bIsArc) {
    for (const h of lineArcHits(sA, sB)) raw.push({ tA: h.tLine, tB: h.tArc, point: h.point });
  } else if (aIsArc && bIsLine) {
    for (const h of lineArcHits(sB, sA)) raw.push({ tA: h.tArc, tB: h.tLine, point: h.point });
  } else if (aIsArc && bIsArc) {
    raw.push(...arcArcHits(sA, sB));
  } else {
    /* حداقل یکی از دو المان بزیه درجه ۲ یا ۳ است */
    const NA = sA.kind === "line" ? 1 : 128;
    const NB = sB.kind === "line" ? 1 : 128;
    const polyA = segPoints(sA, NA);
    const polyB = segPoints(sB, NB);
    const seeds: [number, number][] = [];
    for (let i = 0; i < polyA.length - 1; i++) {
      const a0 = polyA[i];
      const a1 = polyA[i + 1];
      const minZA = Math.min(a0.z, a1.z) - 1e-3;
      const maxZA = Math.max(a0.z, a1.z) + 1e-3;
      const minRA = Math.min(a0.r, a1.r) - 1e-3;
      const maxRA = Math.max(a0.r, a1.r) + 1e-3;
      for (let j = 0; j < polyB.length - 1; j++) {
        const b0 = polyB[j];
        const b1 = polyB[j + 1];
        if (
          Math.max(b0.z, b1.z) < minZA ||
          Math.min(b0.z, b1.z) > maxZA ||
          Math.max(b0.r, b1.r) < minRA ||
          Math.min(b0.r, b1.r) > maxRA
        ) {
          continue;
        }
        const denom = (a1.z - a0.z) * (b1.r - b0.r) - (a1.r - a0.r) * (b1.z - b0.z);
        if (Math.abs(denom) > 1e-14) {
          const u = ((b0.z - a0.z) * (b1.r - b0.r) - (b0.r - a0.r) * (b1.z - b0.z)) / denom;
          const v = ((b0.z - a0.z) * (a1.r - a0.r) - (b0.r - a0.r) * (a1.z - a0.z)) / denom;
          if (u >= -0.05 && u <= 1.05 && v >= -0.05 && v <= 1.05) {
            seeds.push([(i + clamp01(u)) / NA, (j + clamp01(v)) / NB]);
            continue;
          }
        }
        if (dist(a0, b0) < 5e-3) seeds.push([i / NA, j / NB]);
      }
    }
    for (const [sTA, sTB] of seeds) {
      const refined = refineCurveIntersection(sA, sB, sTA, sTB);
      if (refined) raw.push(refined);
    }
  }

  /* بررسی صریح عبور یک خط/منحنی از روی نقطهٔ انتهایی یا اتصال هندسی المان دیگر */
  for (const [tEnd, ptEnd] of [
    [0, sA.a],
    [1, sA.b],
  ] as [number, SPoint][]) {
    const proj = closestParamOnSeg(sB, ptEnd);
    if (proj.d <= EPS_END) {
      raw.push({ tA: tEnd, tB: proj.t, point: { z: ptEnd.z, r: ptEnd.r } });
    }
  }
  for (const [tEnd, ptEnd] of [
    [0, sB.a],
    [1, sB.b],
  ] as [number, SPoint][]) {
    const proj = closestParamOnSeg(sA, ptEnd);
    if (proj.d <= EPS_END) {
      raw.push({ tA: proj.t, tB: tEnd, point: { z: ptEnd.z, r: ptEnd.r } });
    }
  }

  /* ادغام نقاط هم‌مکان و ترجیح مختصات دقیق نقاط انتهایی موجود */
  const dedup: RawPairHit[] = [];
  for (const item of raw) {
    let exactPt = item.point;
    let tA = item.tA;
    let tB = item.tB;
    if (dist(exactPt, sA.a) <= EPS_END) {
      tA = 0;
      exactPt = { z: sA.a.z, r: sA.a.r };
    } else if (dist(exactPt, sA.b) <= EPS_END) {
      tA = 1;
      exactPt = { z: sA.b.z, r: sA.b.r };
    }
    if (dist(exactPt, sB.a) <= EPS_END) {
      tB = 0;
      exactPt = { z: sB.a.z, r: sB.a.r };
    } else if (dist(exactPt, sB.b) <= EPS_END) {
      tB = 1;
      exactPt = { z: sB.b.z, r: sB.b.r };
    }
    const existing = dedup.find((d) => dist(d.point, exactPt) <= EPS_CLUSTER);
    if (!existing) {
      dedup.push({ tA, tB, point: exactPt });
    } else if (tA === 0 || tA === 1 || tB === 0 || tB === 1) {
      existing.tA = tA;
      existing.tB = tB;
      existing.point = exactPt;
    }
  }
  return dedup;
}

/** استخراج دقیق زیرالمان در بازه [t0, t1] بدون هیچ شکاف یا انحراف هندسی */
export function extractSubSegment(
  s: SketchSeg,
  t0: number,
  t1: number,
  p0: SPoint,
  p1: SPoint,
  idOverride?: number
): SketchSeg {
  const id = idOverride ?? s.id;
  const a = { z: p0.z, r: p0.r };
  const b = { z: p1.z, r: p1.r };
  if (t0 <= 1e-12 && t1 >= 1 - 1e-12) {
    return {
      ...s,
      id,
      a,
      b,
      c1: s.c1 ? { ...s.c1 } : undefined,
      c2: s.c2 ? { ...s.c2 } : undefined,
      via: s.via ? { ...s.via } : undefined,
      filletOf: s.filletOf ? [...s.filletOf] : undefined,
    };
  }
  if (s.kind === "quad" && s.c1) {
    /* دو گام دقیق De Casteljau روی بازه [t0, t1] */
    const u1 = Math.max(1e-12, t1);
    const q1 = mixPt(s.a, s.c1, u1);
    const q2 = evalSeg(s, u1);
    const u0 = clamp01(t0 / u1);
    const c1 = mixPt(q1, q2, u0);
    return {
      id,
      kind: "quad",
      a,
      b,
      c1,
      polylineId: s.polylineId,
    };
  }
  if (s.kind === "cubic" && s.c1 && s.c2) {
    /* دو گام دقیق De Casteljau برای منحنی بزیه درجه ۳ */
    const u1 = Math.max(1e-12, t1);
    const p01 = mixPt(s.a, s.c1, u1);
    const p12 = mixPt(s.c1, s.c2, u1);
    const p23 = mixPt(s.c2, s.b, u1);
    const p012 = mixPt(p01, p12, u1);
    const p123 = mixPt(p12, p23, u1);
    const p0123 = mixPt(p012, p123, u1);

    const u0 = clamp01(t0 / u1);
    const r12 = mixPt(p01, p012, u0);
    const r23 = mixPt(p012, p0123, u0);
    const r123 = mixPt(r12, r23, u0);
    return {
      id,
      kind: "cubic",
      a,
      b,
      c1: r123,
      c2: r23,
      polylineId: s.polylineId,
      independentA: t0 <= 1e-9 ? s.independentA : true,
      independentB: t1 >= 1 - 1e-9 ? s.independentB : true,
    };
  }
  if (s.kind === "arc" && arcInfo(s)) {
    const mid = evalSeg(s, 0.5 * (t0 + t1));
    const span = Math.max(0.02, t1 - t0);
    return {
      id,
      kind: "arc",
      a,
      b,
      via: mid,
      polylineId: s.polylineId,
      arcDivisions:
        s.arcDivisions != null ? Math.max(2, Math.round(s.arcDivisions * span)) : undefined,
    };
  }
  /* برای خط مستقیم (و کمانِ هم‌خط) حتی راستا نیز دقیقاً در p0 و p1 بسته می‌شود */
  return {
    id,
    kind: "line",
    a,
    b,
    polylineId: s.polylineId,
  };
}

/** معکوس‌کردن جهت پارامتری المان بدون تغییر هندسهٔ منحنی */
export function reverseSketchSeg(s: SketchSeg): SketchSeg {
  if (s.kind === "cubic") {
    return {
      ...s,
      a: { ...s.b },
      b: { ...s.a },
      c1: s.c2 ? { ...s.c2 } : undefined,
      c2: s.c1 ? { ...s.c1 } : undefined,
      independentA: s.independentB,
      independentB: s.independentA,
    };
  }
  return {
    ...s,
    a: { ...s.b },
    b: { ...s.a },
    c1: s.c1 ? { ...s.c1 } : undefined,
    via: s.via ? { ...s.via } : undefined,
  };
}

export interface TrimCutNode {
  id: number;
  point: SPoint;
  incidences: { segId: number; t: number; isEndpoint: boolean }[];
}

export interface TrimSubSeg {
  key: string;
  segId: number;
  index: number;
  totalOnSeg: number;
  t0: number;
  t1: number;
  p0: SPoint;
  p1: SPoint;
  geom: SketchSeg;
  cutNodePoints: SPoint[];
  trimmable: boolean;
}

export interface TrimGraph {
  activeNodes: TrimCutNode[];
  subSegsBySeg: Map<number, TrimSubSeg[]>;
  trimmableSubSegs: TrimSubSeg[];
  subSegByKey: Map<string, TrimSubSeg>;
}

function hasJoinedPolylinePairAt(
  pt: SPoint,
  segs: SketchSeg[],
  separated?: ReadonlySet<string>
): boolean {
  const counts = new Map<number, number>();
  for (const s of segs) {
    if (s.polylineId == null) continue;
    const hitA = !separated?.has(`${s.id}:a`) && dist(s.a, pt) <= EPS_END;
    const hitB = !separated?.has(`${s.id}:b`) && dist(s.b, pt) <= EPS_END;
    if (hitA || hitB) {
      const next = (counts.get(s.polylineId) ?? 0) + 1;
      if (next >= 2) return true;
      counts.set(s.polylineId, next);
    }
  }
  return false;
}

/** ساخت گراف تقاطع‌ها و زیرالمان‌های قابل‌برش برای ابزار Trim */
export function computeTrimGraph(
  segs: SketchSeg[],
  separated?: ReadonlySet<string>
): TrimGraph {
  const clusters: { point: SPoint; lockedToEndpoint: boolean }[] = [];

  const registerClusterPoint = (pt: SPoint, isExistingEndpoint: boolean) => {
    const found = clusters.find((c) => dist(c.point, pt) <= EPS_CLUSTER);
    if (!found) {
      clusters.push({ point: { z: pt.z, r: pt.r }, lockedToEndpoint: isExistingEndpoint });
    } else if (isExistingEndpoint && !found.lockedToEndpoint) {
      found.point = { z: pt.z, r: pt.r };
      found.lockedToEndpoint = true;
    }
  };

  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const hits = findPairIntersections(segs[i], segs[j]);
      for (const h of hits) {
        const isEnd =
          dist(h.point, segs[i].a) <= EPS_END ||
          dist(h.point, segs[i].b) <= EPS_END ||
          dist(h.point, segs[j].a) <= EPS_END ||
          dist(h.point, segs[j].b) <= EPS_END;
        registerClusterPoint(h.point, isEnd);
      }
    }
  }

  /* اگر نقطهٔ انتهاییِ موجودی روی یکی از خوشه‌ها افتاده، مختصات خوشه دقیقاً به آن قفل شود */
  for (const c of clusters) {
    if (c.lockedToEndpoint) continue;
    for (const s of segs) {
      if (dist(s.a, c.point) <= EPS_END) {
        c.point = { z: s.a.z, r: s.a.r };
        c.lockedToEndpoint = true;
        break;
      }
      if (dist(s.b, c.point) <= EPS_END) {
        c.point = { z: s.b.z, r: s.b.r };
        c.lockedToEndpoint = true;
        break;
      }
    }
  }

  const activeNodes: TrimCutNode[] = [];
  let nextNodeId = 1;

  for (const c of clusters) {
    /* اگر در این نقطه قبلاً دو ضلع یک Polyline واحد تشکیل داده‌اند، طبق قانون ۳+ خط،
       این گره اشباع شده است و سایر خطوط عبوری مستقل و بدون تغییر باقی می‌مانند. */
    if (hasJoinedPolylinePairAt(c.point, segs, separated)) continue;

    const incidences: { segId: number; t: number; isEndpoint: boolean }[] = [];
    let totalBranches = 0;
    for (const s of segs) {
      const dA = dist(s.a, c.point);
      const dB = dist(s.b, c.point);
      if (dA <= EPS_END) {
        incidences.push({ segId: s.id, t: 0, isEndpoint: true });
        totalBranches += 1;
        continue;
      }
      if (dB <= EPS_END) {
        incidences.push({ segId: s.id, t: 1, isEndpoint: true });
        totalBranches += 1;
        continue;
      }
      const proj = closestParamOnSeg(s, c.point);
      if (proj.d <= EPS_END) {
        const isEnd = proj.t <= 1e-6 || proj.t >= 1 - 1e-6;
        const t = proj.t <= 1e-6 ? 0 : proj.t >= 1 - 1e-6 ? 1 : proj.t;
        incidences.push({ segId: s.id, t, isEndpoint: isEnd });
        totalBranches += isEnd ? 1 : 2;
      }
    }

    if (incidences.length >= 2 && totalBranches >= 3) {
      activeNodes.push({
        id: nextNodeId++,
        point: c.point,
        incidences,
      });
    }
  }

  /* نگاشت گره‌های فعال به هر المان و ساخت زیرالمان‌ها */
  const cutsBySeg = new Map<number, { t: number; point: SPoint; isEndpoint: boolean }[]>();
  for (const node of activeNodes) {
    for (const inc of node.incidences) {
      const list = cutsBySeg.get(inc.segId) ?? [];
      list.push({ t: inc.t, point: node.point, isEndpoint: inc.isEndpoint });
      cutsBySeg.set(inc.segId, list);
    }
  }

  const subSegsBySeg = new Map<number, TrimSubSeg[]>();
  const trimmableSubSegs: TrimSubSeg[] = [];
  const subSegByKey = new Map<string, TrimSubSeg>();

  for (const s of segs) {
    const cuts = cutsBySeg.get(s.id) ?? [];
    if (cuts.length === 0) {
      const key = `${s.id}:0`;
      const whole: TrimSubSeg = {
        key,
        segId: s.id,
        index: 0,
        totalOnSeg: 1,
        t0: 0,
        t1: 1,
        p0: { ...s.a },
        p1: { ...s.b },
        geom: s,
        cutNodePoints: [],
        trimmable: false,
      };
      subSegsBySeg.set(s.id, [whole]);
      subSegByKey.set(key, whole);
      continue;
    }

    const interiorCuts = cuts
      .filter((c) => c.t > 1e-6 && c.t < 1 - 1e-6)
      .sort((a, b) => a.t - b.t);
    const startCut = cuts.find((c) => c.t <= 1e-6);
    const endCut = cuts.find((c) => c.t >= 1 - 1e-6);

    const stops: { t: number; point: SPoint; isCut: boolean }[] = [
      { t: 0, point: startCut ? startCut.point : s.a, isCut: !!startCut },
      ...interiorCuts.map((c) => ({ t: c.t, point: c.point, isCut: true })),
      { t: 1, point: endCut ? endCut.point : s.b, isCut: !!endCut },
    ];

    const rawParts: Omit<TrimSubSeg, "key" | "index" | "totalOnSeg">[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const st0 = stops[i];
      const st1 = stops[i + 1];
      if (st1.t - st0.t <= 1e-7) continue;
      const geom = extractSubSegment(s, st0.t, st1.t, st0.point, st1.point, s.id);
      if (segLength(geom) <= EPS_DEGEN) continue;
      const cutNodePoints: SPoint[] = [];
      if (st0.isCut) cutNodePoints.push({ ...st0.point });
      if (st1.isCut) cutNodePoints.push({ ...st1.point });
      rawParts.push({
        segId: s.id,
        t0: st0.t,
        t1: st1.t,
        p0: { ...st0.point },
        p1: { ...st1.point },
        geom,
        cutNodePoints,
        trimmable: cutNodePoints.length > 0,
      });
    }

    const built: TrimSubSeg[] = rawParts.map((part, idx) => {
      const key = `${s.id}:${idx}`;
      return {
        ...part,
        key,
        index: idx,
        totalOnSeg: rawParts.length,
      };
    });
    subSegsBySeg.set(s.id, built);
    for (const sub of built) {
      subSegByKey.set(sub.key, sub);
      if (sub.trimmable) trimmableSubSegs.push(sub);
    }
  }

  return { activeNodes, subSegsBySeg, trimmableSubSegs, subSegByKey };
}

/** مرتب‌سازی و یکنواخت‌سازی همهٔ Polylineها تا اعضا متوالی و هم‌جهت (b === a بعدی) باشند */
export function normalizePolylineGroups(segs: SketchSeg[]): SketchSeg[] {
  const byGroup = new Map<number, SketchSeg[]>();
  for (const s of segs) {
    if (s.polylineId != null) {
      const list = byGroup.get(s.polylineId) ?? [];
      list.push(s);
      byGroup.set(s.polylineId, list);
    }
  }
  if (byGroup.size === 0) return segs;

  const normalizedGroupChains = new Map<number, SketchSeg[]>();

  for (const [groupId, members] of byGroup.entries()) {
    if (members.length < 2) {
      normalizedGroupChains.set(
        groupId,
        members.map((m) => ({ ...m, polylineId: undefined }))
      );
      continue;
    }

    /* گراف مجاورت اعضای گروه بر اساس تطابق رئوس */
    const unused = new Set<number>(members.map((m) => m.id));
    const orderedAll: SketchSeg[] = [];

    while (unused.size > 0) {
      /* انتخاب نقطهٔ شروع آزاد (درجه ۱ در میان اعضای باقی‌مانده) برای زنجیرهٔ باز، یا اولین عضو برای حلقهٔ بسته */
      const remMembers = members.filter((m) => unused.has(m.id));
      const degOfPt = (pt: SPoint) => {
        let count = 0;
        for (const m of remMembers) {
          if (dist(m.a, pt) <= EPS_END) count++;
          if (dist(m.b, pt) <= EPS_END) count++;
        }
        return count;
      };

      let seed = remMembers[0];
      let seedReversed = false;
      for (const m of remMembers) {
        const dA = degOfPt(m.a);
        const dB = degOfPt(m.b);
        if (dA === 1 && dB >= 1) {
          seed = m;
          seedReversed = false;
          break;
        }
        if (dB === 1 && dA >= 1) {
          seed = m;
          seedReversed = true;
          break;
        }
      }

      unused.delete(seed.id);
      const chain: SketchSeg[] = [seedReversed ? reverseSketchSeg(seed) : { ...seed }];

      /* گسترش رو به جلو */
      while (unused.size > 0) {
        const tail = chain[chain.length - 1].b;
        let nextSeg: SketchSeg | null = null;
        let rev = false;
        for (const cand of members) {
          if (!unused.has(cand.id)) continue;
          if (dist(cand.a, tail) <= EPS_END) {
            nextSeg = cand;
            rev = false;
            break;
          }
          if (dist(cand.b, tail) <= EPS_END) {
            nextSeg = cand;
            rev = true;
            break;
          }
        }
        if (!nextSeg) break;
        unused.delete(nextSeg.id);
        const oriented = rev ? reverseSketchSeg(nextSeg) : { ...nextSeg };
        oriented.a = { ...tail };
        chain.push(oriented);
      }

      /* گسترش رو به عقب (در صورت وجود شاخه از سمت ابتدا) */
      while (unused.size > 0) {
        const head = chain[0].a;
        let prevSeg: SketchSeg | null = null;
        let rev = false;
        for (const cand of members) {
          if (!unused.has(cand.id)) continue;
          if (dist(cand.b, head) <= EPS_END) {
            prevSeg = cand;
            rev = false;
            break;
          }
          if (dist(cand.a, head) <= EPS_END) {
            prevSeg = cand;
            rev = true;
            break;
          }
        }
        if (!prevSeg) break;
        unused.delete(prevSeg.id);
        const oriented = rev ? reverseSketchSeg(prevSeg) : { ...prevSeg };
        oriented.b = { ...head };
        chain.unshift(oriented);
      }

      if (chain.length >= 2 && dist(chain[chain.length - 1].b, chain[0].a) <= EPS_END) {
        chain[chain.length - 1] = {
          ...chain[chain.length - 1],
          b: { ...chain[0].a },
        };
      }

      const subGroupId =
        chain.length < 2
          ? undefined
          : orderedAll.length === 0
            ? groupId
            : chain[0].id;
      for (const item of chain) {
        orderedAll.push({ ...item, polylineId: subGroupId });
      }
    }

    normalizedGroupChains.set(groupId, orderedAll);
  }

  /* جایگذاری هر گروه مرتب‌شده در محل اولین عضو آن گروه در آرایهٔ segs */
  const emittedGroups = new Set<number>();
  const out: SketchSeg[] = [];
  for (const s of segs) {
    if (s.polylineId == null) {
      out.push(s);
      continue;
    }
    if (emittedGroups.has(s.polylineId)) continue;
    emittedGroups.add(s.polylineId);
    const chain = normalizedGroupChains.get(s.polylineId) ?? [s];
    out.push(...chain);
  }
  return out;
}

export interface TrimExecutionResult {
  segs: SketchSeg[];
  changed: boolean;
  /** کلیدهای handle که در نقطهٔ اتصال جدید باید از مجموعهٔ separated پاک شوند */
  joinedHandles: string[];
  /** شناسهٔ Polylineهای ساخته‌شده یا به‌روزشده */
  joinedPolylineIds: number[];
}

/** اتصال دو المان باقی‌مانده در نقاط برش به یک Polyline واحد و پیوسته */
function joinRemainingAtCutPoints(
  segs: SketchSeg[],
  cutPoints: SPoint[],
  separated?: ReadonlySet<string>
): { segs: SketchSeg[]; joinedHandles: string[]; joinedPolylineIds: number[] } {
  let cur = segs.map((s) => ({ ...s }));
  const joinedHandles: string[] = [];
  const joinedPolys = new Set<number>();
  let nextPolySeed = Math.max(0, ...cur.map((s) => Math.max(s.id, s.polylineId ?? 0))) + 1;

  for (const cp of cutPoints) {
    const endpointHits: { segIndex: number; part: "a" | "b" }[] = [];
    for (let i = 0; i < cur.length; i++) {
      const s = cur[i];
      if (!separated?.has(`${s.id}:a`) && dist(s.a, cp) <= EPS_END) {
        endpointHits.push({ segIndex: i, part: "a" });
      } else if (!separated?.has(`${s.id}:b`) && dist(s.b, cp) <= EPS_END) {
        endpointHits.push({ segIndex: i, part: "b" });
      }
    }

    /* دقیقاً دو شاخه در نقطهٔ تقاطع باقی مانده‌اند -> تبدیل/ادغام در یک Polyline واحد */
    if (endpointHits.length === 2) {
      const h1 = endpointHits[0];
      const h2 = endpointHits[1];
      const s1 = cur[h1.segIndex];
      const s2 = cur[h2.segIndex];
      if (s1.id === s2.id) continue;

      const exact = { z: cp.z, r: cp.r };
      cur[h1.segIndex] = { ...s1, [h1.part]: { ...exact } };
      cur[h2.segIndex] = { ...s2, [h2.part]: { ...exact } };

      const g1 = cur[h1.segIndex].polylineId;
      const g2 = cur[h2.segIndex].polylineId;
      const targetGroup = g1 ?? g2 ?? (cur[h1.segIndex].id || nextPolySeed++);

      cur = cur.map((seg, idx) => {
        if (
          idx === h1.segIndex ||
          idx === h2.segIndex ||
          (g1 != null && seg.polylineId === g1) ||
          (g2 != null && seg.polylineId === g2)
        ) {
          return { ...seg, polylineId: targetGroup };
        }
        return seg;
      });

      joinedHandles.push(`${s1.id}:a`, `${s1.id}:b`, `${s2.id}:a`, `${s2.id}:b`);
      joinedPolys.add(targetGroup);
    }
  }

  const normalized = normalizePolylineGroups(cur);
  const finalPolys = [...new Set(normalized.map((s) => s.polylineId).filter((x): x is number => x != null && joinedPolys.has(x)))];
  return { segs: normalized, joinedHandles, joinedPolylineIds: finalPolys };
}

/** اجرای Trim روی یک زیرالمان مشخص (کلیک ماوس) */
export function applyTrimSubSegment(
  segs: SketchSeg[],
  subKey: string,
  separated?: ReadonlySet<string>
): TrimExecutionResult {
  const graph = computeTrimGraph(segs, separated);
  const target = graph.subSegByKey.get(subKey);
  if (!target || !target.trimmable) {
    return { segs, changed: false, joinedHandles: [], joinedPolylineIds: [] };
  }

  const parent = segs.find((s) => s.id === target.segId);
  if (!parent) {
    return { segs, changed: false, joinedHandles: [], joinedPolylineIds: [] };
  }

  const siblings = graph.subSegsBySeg.get(parent.id) ?? [];
  const keptSubs = siblings.filter((sub) => sub.key !== target.key);

  /* ادغام بازه‌های مجاور باقی‌مانده روی المان والد تا هیچ شکست هندسی اضافه‌ای ایجاد نشود */
  const mergedIntervals: { t0: number; t1: number; p0: SPoint; p1: SPoint }[] = [];
  for (const sub of keptSubs) {
    const prev = mergedIntervals[mergedIntervals.length - 1];
    if (prev && Math.abs(sub.t0 - prev.t1) <= 1e-6) {
      prev.t1 = sub.t1;
      prev.p1 = { ...sub.p1 };
    } else {
      mergedIntervals.push({
        t0: sub.t0,
        t1: sub.t1,
        p0: { ...sub.p0 },
        p1: { ...sub.p1 },
      });
    }
  }

  const replacements: SketchSeg[] = mergedIntervals
    .map((iv, idx) =>
      extractSubSegment(parent, iv.t0, iv.t1, iv.p0, iv.p1, idx === 0 ? parent.id : newSegId())
    )
    .filter((piece) => segLength(piece) > EPS_DEGEN);

  let nextSegs = segs.flatMap((s) => (s.id === parent.id ? replacements : [s]));

  /* اگر بخش میانی یک ضلع از Polyline حذف شد و دو تکه بجا ماند، زنجیرهٔ چپ و راست از هم تفکیک شوند */
  if (parent.polylineId != null && replacements.length === 2) {
    const members = segs.filter((s) => s.polylineId === parent.polylineId);
    const idx = members.findIndex((s) => s.id === parent.id);
    const leftSet = new Set([...members.slice(0, idx).map((s) => s.id), replacements[0].id]);
    const rightSet = new Set([replacements[1].id, ...members.slice(idx + 1).map((s) => s.id)]);
    const leftGroup = leftSet.size > 1 ? replacements[0].id : undefined;
    const rightGroup = rightSet.size > 1 ? replacements[1].id : undefined;
    nextSegs = nextSegs.map((s) => {
      if (leftSet.has(s.id)) return { ...s, polylineId: leftGroup };
      if (rightSet.has(s.id)) return { ...s, polylineId: rightGroup };
      return s;
    });
  } else if (parent.polylineId != null && replacements.length === 0) {
    nextSegs = normalizePolylineGroups(nextSegs);
  }

  const joined = joinRemainingAtCutPoints(nextSegs, target.cutNodePoints, separated);
  return {
    segs: joined.segs,
    changed: true,
    joinedHandles: joined.joinedHandles,
    joinedPolylineIds: joined.joinedPolylineIds,
  };
}

/** آزمون برخورد زیرالمان با کادر انتخاب (مشابه رفتار Window / Crossing در ابزار Select) */
export function trimSubSegHitsRect(
  sub: TrimSubSeg,
  rectW: { z0: number; z1: number; r0: number; r1: number },
  mode: "window" | "crossing"
): boolean {
  const pointInRectW = (p: SPoint) =>
    p.z >= rectW.z0 - 1e-9 &&
    p.z <= rectW.z1 + 1e-9 &&
    p.r >= rectW.r0 - 1e-9 &&
    p.r <= rectW.r1 + 1e-9;

  const poly = sub.geom.kind === "line" ? [sub.geom.a, sub.geom.b] : segPoints(sub.geom, 48);
  if (mode === "window") {
    return poly.every(pointInRectW);
  }

  /* در حالت متقاطع (Crossing)، برای جلوگیری از انتخاب ناخواستهٔ شاخهٔ مجاور صرفاً به دلیل
     تماس مرزی روی خود نقطهٔ تقاطع، نقاط انتهاییِ منطبق بر گرهٔ برش اندکی به داخل شاخه مقیاس می‌شوند. */
  const cutAtStart = sub.cutNodePoints.some((cp) => dist(cp, sub.p0) <= EPS_END);
  const cutAtEnd = sub.cutNodePoints.some((cp) => dist(cp, sub.p1) <= EPS_END);
  const testPoly = poly.map((pt, idx) => {
    if (idx === 0 && cutAtStart && poly.length >= 2) return mixPt(poly[0], poly[1], 1e-4);
    if (idx === poly.length - 1 && cutAtEnd && poly.length >= 2) {
      return mixPt(poly[poly.length - 1], poly[poly.length - 2], 1e-4);
    }
    return pt;
  });

  if (testPoly.some(pointInRectW)) return true;

  const corners: SPoint[] = [
    { z: rectW.z0, r: rectW.r0 },
    { z: rectW.z1, r: rectW.r0 },
    { z: rectW.z1, r: rectW.r1 },
    { z: rectW.z0, r: rectW.r1 },
  ];
  const segSegInt = (p1: SPoint, p2: SPoint, p3: SPoint, p4: SPoint) => {
    const d = (p2.z - p1.z) * (p4.r - p3.r) - (p2.r - p1.r) * (p4.z - p3.z);
    if (Math.abs(d) < 1e-12) return false;
    const t = ((p3.z - p1.z) * (p4.r - p3.r) - (p3.r - p1.r) * (p4.z - p3.z)) / d;
    const u = ((p3.z - p1.z) * (p2.r - p1.r) - (p3.r - p1.r) * (p2.z - p1.z)) / d;
    return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9;
  };
  for (let i = 0; i < testPoly.length - 1; i++) {
    for (let k = 0; k < 4; k++) {
      if (segSegInt(testPoly[i], testPoly[i + 1], corners[k], corners[(k + 1) % 4])) {
        return true;
      }
    }
  }
  return false;
}

/**
 * اجرای Trim برای کادر انتخاب (Selection Box) با رعایت دقیق ترتیب اولویت انتخاب:
 * - اگر تمام بخش‌های یک خط متقاطع داخل کادر افتاده باشند، بخش اصلی/متصل نگه داشته شده و فقط بخش‌های اضافی حذف می‌شوند.
 * - در گره‌های با ۳ خط یا بیشتر، فقط دو خط اول در ترتیب انتخاب مشمول برش و تبدیل به Polyline می‌شوند.
 */
export function applyTrimSelectionBox(
  segs: SketchSeg[],
  orderedSubKeys: string[],
  separated?: ReadonlySet<string>
): TrimExecutionResult {
  const initialGraph = computeTrimGraph(segs, separated);
  const selectedSubs = orderedSubKeys
    .map((k) => initialGraph.subSegByKey.get(k))
    .filter((s): s is TrimSubSeg => !!s && s.trimmable);

  if (selectedSubs.length === 0) {
    return { segs, changed: false, joinedHandles: [], joinedPolylineIds: [] };
  }

  /* اگر همهٔ زیرالمان‌های یک خط متقاطع داخل کادر انتخاب قرار گرفته‌اند، بخش اصلی حفظ شود
     تا به جای حذف کامل خط، دنبالهٔ اضافی بریده شده و بخش باقی‌مانده به خط مقابل وصل شود. */
  const hitCountBySeg = new Map<number, TrimSubSeg[]>();
  for (const sub of selectedSubs) {
    const list = hitCountBySeg.get(sub.segId) ?? [];
    list.push(sub);
    hitCountBySeg.set(sub.segId, list);
  }

  const protectedKeys = new Set<string>();
  for (const [segId, hits] of hitCountBySeg.entries()) {
    const allSubs = initialGraph.subSegsBySeg.get(segId) ?? [];
    if (allSubs.length >= 2 && hits.length >= allSubs.length) {
      const parent = segs.find((s) => s.id === segId)!;
      const isConnectedOuterEnd = (sub: TrimSubSeg): boolean => {
        if (sub.t0 <= 1e-6 && !sub.cutNodePoints.some((cp) => dist(cp, parent.a) <= EPS_END)) {
          return segs.some(
            (o) => o.id !== segId && (dist(o.a, parent.a) <= EPS_END || dist(o.b, parent.a) <= EPS_END)
          );
        }
        if (sub.t1 >= 1 - 1e-6 && !sub.cutNodePoints.some((cp) => dist(cp, parent.b) <= EPS_END)) {
          return segs.some(
            (o) => o.id !== segId && (dist(o.a, parent.b) <= EPS_END || dist(o.b, parent.b) <= EPS_END)
          );
        }
        return false;
      };
      const sortedToKeep = [...allSubs].sort((a, b) => {
        const ca = isConnectedOuterEnd(a) ? 1 : 0;
        const cb = isConnectedOuterEnd(b) ? 1 : 0;
        if (cb !== ca) return cb - ca;
        return segLength(b.geom) - segLength(a.geom);
      });
      protectedKeys.add(sortedToKeep[0].key);
    }
  }

  const queue = selectedSubs.filter((sub) => !protectedKeys.has(sub.key));
  let curSegs = segs;
  const curSeparated = new Set(separated ?? []);
  let anyChanged = false;
  const allJoinedHandles: string[] = [];
  const allJoinedPolys = new Set<number>();

  for (const item of queue) {
    const stepGraph = computeTrimGraph(curSegs, curSeparated);
    /* بررسی اینکه حداقل یکی از گره‌های برش این زیرالمان هنوز اشباع نشده باشد (قانون ۳+ خط) */
    const activeCutPoints = item.cutNodePoints.filter((cp) =>
      stepGraph.activeNodes.some((node) => dist(node.point, cp) <= EPS_CLUSTER)
    );
    if (activeCutPoints.length === 0) continue;

    const midPt = evalSeg(item.geom, 0.5);
    let bestMatch: TrimSubSeg | null = null;
    let bestDist = Infinity;
    for (const cand of stepGraph.trimmableSubSegs) {
      const sameEnds =
        (dist(cand.p0, item.p0) <= EPS_CLUSTER && dist(cand.p1, item.p1) <= EPS_CLUSTER) ||
        (dist(cand.p0, item.p1) <= EPS_CLUSTER && dist(cand.p1, item.p0) <= EPS_CLUSTER);
      if (!sameEnds) continue;
      const midDist = dist(evalSeg(cand.geom, 0.5), midPt);
      if (midDist > EPS_CLUSTER) continue;
      const sharesActiveCut = cand.cutNodePoints.some((cp) =>
        activeCutPoints.some((acp) => dist(cp, acp) <= EPS_CLUSTER)
      );
      if (!sharesActiveCut) continue;
      if (midDist < bestDist) {
        bestDist = midDist;
        bestMatch = cand;
      }
    }
    if (!bestMatch) continue;

    const res = applyTrimSubSegment(curSegs, bestMatch.key, curSeparated);
    if (res.changed) {
      curSegs = res.segs;
      anyChanged = true;
      for (const hk of res.joinedHandles) {
        curSeparated.delete(hk);
        allJoinedHandles.push(hk);
      }
      for (const pid of res.joinedPolylineIds) allJoinedPolys.add(pid);
    }
  }

  return {
    segs: curSegs,
    changed: anyChanged,
    joinedHandles: allJoinedHandles,
    joinedPolylineIds: [...allJoinedPolys],
  };
}
