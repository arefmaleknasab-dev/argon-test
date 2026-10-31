import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_OP_TOOL_COMP,
  INNER_OPS,
  OP_INFO,
  Op,
  OpToolComp,
  Sample,
  ToolCompMachine,
  ToolCompMode,
  ToolCompShape,
  compContactPoint,
  compHull,
  compensateInnerPolyline,
  compensateOuterPolyline,
  diamondMaxRadius,
  makeCompToolShape,
} from "../lib/lathe";

interface ToolCompDialogProps {
  op: Op;
  outerSamples: Sample[];
  outerOffsetSamples: Sample[];
  innerSamples: Sample[];
  innerOffsetSamples: Sample[];
  onSaveOp: (opId: number, toolComp: OpToolComp) => void;
  onSaveAllOps: (toolComp: OpToolComp, holder: 1 | 2) => void;
  onClose: () => void;
}

type ScenarioId =
  | "project"
  | "mixed"
  | "step"
  | "ramp"
  | "arc"
  | "pocket"
  | "wave"
  | "stairs"
  | "spindle";

const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: "project", label: "پروفیل واقعی پروژه (خارج و داخل)" },
  { id: "mixed", label: "پله، شیب، قوس و پاکت" },
  { id: "step", label: "پله ۹۰ درجه بیرونی و داخلی" },
  { id: "ramp", label: "رمپ و قله تیز" },
  { id: "arc", label: "قوس محدب و مقعر" },
  { id: "pocket", label: "شیار باریک · آزمون تداخل" },
  { id: "wave", label: "موج سینوسی نرم" },
  { id: "stairs", label: "پله‌های متوالی و شیار تنگ" },
  { id: "spindle", label: "گلدان/دوکی تراشکاری" },
];

type Vec2 = [number, number];

interface AnimFrame {
  p: Vec2;
  base: Vec2;
  contact: Vec2;
  n: Vec2;
  s: number;
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: Vec2): number => Math.hypot(a[0], a[1]);
const norm = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const perpLeft = (t: Vec2): Vec2 => [-t[1], t[0]];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function samplesToVec2(samples: Sample[]): Vec2[] {
  return samples.map((s) => [s.z, s.r]);
}

function vec2ToSamples(pts: Vec2[]): Sample[] {
  return pts.map(([z, r]) => ({ z, r }));
}

function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n = 26): Vec2[] {
  if (r <= 1e-6) return [[cx, cy]];
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
  }
  return out;
}

/**
 * در حالت پروژه ("project") مختصات واقعی میلی‌متری [z, r] بدون هیچ تغییر مقیاس یا حذف نقاط منحنی
 * مستقیماً حفظ می‌شود تا منحنی‌ها و جبران شعاع ۱۰۰٪ مشابه پنجره اصلی طراحی پروفایل باشند.
 */
function getScenarioPolyline(scenario: ScenarioId, projectPoly: Sample[]): Vec2[] {
  if (scenario === "project" && projectPoly.length >= 2) {
    return samplesToVec2(projectPoly);
  }
  if (scenario === "step") {
    return [
      [-28, -8],
      [-14, -8],
      [-14, 5],
      [-1, 5],
      [-1, -3],
      [13, -3],
      [13, 8],
      [28, 8],
    ];
  }
  if (scenario === "ramp") {
    return [
      [-28, -9],
      [-16, -9],
      [-5, 9],
      [5, -7],
      [16, 6],
      [28, 6],
    ];
  }
  if (scenario === "arc") {
    return [
      [-28, -6],
      [-18, -6],
      ...arcPts(-9, -6, 9, Math.PI, 0, 32),
      [6, -6],
      ...arcPts(15, 2, 8, -Math.PI * 0.85, -Math.PI * 0.15, 32),
      [28, -3],
    ];
  }
  if (scenario === "pocket") {
    return [
      [-28, 5],
      [-11, 5],
      [-9, -9],
      [-2, -9],
      [0, 5],
      [8, 5],
      [9.2, -8],
      [12.3, -8],
      [13.5, 5],
      [28, 5],
    ];
  }
  if (scenario === "wave") {
    const pts: Vec2[] = [];
    for (let i = 0; i <= 70; i++) {
      const x = -28 + (56 * i) / 70;
      const y = Math.sin(x * 0.24) * 5.5 + Math.cos(x * 0.11) * 2.5 - 1;
      pts.push([x, y]);
    }
    return pts;
  }
  if (scenario === "stairs") {
    return [
      [-28, -10],
      [-20, -10],
      [-20, -4],
      [-12, -4],
      [-12, 2],
      [-4, 2],
      [-4, -7],
      [2, -7],
      [2, 7],
      [11, 7],
      [11, -2],
      [16, -2],
      [16, 9],
      [28, 9],
    ];
  }
  if (scenario === "spindle") {
    return [
      [-28, -9],
      [-22, -9],
      ...arcPts(-14, -1, 8, -Math.PI / 2, Math.PI * 0.28, 28),
      [-5, 2],
      ...arcPts(2, 7, 6.5, -Math.PI * 0.78, -Math.PI * 0.2, 26),
      [11, -3],
      ...arcPts(18, -3, 6, Math.PI, 0, 28),
      [28, -3],
    ];
  }
  return [
    [-28, -8],
    [-19, -8],
    [-13, 3],
    [-6, 3],
    ...arcPts(1, 3, 7, Math.PI, 0, 30),
    [11, 3],
    [13, -7],
    [19, -7],
    [21, 5],
    [28, 5],
  ];
}

/** نزدیک‌ترین نقطه روی یک چندخطی به نقطه داده شده به همراه نرمال محلی آن قطعه */
function closestPointOnPoly(pt: Vec2, poly: Vec2[]): { point: Vec2; normal: Vec2; distSq: number } {
  if (poly.length === 0) return { point: [0, 0], normal: [0, 1], distSq: 0 };
  if (poly.length === 1) {
    const dx = pt[0] - poly[0][0];
    const dy = pt[1] - poly[0][1];
    return { point: poly[0], normal: [0, 1], distSq: dx * dx + dy * dy };
  }
  let bestPoint: Vec2 = poly[0];
  let bestNormal: Vec2 = [0, 1];
  let bestDistSq = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 > 1e-12 ? ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    const px = a[0] + t * dx;
    const py = a[1] + t * dy;
    const d2 = (pt[0] - px) * (pt[0] - px) + (pt[1] - py) * (pt[1] - py);
    if (d2 < bestDistSq) {
      bestDistSq = d2;
      bestPoint = [px, py];
      if (len2 > 1e-12) {
        const l = Math.sqrt(len2);
        bestNormal = [-dy / l, dx / l];
      }
    }
  }
  return { point: bestPoint, normal: bestNormal, distSq: bestDistSq };
}

/**
 * نمونه‌برداری یکنواخت از مسیر جبران‌شده نهایی (که دقیقاً با موتور اصلی جی‌کد تولید شده است)
 * و استخراج نقطه تماس واقعی ابزار با پروفیل هدف برای نمایش انیمیشن بدون هیچ‌گونه حلقه اضافی.
 */
