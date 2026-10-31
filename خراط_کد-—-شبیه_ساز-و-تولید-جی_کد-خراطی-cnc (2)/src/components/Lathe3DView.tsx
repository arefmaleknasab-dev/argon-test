import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { SketchSeg } from "../lib/sketch";
import { chainPolyline, orderChain } from "../lib/sketch";
import { DEFAULT_THEME_COLORS, hexToRgb01, type ThemeColors } from "../lib/theme";

/* ------------------------------------------------------------------ */
/*  نمای سه‌بعدی حرفه‌ای تراش (Lathe) — WebGL2 خام، بدون وابستگی خارجی    */
/*  پروفایل طراحی‌شده (z, r) حول محور تراش دوران داده می‌شود و با هر       */
/*  تغییر طرح در لحظه بازسازی می‌شود.                                    */
/* ------------------------------------------------------------------ */

interface Props {
  /** شناسه پروژه برای حفظ سبک وضعیت دوربین/گزینه‌ها هنگام بستن و باز کردن پنل */
  projectId?: string;
  /** اسکچ زنده (در حالت ویرایش مسیر: اسکچ پیش‌نویس) */
  sketch: SketchSeg[];
  blankD: number;
  blankL: number;
  /** حالت کاسه (Split): دیوارهٔ دوجداره است و سر قطعه درپوش ندارد */
  split: boolean;
  /** پالت رنگ فعال نرم‌افزار */
  themeColors?: ThemeColors;
}

interface P2 {
  z: number;
  r: number;
}

/* ---------- ساخت پروفایل ---------- */
function buildProfile(sketch: SketchSeg[], blankR: number, blankL: number): P2[] {
  if (!sketch.length) return [];
  const poly = chainPolyline(orderChain(sketch));
  const out: P2[] = [];
  for (const p of poly) {
    if (!Number.isFinite(p.z) || !Number.isFinite(p.r)) continue;
    const q = { z: Math.min(blankL, Math.max(0, p.z)), r: Math.min(blankR, Math.max(0, Math.abs(p.r))) };
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.z - q.z, last.r - q.r) > 1e-6) out.push(q);
  }
  return out;
}

/* ---------- ساخت مش دورانی ---------- */
interface Mesh {
  verts: Float32Array; // pos3 + normal3
  tris: Uint32Array;
  wire: Uint32Array;
  triCount: number;
  segCount: number;
}

interface Seg {
  az: number;
  ar: number;
  bz: number;
  br: number;
  na: [number, number];
  nb: [number, number];
}

const EMPTY_MESH: Mesh = { verts: new Float32Array(0), tris: new Uint32Array(0), wire: new Uint32Array(0), triCount: 0, segCount: 0 };

function buildMesh(prof: P2[], cx: number, caps: boolean): Mesh {
  if (prof.length < 2) return EMPTY_MESH;
  const raw: { dz: number; dr: number; n: [number, number] }[] = [];
  for (let i = 0; i < prof.length - 1; i++) {
    const dz = prof[i + 1].z - prof[i].z;
    const dr = prof[i + 1].r - prof[i].r;
    const len = Math.hypot(dz, dr) || 1;
    raw.push({ dz, dr, n: [dr / len, -dz / len] });
  }
  const COS_SMOOTH = 0.766; // ≈ 40°: زاویه‌های تندتر، لبهٔ تیز می‌مانند
  const joined = (a: [number, number], b: [number, number]): [number, number] => {
    if (a[0] * b[0] + a[1] * b[1] < COS_SMOOTH) return b;
    const x = a[0] + b[0];
    const y = a[1] + b[1];
    const l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  };
  const segs: Seg[] = [];
  for (let i = 0; i < raw.length; i++) {
    const n = raw[i].n;
    segs.push({
      az: prof[i].z,
      ar: prof[i].r,
      bz: prof[i + 1].z,
      br: prof[i + 1].r,
      na: i > 0 ? joined(raw[i - 1].n, n) : n,
      nb: i < raw.length - 1 ? joined(raw[i + 1].n, n) : n,
    });
  }
  if (caps) {
    const f = prof[0];
    const l = prof[prof.length - 1];
    if (f.r > 1e-6) segs.push({ az: f.z, ar: 0, bz: f.z, br: f.r, na: [-1, 0], nb: [-1, 0] });
    if (l.r > 1e-6) segs.push({ az: l.z, ar: 0, bz: l.z, br: l.r, na: [1, 0], nb: [1, 0] });
  }
  const active = segs.filter((s) => s.ar > 1e-6 || s.br > 1e-6);
  if (!active.length) return EMPTY_MESH;

  const N = Math.max(32, Math.min(128, Math.floor(200000 / active.length)));
  const rowLen = N + 1;
  const verts = new Float32Array(active.length * 2 * rowLen * 6);
  const tris = new Uint32Array(active.length * N * 6);
  const ringStep = Math.max(1, Math.ceil(active.length / 60));
  const lonStep = Math.max(1, Math.floor(N / 24));
  const wire: number[] = [];
  const cos = new Float32Array(rowLen);
  const sin = new Float32Array(rowLen);
  for (let j = 0; j <= N; j++) {
    const t = (j / N) * Math.PI * 2;
    cos[j] = Math.cos(t);
    sin[j] = Math.sin(t);
  }
  let vo = 0;
  let to = 0;
  active.forEach((s, si) => {
    const base = si * 2 * rowLen;
    const rows: [number, number, [number, number]][] = [
      [s.az, s.ar, s.na],
      [s.bz, s.br, s.nb],
    ];
    for (const [z, r, n] of rows) {
      for (let j = 0; j <= N; j++) {
        verts[vo++] = z - cx;
        verts[vo++] = r * cos[j];
        verts[vo++] = r * sin[j];
        verts[vo++] = n[0];
        verts[vo++] = n[1] * cos[j];
        verts[vo++] = n[1] * sin[j];
      }
    }
    for (let j = 0; j < N; j++) {
      const a0 = base + j;
      const a1 = a0 + 1;
      const b0 = base + rowLen + j;
      const b1 = b0 + 1;
      tris[to++] = a0;
      tris[to++] = b0;
      tris[to++] = a1;
      tris[to++] = a1;
      tris[to++] = b0;
      tris[to++] = b1;
      if (si % ringStep === 0) {
        wire.push(a0, a1);
        if (si === active.length - 1) wire.push(b0, b1);
      }
      if (j % lonStep === 0) wire.push(a0, b0);
    }
  });
  return { verts, tris, wire: new Uint32Array(wire), triCount: to, segCount: active.length };
}