function buildAnimFramesFromCompensatedPath(
  compPoly: Vec2[],
  basePoly: Vec2[],
  comp: OpToolComp,
  modeOverride: ToolCompMode,
  shape: Vec2[],
  targetFrames = 240
): AnimFrame[] {
  if (compPoly.length === 0) return [];
  const ordered = comp.direction === 1 ? compPoly : [...compPoly].reverse();
  const baseOrdered = comp.direction === 1 ? basePoly : [...basePoly].reverse();

  const cumLen: number[] = [0];
  for (let i = 1; i < ordered.length; i++) {
    cumLen.push(cumLen[i - 1] + len(sub(ordered[i], ordered[i - 1])));
  }
  const totalLen = cumLen[cumLen.length - 1];
  const sampledRef: { p: Vec2; s: number }[] = [];

  if (totalLen <= 1e-6 || ordered.length < 2) {
    sampledRef.push({ p: ordered[0], s: 0 });
  } else {
    const steps = Math.max(40, targetFrames);
    let segIdx = 0;
    for (let k = 0; k <= steps; k++) {
      const sTarget = (totalLen * k) / steps;
      while (segIdx < ordered.length - 2 && cumLen[segIdx + 1] < sTarget - 1e-9) {
        segIdx++;
      }
      const segStartS = cumLen[segIdx];
      const segSpan = Math.max(1e-9, cumLen[segIdx + 1] - segStartS);
      const u = clamp((sTarget - segStartS) / segSpan, 0, 1);
      const a = ordered[segIdx];
      const b = ordered[segIdx + 1];
      sampledRef.push({
        p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u],
        s: sTarget,
      });
    }
  }

  return sampledRef.map(({ p, s }) => {
    if (modeOverride === "G40" || shape.length === 0) {
      const cl = closestPointOnPoly(p, baseOrdered);
      return {
        p,
        base: cl.point,
        contact: [0, 0] as Vec2,
        n: cl.normal,
        s,
      };
    }
    /* یافتن نقطه روی لبه برشی ابزار که در این لحظه به پروفیل هدف مماس است */
    let bestV: Vec2 = shape[0];
    let bestBase: Vec2 = baseOrdered[0] || p;
    let bestNormal: Vec2 = [0, 1];
    let bestD2 = Infinity;

    const stride = Math.max(1, Math.floor(shape.length / 48));
    for (let i = 0; i < shape.length; i += stride) {
      const v = shape[i];
      const worldV: Vec2 = [p[0] + v[0], p[1] + v[1]];
      const cl = closestPointOnPoly(worldV, baseOrdered);
      if (cl.distSq < bestD2) {
        bestD2 = cl.distSq;
        bestV = v;
        bestBase = cl.point;
        bestNormal = cl.normal;
      }
    }
    /* پالایش محلی اطراف بهترین رأس ابزار */
    const compWithMode = { mode: modeOverride, direction: comp.direction };
    const supportC = compContactPoint(bestNormal, compWithMode, shape);
    const worldSupport: Vec2 = [p[0] + supportC[0], p[1] + supportC[1]];
    const clSupport = closestPointOnPoly(worldSupport, baseOrdered);
    if (clSupport.distSq <= bestD2 + 1e-4) {
      bestV = supportC;
      bestBase = clSupport.point;
      bestNormal = clSupport.normal;
    }

    return {
      p,
      base: bestBase,
      contact: bestV,
      n: bestNormal,
      s,
    };
  });
}

function detectGouge(poly: Vec2[], comp: OpToolComp, shape: Vec2[]): boolean {
  if (comp.mode === "G40") return false;
  let maxSpan = 0;
  for (const p of shape) maxSpan = Math.max(maxSpan, Math.hypot(p[0], p[1]));
  for (let i = 1; i < poly.length - 1; i++) {
    const l1 = len(sub(poly[i], poly[i - 1]));
    const l2 = len(sub(poly[i + 1], poly[i]));
    if (l1 < 1e-5 || l2 < 1e-5) continue;
    const a = norm(sub(poly[i], poly[i - 1]));
    const b = norm(sub(poly[i + 1], poly[i]));
    const turn = a[0] * b[1] - a[1] * b[0];
    const segLen = Math.min(l1, l2);
    const geomSign = (comp.mode === "G41" ? 1 : -1) * comp.direction;
    if (turn * geomSign > 0.35 && maxSpan > segLen * 0.85 && segLen > 0.8) return true;
  }
  return false;
}