/* ---------- ریاضیات ماتریس (column-major) ---------- */
type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
function perspective(fovy: number, aspect: number, n: number, f: number) {
  const t = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = t / aspect;
  m[5] = t;
  m[10] = (f + n) / (n - f);
  m[11] = -1;
  m[14] = (2 * f * n) / (n - f);
  return m;
}
function lookAt(e: V3, c: V3, u: V3) {
  const z = norm(sub(e, c));
  const x = norm(cross(u, z));
  const y = cross(z, x);
  const m = new Float32Array(16);
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0];
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1];
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2];
  m[12] = -dot(x, e); m[13] = -dot(y, e); m[14] = -dot(z, e);
  m[15] = 1;
  return { m, right: x, up: y };
}
function mul(a: Float32Array, b: Float32Array) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}
function matRotZ(theta: number) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const m = new Float32Array(16);
  m[0] = c;
  m[1] = s;
  m[4] = -s;
  m[5] = c;
  m[10] = 1;
  m[15] = 1;
  return m;
}
function matTranslate(tx: number, ty: number, tz: number) {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  m[15] = 1;
  return m;
}

/* ---------- شیدرها ---------- */
const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
uniform mat4 uVP;
uniform mat4 uModel;
out vec3 vPos;
out vec3 vNor;
out vec3 vLoc;
void main(){
  vec4 wp = uModel * vec4(aPos, 1.0);
  vPos = wp.xyz;
  vNor = mat3(uModel) * aNor;
  vLoc = aPos;
  gl_Position = uVP * wp;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vNor;
in vec3 vLoc;
uniform vec3 uEye;
uniform float uCut;
uniform vec2 uCutCS;
uniform int uMode;
uniform vec4 uColor;
uniform vec3 uBaseColor;
uniform vec3 uRimColor;
out vec4 o;
void main(){
  if(uMode==1){ o=uColor; return; }
  if(uCut>0.5){
    float cu = vLoc.y * uCutCS.x + vLoc.z * uCutCS.y;
    float cv = -vLoc.y * uCutCS.y + vLoc.z * uCutCS.x;
    if(cu>0.0 && cv>0.0) discard;
  }
  vec3 n=normalize(vNor);
  vec3 v=normalize(uEye-vPos);
  if(dot(n,v)<0.0) n=-n;
  vec3 l1=normalize(vec3(-0.45,0.85,0.55));
  vec3 l2=normalize(vec3(0.75,0.25,-0.6));
  vec3 l3=normalize(vec3(0.0,-0.6,0.8));
  float d1=max(dot(n,l1),0.0);
  float d2=max(dot(n,l2),0.0);
  float d3=max(dot(n,l3),0.0);
  vec3 h=normalize(l1+v);
  float sp=pow(max(dot(n,h),0.0),56.0);
  vec3 h2=normalize(l2+v);
  float sp2=pow(max(dot(n,h2),0.0),32.0);
  vec3 r=reflect(-v,n);
  float e=smoothstep(-0.35,0.7,r.y);
  vec3 env=mix(vec3(0.07,0.06,0.05),vec3(0.62,0.66,0.72),e);
  float fres=pow(1.0-max(dot(n,v),0.0),3.0);
  vec3 base=uBaseColor;
  vec3 amb=mix(vec3(0.07,0.06,0.05),vec3(0.20,0.21,0.24),n.y*0.5+0.5);
  vec3 c=base*(amb+d1*0.62+d2*0.26+d3*0.12);
  c=mix(c,env*base*1.15,0.38);
  c+=vec3(1.0,0.97,0.9)*sp*0.55+vec3(0.8,0.9,1.0)*sp2*0.2;
  c+=uRimColor*fres*0.28;
  c=pow(c,vec3(0.93));
  o=vec4(c,1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader error");
  return s;
}

/* ---------- صحنهٔ کمکی: شبکهٔ کف، محور، قطعهٔ خام ---------- */
interface Scene {
  data: Float32Array;
  grid: [number, number];
  axis: [number, number];
  stock: [number, number];
}
function niceStep(size: number) {
  const raw = size / 10;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
function buildScene(blankD: number, blankL: number): Scene {
  const R = blankD / 2;
  const L = blankL;
  const out: number[] = [];
  const push = (...v: number[]) => out.push(...v);
  /* شبکهٔ کف (در ارتفاع پایه صفر؛ ارتفاع واقعی بر حسب چرخش قطعه در رندر اعمال می‌شود) */
  const step = niceStep(Math.max(L, blankD) * 1.6);
  const ext = Math.ceil((Math.max(L, blankD) * 1.1) / step) * step;
  const g0 = out.length / 3;
  for (let v = -ext; v <= ext + 1e-9; v += step) {
    push(-ext, 0, v, ext, 0, v);
    push(v, 0, -ext, v, 0, ext);
  }
  const grid: [number, number] = [g0, out.length / 3 - g0];
  /* محور تراش (خط‌چین) */
  const a0 = out.length / 3;
  const dash = Math.max(1, L / 60);
  for (let x = -L / 2 - L * 0.1; x < L / 2 + L * 0.1; x += dash * 2) push(x, 0, 0, Math.min(x + dash, L / 2 + L * 0.1), 0, 0);
  const axis: [number, number] = [a0, out.length / 3 - a0];
  /* قطعهٔ خام (سیم‌کشی) */
  const s0 = out.length / 3;
  const M = 72;
  for (const x of [-L / 2, L / 2])
    for (let j = 0; j < M; j++) {
      const t0 = (j / M) * Math.PI * 2;
      const t1 = ((j + 1) / M) * Math.PI * 2;
      push(x, R * Math.cos(t0), R * Math.sin(t0), x, R * Math.cos(t1), R * Math.sin(t1));
    }
  for (let k = 0; k < 8; k++) {
    const t = (k / 8) * Math.PI * 2;
    push(-L / 2, R * Math.cos(t), R * Math.sin(t), L / 2, R * Math.cos(t), R * Math.sin(t));
  }
  const stock: [number, number] = [s0, out.length / 3 - s0];
  return { data: new Float32Array(out), grid, axis, stock };
}

/* ---------- دوربین مدارگرد ---------- */
interface Cam {
  az: number;
  el: number;
  dist: number;
  tx: number;
  ty: number;
  tz: number;
}
const FOV = (38 * Math.PI) / 180;
const VIEWS: Record<string, { az: number; el: number }> = {
  iso: { az: 0.85, el: 0.42 },
  front: { az: 0, el: 0 },
  top: { az: 0, el: 1.55 },
  end: { az: Math.PI / 2, el: 0 },
};
function fitCam(blankD: number, blankL: number, view = VIEWS.iso): Cam {
  const rad = Math.max(0.5 * Math.hypot(blankL, blankD), 1);
  return { az: view.az, el: view.el, dist: (rad / Math.sin(FOV / 2)) * 1.08, tx: 0, ty: 0, tz: 0 };
}

interface GLState {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  vs: WebGLShader;
  fs: WebGLShader;
  u: Record<string, WebGLUniformLocation | null>;
  meshVao: WebGLVertexArrayObject;
  wireVao: WebGLVertexArrayObject;
  sceneVao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  wibo: WebGLBuffer;
  sbo: WebGLBuffer;
  triCount: number;
  wireCount: number;
}

type RotStep = 0 | 1 | 2 | 3;
const ROT_LABELS: Record<RotStep, string> = {
  0: "افقی (پیش‌فرض تراش)",
  1: "ایستاده (+۹۰°)",
  2: "افقی معکوس (۱۸۰°)",
  3: "عمودی معکوس (۲۷۰°)",
};

interface ViewOpts {
  wire: boolean;
  stock: boolean;
  cut: boolean;
  grid: boolean;
  axis: boolean;
}

const DEFAULT_OPTS: ViewOpts = { wire: false, stock: false, cut: false, grid: true, axis: false };

/* کش فوق‌سبک فقط برای زاویه دوربین و دکمه‌های نوار ابزار (بدون نگهداری مش یا WebGL در حافظه هنگام بسته‌بودن پنل) */
const SAVED_VIEW_STATE = new Map<
  string,
  { cam: Cam; opts: ViewOpts; rot: RotStep; blankD: number; blankL: number }
>();

function useLazyRef<T>(init: () => T): React.MutableRefObject<T> {
  const ref = useRef<T | null>(null);
  if (ref.current === null) ref.current = init();
  return ref as React.MutableRefObject<T>;
}

/* ================================================================== */
function Lathe3DViewInner({ projectId = "default", sketch, blankD, blankL, split, themeColors = DEFAULT_THEME_COLORS }: Props) {
  const savedInit = SAVED_VIEW_STATE.get(projectId);
  const sameBlank = savedInit != null && savedInit.blankD === blankD && savedInit.blankL === blankL;
  const initRot: RotStep = savedInit?.rot ?? 0;
  const themeRef = useRef(themeColors);
  themeRef.current = themeColors;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<GLState | null>(null);
  const camRef = useLazyRef<Cam>(() => (sameBlank && savedInit ? { ...savedInit.cam } : fitCam(blankD, blankL)));
  const sceneRef = useLazyRef<Scene>(() => buildScene(blankD, blankL));
  const prevBlankRef = useRef({ d: blankD, l: blankL });
  const optsRef = useRef<ViewOpts>(savedInit ? { ...savedInit.opts } : { ...DEFAULT_OPTS });
  const rotRef = useRef<RotStep>(initRot);
  const thetaRef = useRef(initRot * (Math.PI / 2));
  const cutAlphaRef = useRef(initRot === 1 || initRot === 2 ? Math.PI / 2 : 0);
  const animRef = useRef<{ fromTheta: number; toTheta: number; fromCut: number; toCut: number; t0: number } | null>(null);
  const blankDRef = useRef(blankD);
  const blankLRef = useRef(blankL);
  blankDRef.current = blankD;
  blankLRef.current = blankL;
  const rafRef = useRef<number | null>(null);
  const [opts, setOpts] = useState<ViewOpts>(optsRef.current);
  const [rot, setRot] = useState<RotStep>(initRot);
  const [error, setError] = useState<string | null>(null);
  optsRef.current = opts;

  /* ذخیرهٔ زاویه دوربین و تنظیمات سبک هنگام بسته‌شدن پنل تا با بازگشایی مجدد حفظ شوند */
  useEffect(() => {
    return () => {
      if (SAVED_VIEW_STATE.size >= 32 && !SAVED_VIEW_STATE.has(projectId)) {
        const oldest = SAVED_VIEW_STATE.keys().next().value;
        if (oldest !== undefined) SAVED_VIEW_STATE.delete(oldest);
      }
      SAVED_VIEW_STATE.set(projectId, {
        cam: { ...camRef.current },
        opts: { ...optsRef.current },
        rot: rotRef.current,
        blankD: blankDRef.current,
        blankL: blankLRef.current,
      });
    };
  }, [projectId, camRef]);

  const prof = useMemo(() => buildProfile(sketch, blankD / 2, blankL), [sketch, blankD, blankL]);
  const mesh = useMemo(() => buildMesh(prof, blankL / 2, !split), [prof, blankL, split]);
  const dims = useMemo(() => {
    if (prof.length < 2) return null;
    let maxR = 0;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of prof) {
      maxR = Math.max(maxR, p.r);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    return { d: maxR * 2, l: maxZ - minZ };
  }, [prof]);

  /* ---- رندر ---- */
  const draw = useCallback(() => {
    rafRef.current = null;
    const st = glRef.current;
    const canvas = canvasRef.current;
    if (!st || !canvas) return;
    const { gl, u } = st;
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return;

    let animating = false;
    const anim = animRef.current;
    if (anim) {
      const t = Math.min(1, Math.max(0, (performance.now() - anim.t0) / 220));
      const k = 1 - Math.pow(1 - t, 3);
      thetaRef.current = anim.fromTheta + (anim.toTheta - anim.fromTheta) * k;
      cutAlphaRef.current = anim.fromCut + (anim.toCut - anim.fromCut) * k;
      if (t >= 1) {
        thetaRef.current = rotRef.current * (Math.PI / 2);
        cutAlphaRef.current = rotRef.current === 1 || rotRef.current === 2 ? Math.PI / 2 : 0;
        animRef.current = null;
      } else {
        animating = true;
      }
    }

    const theta = thetaRef.current;
    const cutAlpha = cutAlphaRef.current;
    const partModel = matRotZ(theta);
    const halfL = blankLRef.current / 2;
    const radStock = blankDRef.current / 2;
    const floorY = -1.08 * (halfL * Math.abs(Math.sin(theta)) + radStock * Math.abs(Math.cos(theta)));
    const gridModel = matTranslate(0, floorY, 0);

    const cam = camRef.current;
    const o = optsRef.current;
    const ce = Math.cos(cam.el);
    const eye: V3 = [
      cam.tx + cam.dist * ce * Math.sin(cam.az),
      cam.ty + cam.dist * Math.sin(cam.el),
      cam.tz + cam.dist * ce * Math.cos(cam.az),
    ];
    const view = lookAt(eye, [cam.tx, cam.ty, cam.tz], [0, 1, 0]);
    const proj = perspective(FOV, w / h, Math.max(0.05, cam.dist * 0.02), cam.dist * 12 + 1000);
    const vp = mul(proj, view.m);

    const tc = themeRef.current;
    const [bgR, bgG, bgB] = hexToRgb01(tc.view3dBg);
    const [partR, partG, partB] = hexToRgb01(tc.view3dPart);
    const [rimR, rimG, rimB] = hexToRgb01(tc.view3dRim);
    const [wireR, wireG, wireB] = hexToRgb01(tc.view3dWire);
    const [axisR, axisG, axisB] = hexToRgb01(tc.view3dAxis);
    const [stockR, stockG, stockB] = hexToRgb01(tc.view3dStock);
    const [gridR, gridG, gridB] = hexToRgb01(tc.view3dGrid);

    gl.viewport(0, 0, w, h);
    gl.clearColor(bgR, bgG, bgB, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.useProgram(st.prog);
    gl.uniformMatrix4fv(u.uVP, false, vp);
    gl.uniformMatrix4fv(u.uModel, false, partModel);
    gl.uniform3f(u.uEye, eye[0], eye[1], eye[2]);
    gl.uniform1f(u.uCut, o.cut ? 1 : 0);
    gl.uniform2f(u.uCutCS, Math.cos(cutAlpha), Math.sin(cutAlpha));
    gl.uniform3f(u.uBaseColor, partR, partG, partB);
    gl.uniform3f(u.uRimColor, rimR, rimG, rimB);

    /* قطعه */
    gl.uniform1i(u.uMode, 0);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    gl.bindVertexArray(st.meshVao);
    if (st.triCount) gl.drawElements(gl.TRIANGLES, st.triCount, gl.UNSIGNED_INT, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(u.uMode, 1);
    if (o.wire && st.wireCount) {
      gl.uniform4f(u.uColor, wireR, wireG, wireB, 0.55);
      gl.bindVertexArray(st.wireVao);
      gl.drawElements(gl.LINES, st.wireCount, gl.UNSIGNED_INT, 0);
    }
    /* صحنهٔ کمکی */
    const sc = sceneRef.current;
    gl.bindVertexArray(st.sceneVao);
    if (o.axis) {
      gl.uniform4f(u.uColor, axisR, axisG, axisB, 0.78);
      gl.drawArrays(gl.LINES, sc.axis[0], sc.axis[1]);
    }
    if (o.stock) {
      gl.uniform4f(u.uColor, stockR, stockG, stockB, 0.45);
      gl.drawArrays(gl.LINES, sc.stock[0], sc.stock[1]);
    }
    if (o.grid) {
      gl.uniformMatrix4fv(u.uModel, false, gridModel);
      gl.uniform4f(u.uColor, gridR, gridG, gridB, 0.28);
      gl.drawArrays(gl.LINES, sc.grid[0], sc.grid[1]);
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);

    if (animating && rafRef.current == null) {
      rafRef.current = requestAnimationFrame(draw);
    }
  }, []);

  const requestRender = useCallback(() => {
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const [glEpoch, setGlEpoch] = useState(0);

  /* ---- راه‌اندازی WebGL ---- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const initGl = () => {
      const gl = canvas.getContext("webgl2", { antialias: true, alpha: false, preserveDrawingBuffer: true });
      if (!gl || gl.isContextLost()) {
        setError("WebGL2 در این مرورگر یا کارت گرافیک فعال نیست.");
        return;
      }
      try {
        const vs = compile(gl, gl.VERTEX_SHADER, VS);
        const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
        const prog = gl.createProgram();
        if (!prog) throw new Error("program allocation failed");
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link error");
        const u: Record<string, WebGLUniformLocation | null> = {};
        for (const n of ["uVP", "uModel", "uEye", "uCut", "uCutCS", "uMode", "uColor", "uBaseColor", "uRimColor"]) {
          u[n] = gl.getUniformLocation(prog, n);
        }

        const vbo = gl.createBuffer();
        const ibo = gl.createBuffer();
        const wibo = gl.createBuffer();
        const sbo = gl.createBuffer();
        if (!vbo || !ibo || !wibo || !sbo) throw new Error("buffer allocation failed");
        const mk = (index: WebGLBuffer) => {
          const vao = gl.createVertexArray();
          if (!vao) throw new Error("vao allocation failed");
          gl.bindVertexArray(vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
          gl.enableVertexAttribArray(0);
          gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
          gl.enableVertexAttribArray(1);
          gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
          return vao;
        };
        const meshVao = mk(ibo);
        const wireVao = mk(wibo);
        const sceneVao = gl.createVertexArray();
        if (!sceneVao) throw new Error("scene vao allocation failed");
        gl.bindVertexArray(sceneVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, sbo);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
        gl.vertexAttrib3f(1, 0, 1, 0);
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, sbo);
        if (sceneRef.current) {
          gl.bufferData(gl.ARRAY_BUFFER, sceneRef.current.data, gl.STATIC_DRAW);
        }

        glRef.current = { gl, prog, vs, fs, u, meshVao, wireVao, sceneVao, vbo, ibo, wibo, sbo, triCount: 0, wireCount: 0 };
        setError(null);
        setGlEpoch((v) => v + 1);
        requestRender();
      } catch (e) {
        setError("خطا در راه‌اندازی نمای سه‌بعدی: " + (e as Error).message);
      }
    };
    initGl();
    const lost = (e: Event) => {
      e.preventDefault();
      glRef.current = null;
      setError("ارتباط با کارت گرافیک موقتاً قطع شد؛ در حال بازیابی خودکار...");
    };
    const restored = () => {
      initGl();
    };
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    return () => {
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      animRef.current = null;
      const st = glRef.current;
      glRef.current = null;
      if (st) {
        st.gl.deleteVertexArray(st.meshVao);
        st.gl.deleteVertexArray(st.wireVao);
        st.gl.deleteVertexArray(st.sceneVao);
        st.gl.deleteBuffer(st.vbo);
        st.gl.deleteBuffer(st.ibo);
        st.gl.deleteBuffer(st.wibo);
        st.gl.deleteBuffer(st.sbo);
        st.gl.deleteProgram(st.prog);
        st.gl.deleteShader(st.vs);
        st.gl.deleteShader(st.fs);
        /* هنگام بسته‌شدن واقعی پنجره نمای سه‌بعدی (جداشدن بوم از DOM)، کانتکست WebGL و حافظه کارت گرافیک فوراً آزاد می‌شوند */
        if (!canvas.isConnected) {
          canvas.width = 0;
          canvas.height = 0;
          st.gl.getExtension("WEBGL_lose_context")?.loseContext();
        }
      }
    };
  }, [requestRender]);

  /* ---- آپلود مش (هر تغییر طرح = بازسازی لحظه‌ای) ---- */
  useEffect(() => {
    const st = glRef.current;
    if (!st) return;
    const { gl } = st;
    gl.bindBuffer(gl.ARRAY_BUFFER, st.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, st.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.tris, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, st.wibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.wire, gl.DYNAMIC_DRAW);
    st.triCount = mesh.triCount;
    st.wireCount = mesh.wire.length;
    requestRender();
  }, [mesh, requestRender, error, glEpoch]);

  /* ---- ابعاد خام عوض شد: صحنه و دوربین بازنشانی ---- */
  useEffect(() => {
    if (prevBlankRef.current.d === blankD && prevBlankRef.current.l === blankL) return;
    prevBlankRef.current = { d: blankD, l: blankL };
    sceneRef.current = buildScene(blankD, blankL);
    camRef.current = fitCam(blankD, blankL);
    const st = glRef.current;
    if (st) {
      st.gl.bindBuffer(st.gl.ARRAY_BUFFER, st.sbo);
      st.gl.bufferData(st.gl.ARRAY_BUFFER, sceneRef.current.data, st.gl.STATIC_DRAW);
    }
    requestRender();
  }, [blankD, blankL, requestRender, error]);

  useEffect(() => {
    requestRender();
  }, [opts, requestRender]);

  /* ---- اندازهٔ بوم ---- */
  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(wrap.clientWidth * dpr));
      const h = Math.max(1, Math.round(wrap.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        /* تغییر width/height بوم WebGL بافر رسم را در همان لحظه پاک می‌کند؛
           رسم هم‌زمان پیش از Paint مرورگر از هرگونه چشمک‌زدن جلوگیری می‌کند. */
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        draw();
        return;
      }
      requestRender();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw, requestRender]);

  /* ---- تعامل: چرخش / جابه‌جایی / زوم ---- */
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ptrs = new Map<number, { x: number; y: number; button: number }>();
    let pinch = 0;
    const clampCam = (c: Cam) => {
      c.el = Math.max(-1.55, Math.min(1.55, c.el));
      c.dist = Math.max(2, Math.min(20000, c.dist));
    };
    const pan = (dx: number, dy: number) => {
      const c = camRef.current;
      const ce = Math.cos(c.el);
      const eye: V3 = [c.dist * ce * Math.sin(c.az), c.dist * Math.sin(c.el), c.dist * ce * Math.cos(c.az)];
      const v = lookAt(eye, [0, 0, 0], [0, 1, 0]);
      const k = (2 * c.dist * Math.tan(FOV / 2)) / Math.max(1, canvas.clientHeight);
      c.tx += (-dx * v.right[0] + dy * v.up[0]) * k;
      c.ty += (-dx * v.right[1] + dy * v.up[1]) * k;
      c.tz += (-dx * v.right[2] + dy * v.up[2]) * k;
    };
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e: PointerEvent) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      const c = camRef.current;
      if (ptrs.size === 1) {
        if (p.button === 1 || p.button === 2 || e.shiftKey || e.ctrlKey) pan(dx, dy);
        else {
          c.az -= dx * 0.0074;
          c.el += dy * 0.0074;
        }
      } else if (ptrs.size === 2) {
        p.x = e.clientX;
        p.y = e.clientY;
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) c.dist *= pinch / d;
        pinch = d;
        pan(dx / 2, dy / 2);
      }
      p.x = e.clientX;
      p.y = e.clientY;
      clampCam(c);
      requestRender();
    };
    const up = (e: PointerEvent) => {
      ptrs.delete(e.pointerId);
      pinch = 0;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = camRef.current;
      const unit = e.deltaMode === 1 ? 33 : 1;
      c.dist *= Math.exp(e.deltaY * unit * 0.0013);
      clampCam(c);
      requestRender();
    };
    const dbl = () => {
      camRef.current = fitCam(blankDRef.current, blankLRef.current);
      requestRender();
    };
    const ctx = (e: Event) => e.preventDefault();
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("dblclick", dbl);
    canvas.addEventListener("contextmenu", ctx);
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("dblclick", dbl);
      canvas.removeEventListener("contextmenu", ctx);
    };
  }, [requestRender]);

  const applyRot = useCallback(
    (next: RotStep) => {
      rotRef.current = next;
      setRot(next);
      const targetTheta = next * (Math.PI / 2);
      const targetCut = next === 1 || next === 2 ? Math.PI / 2 : 0;
      const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        animRef.current = null;
        thetaRef.current = targetTheta;
        cutAlphaRef.current = targetCut;
      } else {
        const curT = thetaRef.current;
        const dT = Math.atan2(Math.sin(targetTheta - curT), Math.cos(targetTheta - curT));
        const curC = cutAlphaRef.current;
        const dC = Math.atan2(Math.sin(targetCut - curC), Math.cos(targetCut - curC));
        animRef.current = {
          fromTheta: curT,
          toTheta: curT + dT,
          fromCut: curC,
          toCut: curC + dC,
          t0: performance.now(),
        };
      }
      requestRender();
    },
    [requestRender]
  );

  const toggleUpright = () => applyRot(rot === 1 ? 0 : 1);
  const rotateStep = () => applyRot(((rot + 1) % 4) as RotStep);

  const setView = (name: keyof typeof VIEWS) => {
    let view = VIEWS[name];
    if (name === "end") {
      const r = rotRef.current;
      view =
        r === 0
          ? { az: Math.PI / 2, el: 0 }
          : r === 1
            ? { az: 0, el: 1.55 }
            : r === 2
              ? { az: -Math.PI / 2, el: 0 }
              : { az: 0, el: -1.55 };
    }
    camRef.current = fitCam(blankD, blankL, view);
    requestRender();
  };
  const toggle = (k: keyof typeof opts) => setOpts((o) => ({ ...o, [k]: !o[k] }));

  /* بازرندر لحظه‌ای هنگام تغییر رنگ‌های بخش سه‌بعدی در تنظیمات تم */
  useEffect(() => {
    requestRender();
  }, [
    themeColors.view3dBg,
    themeColors.view3dPart,
    themeColors.view3dRim,
    themeColors.view3dWire,
    themeColors.view3dStock,
    themeColors.view3dGrid,
    themeColors.view3dAxis,
    requestRender,
  ]);

  return (
    <div
      ref={wrapRef}
      dir="rtl"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 220,
        overflow: "hidden",
        borderRadius: 8,
        border: "1px solid var(--color-edge)",
        background: themeColors.view3dBg,
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", touchAction: "none", cursor: "grab" }} />

      <div style={{ position: "absolute", top: 8, right: 8, left: 8, display: "flex", flexWrap: "wrap", gap: 4, pointerEvents: "none" }}>
        <Group>
          <Btn onClick={() => setView("iso")} title="نمای ایزومتریک / بازنشانی دوربین">ایزو</Btn>
          <Btn onClick={() => setView("front")} title="نمای روبه‌رو">روبه‌رو</Btn>
          <Btn onClick={() => setView("top")} title="نمای از بالا">بالا</Btn>
          <Btn onClick={() => setView("end")} title="نمای از سر قطعه">سر قطعه</Btn>
        </Group>
        <Group>
          <Btn
            on={rot === 1}
            onClick={toggleUpright}
            title="ایستاده کردن قطعه با یک کلیک (کف پایین، دهانه رو به بالا) / بازگشت به افقی"
          >
            ایستاده
          </Btn>
          <Btn
            on={rot > 1}
            onClick={rotateStep}
            title={`چرخش ۹۰ درجه آبجکت — فعلی: ${ROT_LABELS[rot]}`}
          >
            {rot === 2 ? "↻ ۱۸۰°" : rot === 3 ? "↻ ۲۷۰°" : "↻ ۹۰°"}
          </Btn>
        </Group>
        <Group>
          <Btn on={opts.wire} onClick={() => toggle("wire")} title="نمایش مش سیمی">سیمی</Btn>
          <Btn on={opts.cut} onClick={() => toggle("cut")} title="برش ربع‌مقطع برای دیدن داخل قطعه">برش</Btn>
          <Btn on={opts.stock} onClick={() => toggle("stock")} title="قطعهٔ خام اولیه">خام</Btn>
          <Btn on={opts.grid} onClick={() => toggle("grid")} title="شبکهٔ کف">شبکه</Btn>
          <Btn on={opts.axis} onClick={() => toggle("axis")} title="خط‌چین محور مرکزی قطعه">محور</Btn>
        </Group>
      </div>

      {dims && (
        <div dir="ltr" style={{ ...chip, position: "absolute", bottom: 8, left: 8, fontFamily: "ui-monospace, Consolas, monospace" }}>
          Ø {dims.d.toFixed(2)} × L {dims.l.toFixed(2)} mm
        </div>
      )}
      <div style={{ ...chip, position: "absolute", bottom: 8, right: 8, color: "var(--color-dim)" }}>
        چپ: چرخش • راست: جابه‌جایی • چرخ: زوم • دابل‌کلیک: بازنشانی
      </div>

      {!error && !dims && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--color-mute)", fontSize: 12.5, pointerEvents: "none" }}>
          پروفایلی برای نمایش سه‌بعدی وجود ندارد — در پنجرهٔ طراحی پروفایل رسم کنید.
        </div>
      )}
      {error && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 16, textAlign: "center", color: "var(--color-danger)", fontSize: 12.5, background: themeColors.view3dBg }}>
          {error}
        </div>
      )}
    </div>
  );
}

const Lathe3DView = memo(Lathe3DViewInner);
export default Lathe3DView;

/* ---------- اجزای رابط ---------- */
const chip: CSSProperties = {
  padding: "3px 8px",
  borderRadius: 6,
  background: "rgba(var(--rgb-panel), .82)",
  border: "1px solid var(--color-edge)",
  fontSize: 10.5,
  color: "var(--color-mute)",
  pointerEvents: "none",
};
function Group({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, background: "rgba(var(--rgb-panel), .85)", border: "1px solid var(--color-edge)", pointerEvents: "auto", backdropFilter: "blur(4px)" }}>
      {children}
    </div>
  );
}
function Btn({ children, onClick, title, on }: { children: React.ReactNode; onClick: () => void; title?: string; on?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        padding: "3px 9px",
        borderRadius: 6,
        border: "none",
        cursor: "pointer",
        fontSize: 11,
        fontWeight: 700,
        fontFamily: "inherit",
        background: on ? "var(--color-brass)" : "transparent",
        color: on ? "var(--color-brass-ink)" : "var(--color-mute)",
      }}
    >
      {children}
    </button>
  );
}