export const ToolCompDialog: React.FC<ToolCompDialogProps> = ({
  op,
  outerSamples,
  outerOffsetSamples,
  innerSamples,
  innerOffsetSamples,
  onSaveOp,
  onSaveAllOps,
  onClose,
}) => {
  const opMeta = OP_INFO[op.type];
  const isInnerOp = INNER_OPS.includes(op.type);
  const isRoughOrOffsetOp =
    op.type === "rough-d" ||
    op.type === "rough-z" ||
    op.type === "copy" ||
    op.type === "offset" ||
    op.type === "inner-rough" ||
    op.type === "inner-offset";
  const isRoughEnvelopeOp =
    op.type === "rough-d" || op.type === "rough-z" || op.type === "copy";

  /* پروفیل مرجع عملیات فعلی در پروژه (برای عملیات‌های خشن و آفست: خط آفست؛ برای پرداخت: خط طرح) */
  const projectPoly = useMemo(() => {
    if (isInnerOp) {
      if (
        (op.type === "inner-rough" || op.type === "inner-offset") &&
        innerOffsetSamples.length >= 2
      ) {
        return innerOffsetSamples;
      }
      if (innerSamples.length >= 2) return innerSamples;
    }
    if (isRoughOrOffsetOp && outerOffsetSamples.length >= 2) {
      return outerOffsetSamples;
    }
    return outerSamples;
  }, [isInnerOp, isRoughOrOffsetOp, op.type, outerSamples, outerOffsetSamples, innerSamples, innerOffsetSamples]);

  const [comp, setComp] = useState<OpToolComp>(() => ({
    ...DEFAULT_OP_TOOL_COMP,
    ...(op.toolComp ?? {}),
    enabled: op.toolComp ? op.toolComp.enabled : true,
  }));

  const [scenario, setScenario] = useState<ScenarioId>(() =>
    projectPoly.length >= 2 ? "project" : "mixed"
  );
  const [compareAll, setCompareAll] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0.24);
  const [playing, setPlaying] = useState<boolean>(true);
  const [speed, setSpeed] = useState<number>(1);

  const W = 1000;
  const H = 620;

  /* محاسبه نمای استاندارد دوربین به گونه‌ای که هم پروفیل خارج‌تراشی و هم پروفیل داخل‌تراشی در مقیاس واقعی ۱:۱ میلی‌متر کامل دیده شوند */
  const computeFitView = useCallback(
    (sc: ScenarioId): { cx: number; cy: number; scale: number } => {
      if (sc !== "project") {
        return { cx: 0, cy: 0, scale: 13.5 };
      }
      const allPts: Sample[] = [
        ...outerSamples,
        ...outerOffsetSamples,
        ...innerSamples,
        ...innerOffsetSamples,
      ];
      if (allPts.length < 2) {
        return { cx: 50, cy: 25, scale: 6 };
      }
      let minZ = Infinity,
        maxZ = -Infinity,
        minR = 0,
        maxR = -Infinity;
      for (const p of allPts) {
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
        if (p.r < minR) minR = p.r;
        if (p.r > maxR) maxR = p.r;
      }
      const toolPad = Math.max(6, comp.radius * 2.5, comp.width * 1.2);
      minZ -= toolPad;
      maxZ += toolPad;
      minR = Math.min(0, minR) - toolPad * 0.6;
      maxR += toolPad * 1.4;

      const spanZ = Math.max(10, maxZ - minZ);
      const spanR = Math.max(10, maxR - minR);
      const scale = clamp(Math.min((W - 140) / spanZ, (H - 120) / spanR), 0.5, 80);
      return {
        cx: 0.5 * (minZ + maxZ),
        cy: 0.5 * (minR + maxR),
        scale,
      };
    },
    [outerSamples, outerOffsetSamples, innerSamples, innerOffsetSamples, comp.radius, comp.width]
  );

  const [view, setView] = useState<{ cx: number; cy: number; scale: number }>(() =>
    computeFitView(projectPoly.length >= 2 ? "project" : "mixed")
  );

  /* با تغییر سناریو بین پروژه و آزمایشگاه، دوربین روی محدوده همان سناریو تنظیم شود */
  useEffect(() => {
    setView(computeFitView(scenario));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ active: boolean; x: number; y: number; cx: number; cy: number }>({
    active: false,
    x: 0,
    y: 0,
    cx: 0,
    cy: 0,
  });

  /* تغییر حالت مرجع ابزار (مرکز ابزار XY در برابر نوک ابزار XY) منطبق بر syncToolControls در cnc-simulato.html */
  const handleMachineChange = (machine: ToolCompMachine) => {
    setComp((prev) => {
      const nextShape: ToolCompShape =
        machine === "mill" && prev.shape === "flat" ? "round" : prev.shape;
      const dMax = diamondMaxRadius(prev.diamondWidth);
      const minR = nextShape === "sharp" ? 0 : machine === "mill" ? 0 : 0.2;
      const maxR = nextShape === "sharp" ? dMax : 12;
      return {
        ...prev,
        machine,
        shape: nextShape,
        radius: clamp(prev.radius, minR, maxR),
      };
    });
  };

  /* تغییر شکل هندسی ابزار (منطبق بر cnc-simulato.html: در انتخاب لوزی ۳۵ درجه شعاع پیش‌فرض نوک ۰٫۲mm می‌شود تا فرم لوزی کاملاً مشخص باشد) */
  const handleShapeChange = (shape: ToolCompShape) => {
    setComp((prev) => {
      const dMax = diamondMaxRadius(prev.diamondWidth);
      const minR = shape === "sharp" ? 0 : prev.machine === "mill" ? 0 : 0.2;
      const maxR = shape === "sharp" ? dMax : 12;
      let nextRadius = prev.radius;
      if (shape === "sharp" && prev.shape !== "sharp") {
        nextRadius = prev.radius <= 0.6 ? prev.radius : 0.2;
      } else if (shape === "round" && prev.shape === "sharp" && prev.radius < 0.8) {
        nextRadius = 1.5;
      }
      return {
        ...prev,
        shape,
        radius: clamp(nextRadius, minR, maxR),
      };
    });
  };

  /* تغییر عرض لوزی ۳۵ درجه با حفظ نسبت شعاع دو نوک گرد (منطبق بر cnc-simulato.html) */
  const handleDiamondWidthChange = (newWidth: number) => {
    setComp((prev) => {
      const oldMax = diamondMaxRadius(prev.diamondWidth);
      const ratio = oldMax > 0 ? prev.radius / oldMax : 0.1;
      const nextWidth = clamp(newWidth, 2, 35);
      const nextMax = diamondMaxRadius(nextWidth);
      const nextRadius =
        Math.round(clamp(ratio * nextMax, 0, nextMax) * 20) / 20;
      return {
        ...prev,
        diamondWidth: nextWidth,
        radius: +nextRadius.toFixed(2),
      };
    });
  };

  /* تغییر جهت حرکت روی مسیر با تعویض خودکار G41/G42 تا سمت قطعه ثابت بماند (منطبق بر cnc-simulato.html) */
  const handleDirectionChange = (newDir: 1 | -1) => {
    setComp((prev) => {
      if (prev.direction === newDir) return prev;
      const nextMode: ToolCompMode =
        prev.mode === "G41" ? "G42" : prev.mode === "G42" ? "G41" : "G40";
      return {
        ...prev,
        direction: newDir,
        mode: nextMode,
      };
    });
  };

  /* محاسبه هندسه مسیر و جبران با استفاده مستقیم از توابع اصلی موتور نرم‌افزار (compensateOuterPolyline / compensateInnerPolyline) */
  const simData = useMemo(() => {
    const basePoly = getScenarioPolyline(scenario, projectPoly);
    const baseSamples = vec2ToSamples(basePoly);
    const shape = makeCompToolShape(comp);
    const isProjectInner = scenario === "project" && isInnerOp && innerSamples.length >= 2;
    const isProjectRoughEnv = scenario === "project" && !isInnerOp && isRoughEnvelopeOp;
    const clampMinR = scenario === "project" ? 0 : -Infinity;

    const computeModePoly = (mode: ToolCompMode): Vec2[] => {
      if (mode === "G40" || baseSamples.length < 2) return basePoly;
      const compForMode: OpToolComp = {
        ...comp,
        enabled: true,
        mode,
      };
      const res = isProjectInner
        ? compensateInnerPolyline(baseSamples, compForMode)
        : compensateOuterPolyline(baseSamples, compForMode, isProjectRoughEnv, clampMinR);
      return samplesToVec2(res);
    };

    const g41Poly = computeModePoly("G41");
    const g42Poly = computeModePoly("G42");
    const g40Poly = basePoly;
    const activePoly =
      comp.mode === "G41" ? g41Poly : comp.mode === "G42" ? g42Poly : g40Poly;

    const g41 = buildAnimFramesFromCompensatedPath(g41Poly, basePoly, comp, "G41", shape);
    const g42 = buildAnimFramesFromCompensatedPath(g42Poly, basePoly, comp, "G42", shape);
    const g40 = buildAnimFramesFromCompensatedPath(g40Poly, basePoly, comp, "G40", shape);
    const active = comp.mode === "G41" ? g41 : comp.mode === "G42" ? g42 : g40;

    const totalLen = Math.max(1, active[active.length - 1]?.s || 60);
    const gouge = detectGouge(basePoly, comp, shape);

    /* در حالت پروژه، هر دو پروفیل خارج‌تراشی و داخل‌تراشی را در مقیاس واقعی میلی‌متری آماده می‌کنیم */
    const outerDesignVec = scenario === "project" ? samplesToVec2(outerSamples) : [];
    const outerOffVec = scenario === "project" ? samplesToVec2(outerOffsetSamples) : [];
    const innerDesignVec = scenario === "project" ? samplesToVec2(innerSamples) : [];
    const innerOffVec = scenario === "project" ? samplesToVec2(innerOffsetSamples) : [];

    /* ساخت چندضلعی مقطع قطعه بین پروفیل خارج و داخل (یا تا محور R=0) */
    let workpieceAreaPoly: Vec2[] = [];
    if (scenario === "project") {
      if (outerDesignVec.length >= 2 && innerDesignVec.length >= 2) {
        const revInner = [...innerDesignVec].reverse();
        workpieceAreaPoly = [
          ...outerDesignVec,
          ...revInner,
          [outerDesignVec[0][0], 0],
        ];
      } else if (outerDesignVec.length >= 2) {
        workpieceAreaPoly = [
          ...outerDesignVec,
          [outerDesignVec[outerDesignVec.length - 1][0], 0],
          [outerDesignVec[0][0], 0],
        ];
      } else if (innerDesignVec.length >= 2) {
        workpieceAreaPoly = [
          ...innerDesignVec,
          [innerDesignVec[innerDesignVec.length - 1][0], 0],
          [innerDesignVec[0][0], 0],
        ];
      }
    } else if (basePoly.length >= 2) {
      workpieceAreaPoly = [
        ...basePoly,
        [basePoly[basePoly.length - 1][0], -28],
        [basePoly[0][0], -28],
      ];
    }

    return {
      basePoly,
      shape,
      g41Poly,
      g42Poly,
      g40Poly,
      activePoly,
      g41,
      g42,
      g40,
      active,
      totalLen,
      gouge,
      outerDesignVec,
      outerOffVec,
      innerDesignVec,
      innerOffVec,
      workpieceAreaPoly,
    };
  }, [
    scenario,
    projectPoly,
    comp,
    isInnerOp,
    isRoughEnvelopeOp,
    outerSamples,
    outerOffsetSamples,
    innerSamples,
    innerOffsetSamples,
  ]);

  /* حلقه انیمیشن */
  useEffect(() => {
    if (!playing) return;
    let rafId = 0;
    let lastTime = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      setProgress((prev) => {
        const next = prev + dt * 0.14 * speed;
        return next > 1 ? 0 : next;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, speed]);

  /* تبدیل مختصات جهان به صفحه SVG (1000x620) */
  const worldToScreen = (p: Vec2): Vec2 => [
    W / 2 + (p[0] - view.cx) * view.scale,
    H / 2 - (p[1] - view.cy) * view.scale,
  ];
  const toSvgPath = (pts: Vec2[], close = false): string => {
    if (!pts.length) return "";
    return (
      pts
        .map((p, i) => {
          const s = worldToScreen(p);
          return `${i ? "L" : "M"}${s[0].toFixed(2)},${s[1].toFixed(2)}`;
        })
        .join(" ") + (close ? " Z" : "")
    );
  };

  /* شاخص فعلی انیمیشن */
  const idx = clamp(
    Math.floor(progress * (simData.active.length - 1)),
    0,
    Math.max(0, simData.active.length - 1)
  );
  const curPt = simData.active[idx] || {
    p: [0, 0] as Vec2,
    base: [0, 0] as Vec2,
    contact: [0, 0] as Vec2,
    n: [0, 1] as Vec2,
    s: 0,
  };
  const nextPt = simData.active[Math.min(simData.active.length - 1, idx + 1)] || curPt;
  const moveVec = sub(nextPt.p, curPt.p);
  const moveDir: Vec2 = len(moveVec) > 1e-5 ? norm(moveVec) : [comp.direction, 0];

  /* کپسول‌های ناحیه جاروب‌شده (Swept Area) تا لحظه فعلی */
  const sweepCapsules = useMemo(() => {
    const stride = Math.max(1, Math.floor(simData.active.length / 75));
    const capsules: string[] = [];
    for (let i = 0; i < idx; i += stride) {
      const a = simData.active[i].p;
      const b = simData.active[Math.min(idx, i + stride)].p;
      const pts: Vec2[] = [];
      for (const v of simData.shape) {
        pts.push([a[0] + v[0], a[1] + v[1]]);
        pts.push([b[0] + v[0], b[1] + v[1]]);
      }
      const h = compHull(pts);
      if (h.length > 2) capsules.push(toSvgPath(h, true));
    }
    return capsules;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simData.active, simData.shape, idx, view]);

  /* محاسبه متریک‌های زنده (Live Analysis) */
  const verticalDelta = curPt.p[1] - curPt.base[1];
  const approxCutSpan = useMemo(() => {
    let minY = Infinity,
      maxY = -Infinity;
    for (const v of simData.shape) {
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
    }
    return Math.max(0.2, maxY - minY);
  }, [simData.shape]);
  const sweptAreaApprox = curPt.s * approxCutSpan;

  const contactBranchLabel = useMemo(() => {
    if (comp.mode === "G40") return "مرجع روی مسیر (بدون جبران)";
    if (comp.machine === "mill" && comp.shape === "round") return "محیط دایره نسبت به مرکز";
    if (comp.shape === "round") return "کمان نوک گرد ابزار";
    if (comp.shape === "sharp") {
      return Math.abs(curPt.contact[0]) < 0.35
        ? "قوس نوک لوزی ۳۵°"
        : curPt.contact[0] < 0
        ? "یال چپ لوزی ۳۵°"
        : "یال راست لوزی ۳۵°";
    }
    return curPt.contact[0] < -0.25
      ? "گوشه چپ ابزار تخت"
      : curPt.contact[0] > 0.25
      ? "گوشه راست ابزار تخت"
      : "کف تخت ابزار";
  }, [comp.mode, comp.machine, comp.shape, curPt.contact]);

  /* هندسه بدنه ابزار در موقعیت فعلی روی بوم */
  const toolWorldPoly: Vec2[] = simData.shape.map((v) => [
    curPt.p[0] + v[0],
    curPt.p[1] + v[1],
  ]);
  const refScreen = worldToScreen(curPt.p);
  const contactWorld: Vec2 = [
    curPt.p[0] + curPt.contact[0],
    curPt.p[1] + curPt.contact[1],
  ];
  const contactScreen = worldToScreen(contactWorld);
  const baseScreen = worldToScreen(curPt.base);

  const dMax = diamondMaxRadius(comp.diamondWidth);
  const minRadius = comp.shape === "sharp" ? 0 : comp.machine === "mill" ? 0 : 0.2;
  const maxRadius = comp.shape === "sharp" ? dMax : 12;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3"
      dir="rtl"
      onClick={onClose}
    >
      <div
        className="flex flex-col w-full max-w-[1440px] h-[92vh] rounded-2xl border border-[#2d384c] bg-[#0b0e13] text-[#e8eef7] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* نوار عنوان بالایی */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[#253042] bg-[#121720]">
          <div className="flex items-center gap-3">
            <span
              className="w-3.5 h-3.5 rounded-full shrink-0 shadow"
              style={{ background: opMeta.color }}
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-[#e8eef7]">
                  تعیین ابزار و جبران شعاع عملیات: {opMeta.name}
                </h2>
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-md border border-[#38bdf8]/40 bg-[#38bdf8]/10 text-[#38bdf8]">
                  هلدر H{op.holder}
                </span>
                <span className="px-2 py-0.5 text-[11px] rounded-md border border-[#2dd4bf]/40 bg-[#2dd4bf]/10 text-[#2dd4bf]">
                  محاسبه مستقیم در مختصات X و Y جی‌کد (بدون صدور G41/G42)
                </span>
              </div>
              <p className="text-[11px] text-[#92a0b8] mt-0.5">
                {isRoughOrOffsetOp
                  ? "در عملیات خشن‌کاری و آفست، برخورد دقیق لبه برشی ابزار با خط آفست محاسبه می‌شود تا از بیش‌تراشی (Gouge) جلوگیری شود."
                  : "در عملیات پرداخت، مسیر مرجع ابزار (مرکز یا نوک ابزار) طوری جبران می‌شود که لبه برشی دقیقاً روی پروفیل طرح مماس بماند."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* کلید فعال‌سازی برای این عملیات */}
            <button
              type="button"
              onClick={() => setComp((prev) => ({ ...prev, enabled: !prev.enabled }))}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition ${
                comp.enabled
                  ? "border-[#2dd4bf] bg-[#2dd4bf]/15 text-[#2dd4bf]"
                  : "border-[#334155] bg-[#171e2a] text-[#92a0b8]"
              }`}
            >
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  comp.enabled ? "bg-[#2dd4bf]" : "bg-[#64748b]"
                }`}
              />
              {comp.enabled ? "جبران شعاع فعال است" : "جبران شعاع غیرفعال"}
            </button>

            <button
              type="button"
              onClick={() => {
                onSaveAllOps(comp, op.holder);
                onClose();
              }}
              className="px-3 py-1.5 rounded-lg border border-[#38bdf8]/40 bg-[#38bdf8]/10 hover:bg-[#38bdf8]/20 text-[#38bdf8] text-xs font-semibold transition"
              title={`اعمال این ابزار و تنظیمات جبران شعاع فقط روی تمام عملیات‌های مربوط به هلدر H${op.holder}`}
            >
              اعمال به همه عملیات‌های H{op.holder}
            </button>

            <button
              type="button"
              onClick={() => {
                onSaveOp(op.id, comp);
                onClose();
              }}
              className="px-4 py-1.5 rounded-lg bg-[#2dd4bf] hover:bg-[#14b8a6] text-[#071318] text-xs font-bold shadow transition"
            >
              ذخیره روی «{opMeta.name}»
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-[#2d384c] bg-[#171e2a] hover:bg-[#1e293b] text-[#92a0b8] hover:text-white transition"
              title="بستن"
            >
              ✕
            </button>
          </div>
        </div>

        {/* بدنه اصلی: پنل تنظیمات راست + صحنه انیمیشن چپ */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[410px_1fr] min-h-0 overflow-hidden">
          {/* ستون راست: پارامترهای کامل ابزار و جبران شعاع (منطبق بر cnc-simulato.html) */}
          <aside className="overflow-y-auto border-l border-[#253042] bg-[#121720] p-3.5 space-y-3">
            {/* ۱. نقطه مرجع برنامه‌نویسی ابزار (مرکز ابزار در برابر نوک ابزار) */}
            <section className="rounded-xl border border-[#253042] bg-[#171e2a] p-3">
              <h3 className="text-xs font-bold text-[#92a0b8] mb-2 flex items-center justify-between">
                <span>۱. نقطه مرجع برنامه‌نویسی ابزار (اصلی)</span>
                <span className="text-[10px] font-mono text-[#38bdf8]">
                  {comp.machine === "mill" ? "CENTER (0,0)" : "TIP (0,0)"}
                </span>
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleMachineChange("mill")}
                  className={`text-right p-2.5 rounded-lg border transition ${
                    comp.machine === "mill"
                      ? "border-[#38bdf8] bg-[#38bdf8]/12 text-[#e8eef7]"
                      : "border-[#253042] bg-[#0f141d] text-[#92a0b8] hover:border-[#36465f]"
                  }`}
                >
                  <div className="text-xs font-bold text-[#38bdf8]">مرکز ابزار XY</div>
                  <div className="text-[10px] text-[#92a0b8] mt-0.5 leading-4">
                    مرجع روی مرکز شعاع دایره یا مرکز قوس مؤثر ابزار
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleMachineChange("turn")}
                  className={`text-right p-2.5 rounded-lg border transition ${
                    comp.machine === "turn"
                      ? "border-[#2dd4bf] bg-[#2dd4bf]/12 text-[#e8eef7]"
                      : "border-[#253042] bg-[#0f141d] text-[#92a0b8] hover:border-[#36465f]"
                  }`}
                >
                  <div className="text-xs font-bold text-[#2dd4bf]">نوک ابزار XY</div>
                  <div className="text-[10px] text-[#92a0b8] mt-0.5 leading-4">
                    مرجع روی نوک پایینی ابزار پیش از چرخش اینسرت
                  </div>
                </button>
              </div>
            </section>

            {/* ۲. حالت جبران شعاع (سمت هندسی حرکت) */}
            <section className="rounded-xl border border-[#253042] bg-[#171e2a] p-3">
              <h3 className="text-xs font-bold text-[#92a0b8] mb-2">
                ۲. سمت جبران شعاع (تولید در مختصات X/Y)
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setComp((prev) => ({ ...prev, mode: "G41", enabled: true }))}
                  className={`text-right p-2 rounded-lg border transition ${
                    comp.mode === "G41"
                      ? "border-[#2dd4bf] bg-[#2dd4bf]/12"
                      : "border-[#253042] bg-[#0f141d] hover:border-[#36465f]"
                  }`}
                >
                  <div className="text-xs font-bold text-[#2dd4bf]">چپ مسیر (G41)</div>
                  <div className="text-[10px] text-[#92a0b8] mt-0.5">بیرون قطعه / سمت چپ</div>
                </button>
                <button
                  type="button"
                  onClick={() => setComp((prev) => ({ ...prev, mode: "G42", enabled: true }))}
                  className={`text-right p-2 rounded-lg border transition ${
                    comp.mode === "G42"
                      ? "border-[#fb7185] bg-[#fb7185]/12"
                      : "border-[#253042] bg-[#0f141d] hover:border-[#36465f]"
                  }`}
                >
                  <div className="text-xs font-bold text-[#fb7185]">راست مسیر (G42)</div>
                  <div className="text-[10px] text-[#92a0b8] mt-0.5">سمت راست حرکت</div>
                </button>
                <button
                  type="button"
                  onClick={() => setComp((prev) => ({ ...prev, mode: "G40" }))}
                  className={`text-right p-2 rounded-lg border transition ${
                    comp.mode === "G40"
                      ? "border-[#a78bfa] bg-[#a78bfa]/12"
                      : "border-[#253042] bg-[#0f141d] hover:border-[#36465f]"
                  }`}
                >
                  <div className="text-xs font-bold text-[#a78bfa]">بدون جبران</div>
                  <div className="text-[10px] text-[#92a0b8] mt-0.5">مرجع روی خط برنامه</div>
                </button>
              </div>
            </section>

            {/* ۳. هندسه مقطع مؤثر برشی و ابعاد ابزار */}
            <section className="rounded-xl border border-[#253042] bg-[#171e2a] p-3 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-[#92a0b8]">۳. هندسه مقطع مؤثر برشی</h3>
                <div className="flex items-center gap-1.5 text-[10px] text-[#92a0b8]">
                  <span className="inline-block w-2 h-2 rounded-full bg-[#38bdf8]" />
                  <span>مرجع (0,0)</span>
                </div>
              </div>

              <div
                className={`grid gap-2 ${
                  comp.machine === "mill" ? "grid-cols-2" : "grid-cols-3"
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleShapeChange("round")}
                  className={`text-right p-2 rounded-lg border transition ${
                    comp.shape === "round"
                      ? "border-[#38bdf8] bg-[#38bdf8]/12"
                      : "border-[#253042] bg-[#0f141d] hover:border-[#36465f]"
                  }`}
                >
                  <div className="text-xs font-bold text-[#e8eef7]">
                    {comp.machine === "mill" ? "دایره" : "نوک گرد"}
                  </div>
                  <div className="text-[10px] text-[#92a0b8] mt-0.5">
                    {comp.machine === "mill" ? "مقطع مؤثر فرز" : "شعاع مشخص R"}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleShapeChange("sharp")}
                  className={`text-right p-2 rounded-lg border transition ${
                    comp.shape === "sharp"
                      ? "border-[#38bdf8] bg-[#38bdf8]/12"
                      : "border-[#253042] bg-[#0f141d] hover:border-[#36465f]"
                  }`}
                >
                  <div className="text-xs font-bold text-[#e8eef7]">لوزی ۳۵ درجه</div>
                  <div className="text-[10px] text-[#92a0b8] mt-0.5">دو نوک گرد متقارن</div>
                </button>

                {comp.machine === "turn" && (
                  <button
                    type="button"
                    onClick={() => handleShapeChange("flat")}
                    className={`text-right p-2 rounded-lg border transition ${
                      comp.shape === "flat"
                        ? "border-[#38bdf8] bg-[#38bdf8]/12"
                        : "border-[#253042] bg-[#0f141d] hover:border-[#36465f]"
                    }`}
                  >
                    <div className="text-xs font-bold text-[#e8eef7]">تخت شیارزن</div>
                    <div className="text-[10px] text-[#92a0b8] mt-0.5">دو گوشه مستقل</div>
                  </button>
                )}
              </div>

              {/* اسلایدر عرض لوزی ۳۵ درجه */}
              {comp.shape === "sharp" && (
                <div className="space-y-1 pt-1 border-t border-[#253042]">
                  <div className="flex justify-between text-xs">
                    <span className="text-[#92a0b8]">عرض ابزار لوزی ۳۵ درجه</span>
                    <strong className="font-mono text-[#38bdf8]">
                      {comp.diamondWidth.toFixed(1)} mm
                    </strong>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={35}
                    step={0.5}
                    value={comp.diamondWidth}
                    onChange={(e) => handleDiamondWidthChange(parseFloat(e.target.value))}
                    className="w-full accent-[#38bdf8]"
                  />
                </div>
              )}

              {/* اسلایدر شعاع ابزار R (برای round و sharp) */}
              {comp.shape !== "flat" && (
                <div className="space-y-1 pt-1 border-t border-[#253042]">
                  <div className="flex justify-between text-xs">
                    <span className="text-[#92a0b8]">
                      {comp.shape === "sharp"
                        ? "شعاع دو نوک گرد R"
                        : comp.machine === "mill"
                        ? "شعاع ابزار R"
                        : "شعاع نوک ابزار R"}
                    </span>
                    <strong className="font-mono text-[#2dd4bf]">
                      {comp.radius.toFixed(2)} mm
                      {comp.shape === "sharp" ? ` (حداکثر ${dMax.toFixed(2)})` : ""}
                    </strong>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={minRadius}
                      max={maxRadius}
                      step={comp.shape === "sharp" ? 0.05 : 0.1}
                      value={comp.radius}
                      onChange={(e) =>
                        setComp((prev) => ({
                          ...prev,
                          radius: clamp(parseFloat(e.target.value) || 0, minRadius, maxRadius),
                        }))
                      }
                      className="flex-1 accent-[#2dd4bf]"
                    />
                    <input
                      type="number"
                      min={minRadius}
                      max={maxRadius}
                      step={0.1}
                      value={comp.radius}
                      onChange={(e) =>
                        setComp((prev) => ({
                          ...prev,
                          radius: clamp(parseFloat(e.target.value) || 0, minRadius, maxRadius),
                        }))
                      }
                      className="w-16 rounded border border-[#2d384c] bg-[#0f141d] px-1.5 py-1 text-center font-mono text-xs text-[#e8eef7]"
                    />
                  </div>
                </div>
              )}

              {/* کنترل‌های ابزار تخت: عرض کف + شعاع گوشه چپ + شعاع گوشه راست */}
              {comp.shape === "flat" && (
                <div className="space-y-2.5 pt-1 border-t border-[#253042]">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-[#92a0b8]">عرض کف تخت</span>
                      <strong className="font-mono text-[#38bdf8]">
                        {comp.width.toFixed(1)} mm
                      </strong>
                    </div>
                    <input
                      type="range"
                      min={2}
                      max={20}
                      step={0.5}
                      value={comp.width}
                      onChange={(e) => {
                        const width = parseFloat(e.target.value);
                        setComp((prev) => {
                          let rl = prev.rl;
                          let rr = prev.rr;
                          if (rl + rr > width) {
                            const scale = width / Math.max(1e-6, rl + rr);
                            rl = +(rl * scale).toFixed(2);
                            rr = Math.max(0, +(width - rl).toFixed(2));
                          }
                          return { ...prev, width, rl, rr };
                        });
                      }}
                      className="w-full accent-[#38bdf8]"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-[#92a0b8]">شعاع گوشه چپ</span>
                      <strong className="font-mono text-[#2dd4bf]">
                        {comp.rl.toFixed(1)} mm
                      </strong>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={8}
                      step={0.1}
                      value={comp.rl}
                      onChange={(e) => {
                        const rl = parseFloat(e.target.value);
                        setComp((prev) => ({
                          ...prev,
                          rl,
                          rr: rl + prev.rr > prev.width ? Math.max(0, +(prev.width - rl).toFixed(1)) : prev.rr,
                        }));
                      }}
                      className="w-full accent-[#2dd4bf]"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-[#92a0b8]">شعاع گوشه راست</span>
                      <strong className="font-mono text-[#2dd4bf]">
                        {comp.rr.toFixed(1)} mm
                      </strong>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={8}
                      step={0.1}
                      value={comp.rr}
                      onChange={(e) => {
                        const rr = parseFloat(e.target.value);
                        setComp((prev) => ({
                          ...prev,
                          rr,
                          rl: prev.rl + rr > prev.width ? Math.max(0, +(prev.width - rr).toFixed(1)) : prev.rl,
                        }));
                      }}
                      className="w-full accent-[#2dd4bf]"
                    />
                  </div>
                </div>
              )}

              {/* اسلایدر زاویه ثابت اینسرت */}
              <div className="space-y-1.5 pt-2 border-t border-[#253042]">
                <div className="flex justify-between text-xs">
                  <span className="text-[#92a0b8]">زاویه ثابت اینسرت</span>
                  <strong className="font-mono text-[#f59e0b]">{comp.angle}°</strong>
                </div>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={comp.angle}
                  onChange={(e) =>
                    setComp((prev) => ({ ...prev, angle: parseInt(e.target.value, 10) || 0 }))
                  }
                  className="w-full accent-[#f59e0b]"
                />
                <div className="flex items-center justify-between gap-1 pt-0.5">
                  {[-90, -45, 0, 45, 90].map((deg) => (
                    <button
                      key={deg}
                      type="button"
                      onClick={() => setComp((prev) => ({ ...prev, angle: deg }))}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono border transition ${
                        comp.angle === deg
                          ? "border-[#f59e0b] bg-[#f59e0b]/15 text-[#f59e0b]"
                          : "border-[#253042] bg-[#0f141d] text-[#92a0b8] hover:text-white"
                      }`}
                    >
                      {deg > 0 ? `+${deg}°` : `${deg}°`}
                    </button>
                  ))}
                </div>
              </div>

              {/* جهت حرکت روی مسیر */}
              <div className="space-y-1.5 pt-2 border-t border-[#253042]">
                <div className="text-xs text-[#92a0b8]">جهت حرکت روی مسیر</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleDirectionChange(1)}
                    className={`p-2 rounded-lg border text-right transition ${
                      comp.direction === 1
                        ? "border-[#38bdf8] bg-[#38bdf8]/12"
                        : "border-[#253042] bg-[#0f141d]"
                    }`}
                  >
                    <div className="text-xs font-bold text-[#e8eef7]">رفت · چپ به راست</div>
                    <div className="text-[10px] text-[#92a0b8]">جهت استاندارد محور X</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDirectionChange(-1)}
                    className={`p-2 rounded-lg border text-right transition ${
                      comp.direction === -1
                        ? "border-[#38bdf8] bg-[#38bdf8]/12"
                        : "border-[#253042] bg-[#0f141d]"
                    }`}
                  >
                    <div className="text-xs font-bold text-[#e8eef7]">برگشت · راست به چپ</div>
                    <div className="text-[10px] text-[#92a0b8]">تعویض خودکار G41/G42</div>
                  </button>
                </div>
              </div>
            </section>

            {/* ۴. انتخاب سناریوی هندسی شبیه‌ساز */}
            <section className="rounded-xl border border-[#253042] bg-[#171e2a] p-3">
              <h3 className="text-xs font-bold text-[#92a0b8] mb-2">
                ۴. هندسه مسیر آزمایشگاه و پروژه
              </h3>
              <div className="grid grid-cols-2 gap-1.5">
                {SCENARIOS.map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => {
                      setScenario(sc.id);
                      setProgress(0);
                    }}
                    className={`p-2 rounded-lg border text-right text-xs transition ${
                      sc.id === "project" ? "col-span-2" : ""
                    } ${
                      scenario === sc.id
                        ? "border-[#2dd4bf] bg-[#2dd4bf]/12 text-[#e8eef7] font-bold"
                        : "border-[#253042] bg-[#0f141d] text-[#92a0b8] hover:border-[#36465f]"
                    }`}
                  >
                    {sc.label}
                  </button>
                ))}
              </div>
            </section>
          </aside>

          {/* ستون چپ: صحنه انیمیشن تعاملی و تحلیل زنده */}
          <main className="flex flex-col min-h-0 bg-[#0b0e13] p-3 gap-2.5 overflow-hidden">
            {/* نوار راهنمای رنگ‌ها و هشدار برخورد */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl border border-[#253042] bg-[#121720] text-xs">
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#92a0b8]">
                <span className="flex items-center gap-1.5">
                  <i className="w-2.5 h-2.5 rounded-full bg-[#f59e0b] inline-block" />
                  {scenario === "project"
                    ? "پروفیل خارج‌تراشی"
                    : "خط قطعه / برنامه اصلی"}
                </span>
                {scenario === "project" && simData.innerDesignVec.length >= 2 && (
                  <span className="flex items-center gap-1.5">
                    <i className="w-2.5 h-2.5 rounded-full bg-[#f472b6] inline-block" />
                    پروفیل داخل‌تراشی (کاسه)
                  </span>
                )}
                {scenario === "project" && isRoughOrOffsetOp && (
                  <span className="flex items-center gap-1.5">
                    <i className="w-2.5 h-2.5 rounded-full bg-[#fb923c] inline-block" />
                    خط آفست عملیات فعلی
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <i className="w-2.5 h-2.5 rounded-full bg-[#2dd4bf] inline-block" />
                  مسیر جبران‌شده مرجع ابزار (X/Y)
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="w-2.5 h-2.5 rounded-full bg-[#38bdf8] inline-block" />
                  ابزار و نقطه مرجع (0,0)
                </span>
              </div>

              <div
                className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold ${
                  simData.gouge
                    ? "border-[#ef4444]/50 bg-[#ef4444]/15 text-[#fca5a5]"
                    : "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#86efac]"
                }`}
              >
                {simData.gouge
                  ? "هشدار تداخل هندسی: شعاع ابزار از عرض شیار یا گوشه داخلی بزرگ‌تر است"
                  : "برخورد هندسی ایمن · بدون بیش‌تراشی (Gouge)"}
              </div>
            </div>

            {/* بوم SVG تعاملی */}
            <div className="relative flex-1 min-h-0 rounded-xl border border-[#253042] bg-[#070a0f] overflow-hidden select-none">
              <svg
                ref={svgRef}
                viewBox="0 0 1000 620"
                className="w-full h-full cursor-grab active:cursor-grabbing"
                onMouseDown={(e) => {
                  dragRef.current = {
                    active: true,
                    x: e.clientX,
                    y: e.clientY,
                    cx: view.cx,
                    cy: view.cy,
                  };
                }}
                onMouseMove={(e) => {
                  if (!dragRef.current.active || !svgRef.current) return;
                  const rect = svgRef.current.getBoundingClientRect();
                  const dx = ((e.clientX - dragRef.current.x) * (W / rect.width)) / view.scale;
                  const dy = ((e.clientY - dragRef.current.y) * (H / rect.height)) / view.scale;
                  setView((v) => ({
                    ...v,
                    cx: dragRef.current.cx - dx,
                    cy: dragRef.current.cy + dy,
                  }));
                }}
                onMouseUp={() => {
                  dragRef.current.active = false;
                }}
                onMouseLeave={() => {
                  dragRef.current.active = false;
                }}
                onWheel={(e) => {
                  e.preventDefault();
                  const factor = e.deltaY < 0 ? 1.14 : 1 / 1.14;
                  setView((v) => ({ ...v, scale: clamp(v.scale * factor, 0.4, 120) }));
                }}
              >
                {/* شبکه مختصات */}
                <g>
                  {(() => {
                    const step =
                      view.scale > 28
                        ? 0.5
                        : view.scale > 16
                        ? 1
                        : view.scale > 8
                        ? 2
                        : view.scale > 3.5
                        ? 5
                        : view.scale > 1.6
                        ? 10
                        : 20;
                    const x0 = Math.floor((view.cx - W / (2 * view.scale)) / step) * step;
                    const x1 = Math.ceil((view.cx + W / (2 * view.scale)) / step) * step;
                    const y0 = Math.floor((view.cy - H / (2 * view.scale)) / step) * step;
                    const y1 = Math.ceil((view.cy + H / (2 * view.scale)) / step) * step;
                    const lines: React.ReactNode[] = [];
                    for (let x = x0; x <= x1; x += step) {
                      const sx = worldToScreen([x, 0])[0];
                      const major = Math.abs(Math.round(x / step) % 5) === 0;
                      lines.push(
                        <line
                          key={`gx-${x.toFixed(2)}`}
                          x1={sx}
                          y1={0}
                          x2={sx}
                          y2={H}
                          stroke={
                            Math.abs(x) < 1e-6
                              ? "rgba(56,189,248,0.24)"
                              : major
                              ? "rgba(148,163,184,0.10)"
                              : "rgba(148,163,184,0.04)"
                          }
                          strokeWidth={1}
                        />
                      );
                    }
                    for (let y = y0; y <= y1; y += step) {
                      const sy = worldToScreen([0, y])[1];
                      const major = Math.abs(Math.round(y / step) % 5) === 0;
                      lines.push(
                        <line
                          key={`gy-${y.toFixed(2)}`}
                          x1={0}
                          y1={sy}
                          x2={W}
                          y2={sy}
                          stroke={
                            Math.abs(y) < 1e-6
                              ? "rgba(245,158,11,0.32)"
                              : major
                              ? "rgba(148,163,184,0.10)"
                              : "rgba(148,163,184,0.04)"
                          }
                          strokeWidth={Math.abs(y) < 1e-6 ? 1.4 : 1}
                          strokeDasharray={Math.abs(y) < 1e-6 && scenario === "project" ? "8 5" : undefined}
                        />
                      );
                    }
                    return lines;
                  })()}
                </g>

                {/* ناحیه مقطع قطعه */}
                {simData.workpieceAreaPoly.length >= 3 && (
                  <path
                    d={toSvgPath(simData.workpieceAreaPoly, true)}
                    fill="rgba(245,158,11,0.09)"
                    stroke="rgba(245,158,11,0.22)"
                    strokeWidth={1}
                  />
                )}

                {/* در حالت پروژه: نمایش هم‌زمان پروفیل خارج‌تراشی و پروفیل داخل‌تراشی (کاسه) */}
                {scenario === "project" && (
                  <g>
                    {/* پروفیل اصلی خارج‌تراشی */}
                    {simData.outerDesignVec.length >= 2 && (
                      <path
                        d={toSvgPath(simData.outerDesignVec)}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth={isInnerOp ? 2.4 : 3}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={isInnerOp ? 0.85 : 1}
                      />
                    )}
                    {/* خط آفست خارج‌تراشی */}
                    {simData.outerOffVec.length >= 2 && (
                      <path
                        d={toSvgPath(simData.outerOffVec)}
                        fill="none"
                        stroke="#fb923c"
                        strokeWidth={!isInnerOp && isRoughOrOffsetOp ? 2.6 : 1.5}
                        strokeDasharray={!isInnerOp && isRoughOrOffsetOp ? undefined : "5 4"}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={!isInnerOp && isRoughOrOffsetOp ? 0.95 : 0.55}
                      />
                    )}
                    {/* پروفیل اصلی داخل‌تراشی (کاسه) */}
                    {simData.innerDesignVec.length >= 2 && (
                      <path
                        d={toSvgPath(simData.innerDesignVec)}
                        fill="none"
                        stroke="#f472b6"
                        strokeWidth={isInnerOp ? 3 : 2.4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={isInnerOp ? 1 : 0.88}
                      />
                    )}
                    {/* خط آفست داخل‌تراشی */}
                    {simData.innerOffVec.length >= 2 && (
                      <path
                        d={toSvgPath(simData.innerOffVec)}
                        fill="none"
                        stroke="#c084fc"
                        strokeWidth={isInnerOp && isRoughOrOffsetOp ? 2.6 : 1.5}
                        strokeDasharray={isInnerOp && isRoughOrOffsetOp ? undefined : "5 4"}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={isInnerOp && isRoughOrOffsetOp ? 0.95 : 0.55}
                      />
                    )}
                  </g>
                )}

                {/* ناحیه جاروب‌شده توسط ابزار (Swept Area) */}
                <g>
                  {sweepCapsules.map((d, i) => (
                    <path key={i} d={d} fill="rgba(56,189,248,0.12)" stroke="none" />
                  ))}
                </g>

                {/* مقایسه هر سه حالت یا نمایش حالت انتخابی */}
                {compareAll ? (
                  <g>
                    <path
                      d={toSvgPath(simData.g40Poly)}
                      fill="none"
                      stroke="#a78bfa"
                      strokeWidth={2}
                      strokeDasharray="6 6"
                      opacity={0.75}
                    />
                    <path
                      d={toSvgPath(simData.g42Poly)}
                      fill="none"
                      stroke="#fb7185"
                      strokeWidth={2.2}
                      strokeDasharray="8 6"
                      opacity={0.8}
                    />
                    <path
                      d={toSvgPath(simData.g41Poly)}
                      fill="none"
                      stroke="#2dd4bf"
                      strokeWidth={2.4}
                      opacity={0.85}
                    />
                  </g>
                ) : (
                  <path
                    d={toSvgPath(
                      comp.mode === "G41" ? simData.g42Poly : simData.g41Poly
                    )}
                    fill="none"
                    stroke="rgba(251,113,133,0.28)"
                    strokeWidth={1.6}
                    strokeDasharray="6 7"
                  />
                )}

                {/* خط هدف عملیات فعلی (در سناریوهای آزمایشگاه یا هایلایت پروفیل هدف عملیات) */}
                <path
                  d={toSvgPath(simData.basePoly)}
                  fill="none"
                  stroke={
                    scenario === "project"
                      ? isInnerOp
                        ? "#f472b6"
                        : "#f59e0b"
                      : "#f59e0b"
                  }
                  strokeWidth={3.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* مسیر فعال مرجع ابزار (خروجی دقیق X/Y جی‌کد، منطبق بر پنجره اصلی طراحی پروفایل) */}
                <path
                  d={toSvgPath(simData.activePoly)}
                  fill="none"
                  stroke={
                    comp.mode === "G41"
                      ? "#2dd4bf"
                      : comp.mode === "G42"
                      ? "#fb7185"
                      : "#a78bfa"
                  }
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* بردارهای فاصله و نرمال در نقطه فعلی */}
                <g>
                  <line
                    x1={baseScreen[0]}
                    y1={baseScreen[1]}
                    x2={refScreen[0]}
                    y2={refScreen[1]}
                    stroke="#e2e8f0"
                    strokeWidth={1.6}
                    strokeDasharray="4 4"
                  />
                  <circle cx={baseScreen[0]} cy={baseScreen[1]} r={4.5} fill="#f59e0b" />
                  <circle cx={contactScreen[0]} cy={contactScreen[1]} r={5} fill="#22c55e" />
                  <text
                    x={(baseScreen[0] + refScreen[0]) / 2 + 10}
                    y={(baseScreen[1] + refScreen[1]) / 2 - 8}
                    fill="#e8eef7"
                    fontSize={12}
                    fontWeight={700}
                  >
                    Δ = {len(curPt.contact).toFixed(2)} mm
                  </text>
                </g>

                {/* شکل ابزار، نقطه مرجع (0,0) و بردار سرعت */}
                <g>
                  <path
                    d={toSvgPath(toolWorldPoly, true)}
                    fill="rgba(56,189,248,0.20)"
                    stroke="#38bdf8"
                    strokeWidth={2.4}
                  />
                  {/* نقطه تماس سبز */}
                  <circle
                    cx={contactScreen[0]}
                    cy={contactScreen[1]}
                    r={5.5}
                    fill="#22c55e"
                    stroke="#062814"
                    strokeWidth={2}
                  />
                  {/* نقطه مرجع ابزار (مرکز ابزار یا نوک ابزار) */}
                  <circle
                    cx={refScreen[0]}
                    cy={refScreen[1]}
                    r={5.5}
                    fill="#e8eef7"
                    stroke="#0b0e13"
                    strokeWidth={2}
                  />
                  <line
                    x1={refScreen[0] - 9}
                    y1={refScreen[1]}
                    x2={refScreen[0] + 9}
                    y2={refScreen[1]}
                    stroke="#e8eef7"
                    strokeWidth={1.4}
                  />
                  <line
                    x1={refScreen[0]}
                    y1={refScreen[1] - 9}
                    x2={refScreen[0]}
                    y2={refScreen[1] + 9}
                    stroke="#e8eef7"
                    strokeWidth={1.4}
                  />
                  {/* بردار جهت حرکت در فضای صفحه */}
                  <line
                    x1={refScreen[0]}
                    y1={refScreen[1]}
                    x2={refScreen[0] + moveDir[0] * 36}
                    y2={refScreen[1] - moveDir[1] * 36}
                    stroke="#38bdf8"
                    strokeWidth={2.2}
                  />
                  <text
                    x={refScreen[0] + 12}
                    y={refScreen[1] - 12}
                    fill="#e8eef7"
                    fontSize={12}
                    fontWeight={700}
                  >
                    {comp.machine === "mill" ? "مرکز ابزار (X,Y)" : "نوک ابزار (X,Y)"}
                  </text>
                </g>
              </svg>

              {/* دکمه‌های بزرگ‌نمایی روی بوم */}
              <div className="absolute top-3 left-3 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setView((v) => ({ ...v, scale: clamp(v.scale * 1.2, 0.4, 120) }))}
                  className="px-2.5 py-1 rounded-lg border border-[#2d384c] bg-[#121720]/90 text-xs font-bold text-[#e8eef7] hover:border-[#38bdf8]"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => setView((v) => ({ ...v, scale: clamp(v.scale / 1.2, 0.4, 120) }))}
                  className="px-2.5 py-1 rounded-lg border border-[#2d384c] bg-[#121720]/90 text-xs font-bold text-[#e8eef7] hover:border-[#38bdf8]"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => setView(computeFitView(scenario))}
                  className="px-2.5 py-1 rounded-lg border border-[#2d384c] bg-[#121720]/90 text-[11px] text-[#92a0b8] hover:text-white"
                >
                  بازنشانی نما
                </button>
                <button
                  type="button"
                  onClick={() => setCompareAll((v) => !v)}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold transition ${
                    compareAll
                      ? "border-[#38bdf8] bg-[#38bdf8]/20 text-[#38bdf8]"
                      : "border-[#2d384c] bg-[#121720]/90 text-[#92a0b8]"
                  }`}
                >
                  مقایسه هر سه حالت
                </button>
              </div>
            </div>

            {/* نوار کنترل پخش انیمیشن */}
            <div className="flex flex-wrap items-center gap-3 px-3 py-2 rounded-xl border border-[#253042] bg-[#121720]">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPlaying((p) => !p)}
                  className="px-3 py-1.5 rounded-lg border border-[#38bdf8]/50 bg-[#38bdf8]/15 text-[#38bdf8] text-xs font-bold"
                >
                  {playing ? "توقف موقت" : "اجرای حرکت"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    setProgress((prev) => clamp(prev + 0.5 / simData.totalLen, 0, 1));
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-[#253042] bg-[#171e2a] hover:bg-[#1e293b] text-xs text-[#e8eef7]"
                >
                  گام +0.5mm
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    setProgress(0);
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-[#253042] bg-[#171e2a] hover:bg-[#1e293b] text-xs text-[#92a0b8]"
                >
                  ابتدا
                </button>
              </div>

              <div className="flex-1 flex items-center gap-2 min-w-[180px]">
                <span className="text-[11px] text-[#92a0b8] shrink-0">موقعیت مسیر</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  value={progress}
                  onChange={(e) => {
                    setPlaying(false);
                    setProgress(parseFloat(e.target.value));
                  }}
                  className="flex-1 accent-[#2dd4bf]"
                />
                <span className="text-[11px] font-mono text-[#2dd4bf] w-10 text-left">
                  {Math.round(progress * 100)}%
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[#92a0b8]">سرعت:</span>
                {[0.5, 1, 2, 4].map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => setSpeed(sp)}
                    className={`px-2 py-1 rounded text-[11px] font-mono border ${
                      speed === sp
                        ? "border-[#38bdf8] bg-[#38bdf8]/15 text-[#38bdf8]"
                        : "border-[#253042] bg-[#171e2a] text-[#92a0b8]"
                    }`}
                  >
                    {sp}×
                  </button>
                ))}
              </div>
            </div>

            {/* ۴ کارت تحلیل زنده (منطبق بر cnc-simulato.html) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="rounded-xl border border-[#253042] bg-[#121720] p-2.5">
                <div className="text-[11px] text-[#92a0b8]">مختصات مرجع ابزار (X / Y)</div>
                <div className="text-xs font-mono font-bold text-[#e8eef7] mt-1" dir="ltr">
                  X={curPt.p[0].toFixed(2)} , Y={curPt.p[1].toFixed(2)}
                </div>
              </div>
              <div className="rounded-xl border border-[#253042] bg-[#121720] p-2.5">
                <div className="text-[11px] text-[#92a0b8]">فاصله عمودی از خط برنامه</div>
                <div className="text-xs font-mono font-bold text-[#2dd4bf] mt-1" dir="ltr">
                  {verticalDelta >= 0 ? "+" : ""}
                  {verticalDelta.toFixed(2)} mm
                </div>
              </div>
              <div className="rounded-xl border border-[#253042] bg-[#121720] p-2.5">
                <div className="text-[11px] text-[#92a0b8]">شاخه تماس هندسی</div>
                <div className="text-xs font-bold text-[#38bdf8] mt-1 truncate">
                  {contactBranchLabel}
                </div>
              </div>
              <div className="rounded-xl border border-[#253042] bg-[#121720] p-2.5">
                <div className="text-[11px] text-[#92a0b8]">مساحت برداشت تقریبی</div>
                <div className="text-xs font-mono font-bold text-[#f59e0b] mt-1" dir="ltr">
                  {sweptAreaApprox.toFixed(1)} mm²
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};
