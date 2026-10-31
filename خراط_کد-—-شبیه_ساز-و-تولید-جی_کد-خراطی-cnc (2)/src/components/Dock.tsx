import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "../utils/cn";
import { IconMinus, IconPlus, IconReset, IconWindow, IconX } from "./icons";

/* ---------- مدل چیدمان ---------- */

export type PanelId = "controls" | "view3d" | "editor" | "gcode";

export interface PanelState {
  open: boolean;
  collapsed: boolean;
  size: number; // عرض (px) در چیدمان دسکتاپ — برای پنل‌های کناری
}

export type LayoutState = Record<PanelId, PanelState> & {
  order: PanelId[];
};

/* چیدمان پیش‌فرض در RTL (از راست به چپ): تنظیمات ← نمای سه‌بعدی ← طراحی پروفایل ← جی‌کد */
export const PANEL_IDS: PanelId[] = ["controls", "view3d", "editor", "gcode"];

export const MIN_PANEL = 150;
export const MAX_PANEL = 640;
export const MIN_EDITOR_W = 180;
export const MAX_UNBOUNDED_PANEL = 4096;

/* محدودیت حداقل و حداکثر عرض هر پنل: نمای سه‌بعدی دقیقاً هم‌اندازه با پنجرهٔ طراحی پروفایل است */
export function panelMinWidth(id: PanelId): number {
  return id === "editor" || id === "view3d" ? MIN_EDITOR_W : MIN_PANEL;
}

export function panelMaxWidth(id: PanelId): number {
  return id === "editor" || id === "view3d" ? MAX_UNBOUNDED_PANEL : MAX_PANEL;
}

export function defaultLayout(): LayoutState {
  return {
    controls: { open: true, collapsed: false, size: 256 },
    view3d: { open: true, collapsed: false, size: 330 },
    editor: { open: true, collapsed: false, size: 0 },
    gcode: { open: true, collapsed: false, size: 290 },
    order: [...PANEL_IDS],
  };
}

/* ادغام امن چیدمان ذخیره‌شده با پیش‌فرض (مقاوم در برابر داده خراب/قدیمی) */
export function normalizeLayout(saved: unknown): LayoutState {
  const out = defaultLayout();
  if (!saved || typeof saved !== "object") return out;
  const rec = saved as Record<string, unknown>;
  for (const id of PANEL_IDS) {
    const s = rec[id];
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    if (typeof o.open === "boolean") out[id].open = o.open;
    if (typeof o.collapsed === "boolean") out[id].collapsed = o.collapsed;
    if (typeof o.size === "number" && Number.isFinite(o.size))
      out[id].size = Math.min(panelMaxWidth(id), Math.max(panelMinWidth(id), Math.round(o.size)));
  }
  if (Array.isArray(rec.order)) {
    const valid = rec.order.filter((x): x is PanelId => typeof x === "string" && (PANEL_IDS as string[]).includes(x));
    const unique = Array.from(new Set(valid));
    for (const id of PANEL_IDS) {
      if (!unique.includes(id)) unique.push(id);
    }
    out.order = unique;
  }
  return out;
}

/* ---------- قاب پنل: نوار عنوان قابل‌درگ + جمع‌شدن + بستن ---------- */

interface DockPanelProps {
  panelId: PanelId;
  title: string;
  icon?: ReactNode;
  state: PanelState;
  onCollapse: () => void;
  onClose: () => void;
  /** عرض ثابت در دسکتاپ (فقط پنل‌های کناری) */
  widthPx?: number;
  /** ترتیب نمایش در فلکس برای جابه‌جایی بدون بازسازی DOM */
  orderIndex?: number;
  isDragSource?: boolean;
  isDropTarget?: boolean;
  onHeaderDragStart?: (id: PanelId, e: React.PointerEvent<HTMLElement>) => void;
  /** کلاس‌های ساختاری — هم در حالت باز هم جمع‌شده */
  className?: string;
  /** کلاس‌های اضافی فقط در حالت باز (ارتفاع موبایل، flex و...) */
  expandedClassName?: string;
  children: ReactNode;
}

export function DockPanel({
  panelId,
  title,
  icon,
  state,
  onCollapse,
  onClose,
  widthPx,
  orderIndex,
  isDragSource = false,
  isDropTarget = false,
  onHeaderDragStart,
  className,
  expandedClassName,
  children,
}: DockPanelProps) {
  const collapsedDragRef = useRef<{ x: number; y: number; dragged: boolean } | null>(null);

  if (!state.open) return null;

  /* نوار باریکِ جمع‌شده: کلیک = باز شدن، کشیدن = جابه‌جایی پنجره */
  if (state.collapsed) {
    return (
      <button
        type="button"
        data-dock-panel-id={panelId}
        style={orderIndex != null ? { order: orderIndex } : undefined}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          collapsedDragRef.current = { x: e.clientX, y: e.clientY, dragged: false };
          onHeaderDragStart?.(panelId, e);
        }}
        onPointerMove={(e) => {
          const st = collapsedDragRef.current;
          if (st && !st.dragged && Math.hypot(e.clientX - st.x, e.clientY - st.y) >= 5) {
            st.dragged = true;
          }
        }}
        onClick={(e) => {
          if (collapsedDragRef.current?.dragged) {
            e.preventDefault();
            collapsedDragRef.current = null;
            return;
          }
          collapsedDragRef.current = null;
          onCollapse();
        }}
        title={`${title} — کلیک: باز کردن | کشیدن: جابه‌جایی`}
        className={cn(
          "group relative flex shrink-0 grow-0 cursor-pointer touch-none select-none items-center gap-2 rounded-lg border border-edge bg-panel px-3 py-2 transition-colors hover:border-brass/50",
          "min-[56rem]:h-full min-[56rem]:w-11 min-[56rem]:flex-col min-[56rem]:justify-start min-[56rem]:px-0 min-[56rem]:py-2",
          isDragSource && "opacity-65 ring-1 ring-brass/50",
          isDropTarget && "border-brass bg-brass/15 ring-2 ring-brass",
          className
        )}
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded text-dim transition-colors group-hover:text-brass2">
          <IconPlus className="h-4 w-4" />
        </span>
        <span className="truncate text-[12px] font-bold text-mute transition-colors group-hover:text-ink min-[56rem]:[writing-mode:vertical-rl]">
          {title}
        </span>
      </button>
    );
  }

  const sectionStyle: CSSProperties = {
    ...(widthPx != null ? ({ "--dock-w": `${Math.round(widthPx)}px` } as CSSProperties) : {}),
    ...(orderIndex != null ? { order: orderIndex } : {}),
  };

  return (
    <section
      data-dock-panel-id={panelId}
      style={sectionStyle}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-col gap-1.5",
        widthPx != null && "min-[56rem]:w-[var(--dock-w)] min-[56rem]:shrink-0",
        isDragSource && "opacity-70",
        className,
        expandedClassName
      )}
    >
      <div
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
          onHeaderDragStart?.(panelId, e);
        }}
        title="برای جابه‌جایی پنجره، نوار بالا را بکشید و روی پنجرهٔ دیگر رها کنید"
        className={cn(
          "flex h-8 shrink-0 cursor-grab touch-none select-none items-center gap-1.5 rounded-lg border bg-panel2/70 px-2 transition-colors active:cursor-grabbing",
          isDropTarget ? "border-brass bg-brass/15" : isDragSource ? "border-brass/60" : "border-edge hover:border-edge2"
        )}
      >
        <span className="grid h-4 w-3 shrink-0 place-items-center text-dim/70" aria-hidden="true">
          <svg viewBox="0 0 8 14" className="h-3 w-2" fill="currentColor">
            <circle cx="2" cy="2.5" r="1.1" />
            <circle cx="6" cy="2.5" r="1.1" />
            <circle cx="2" cy="7" r="1.1" />
            <circle cx="6" cy="7" r="1.1" />
            <circle cx="2" cy="11.5" r="1.1" />
            <circle cx="6" cy="11.5" r="1.1" />
          </svg>
        </span>
        {icon && <span className="grid h-5 w-5 shrink-0 place-items-center text-brass">{icon}</span>}
        <h2 className="truncate text-[12px] font-bold text-mute">{title}</h2>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onCollapse}
          title="جمع‌کردن پنل"
          className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded text-dim transition-colors hover:bg-panel3 hover:text-ink"
        >
          <IconMinus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          title="بستن پنل (بازگشایی از منوی پنجره)"
          className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded text-dim transition-colors hover:bg-panel3 hover:text-danger"
        >
          <IconX className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
      {isDropTarget && (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center rounded-lg border-2 border-brass bg-brass/10 backdrop-blur-[1px]">
          <span className="rounded-md border border-brass/70 bg-panel/95 px-3 py-1.5 text-[11.5px] font-bold text-brass2 shadow-lg">
            رها کنید تا جای پنجره‌ها عوض شود
          </span>
        </div>
      )}
    </section>
  );
}

/* ---------- جداکننده کشویی بین دو پنل (تغییر اندازه با درگ بدون پرش) ---------- */

interface DockSplitterProps {
  onResize: (dxPx: number) => void;
  onResetSize?: () => void;
  orderIndex?: number;
  title?: string;
  className?: string;
}

export function DockSplitter({ onResize, onResetSize, orderIndex, title, className }: DockSplitterProps) {
  const dragX = useRef<number | null>(null);
  const pendingDx = useRef(0);
  const rafRef = useRef<number | null>(null);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const [dragging, setDragging] = useState(false);

  const flush = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const step = Math.trunc(pendingDx.current);
    pendingDx.current = 0;
    if (step !== 0) onResizeRef.current(step);
  };

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      style={orderIndex != null ? { order: orderIndex } : undefined}
      title={title ?? "تغییر اندازه (دابل‌کلیک: اندازه پیش‌فرض)"}
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        dragX.current = e.clientX;
        pendingDx.current = 0;
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (dragX.current == null) return;
        const dx = e.clientX - dragX.current;
        dragX.current = e.clientX;
        if (dx === 0) return;
        pendingDx.current += dx;
        if (rafRef.current == null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            const step = Math.trunc(pendingDx.current);
            pendingDx.current -= step;
            if (step !== 0) onResizeRef.current(step);
          });
        }
      }}
      onPointerUp={() => {
        flush();
        dragX.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        flush();
        dragX.current = null;
        setDragging(false);
      }}
      onDoubleClick={onResetSize}
      className={cn(
        "group hidden w-[9px] shrink-0 cursor-col-resize touch-none select-none items-stretch justify-center min-[56rem]:flex",
        className
      )}
    >
      <div
        className={cn(
          "mx-auto w-px transition-colors",
          dragging ? "bg-brass" : "bg-edge group-hover:bg-brass/70"
        )}
      />
    </div>
  );
}

/* ---------- منوی شناور پنجره ---------- */

export type PanelVis = "open" | "collapsed" | "closed";

export interface WindowMenuItem {
  id: PanelId;
  label: string;
  vis: PanelVis;
}

interface WindowMenuProps {
  items: WindowMenuItem[];
  onToggle: (id: PanelId) => void;
  onReset: () => void;
}

const VIS_DOT: Record<PanelVis, string> = {
  open: "bg-ok",
  collapsed: "bg-brass",
  closed: "bg-dim/40",
};

const VIS_TEXT: Record<PanelVis, string> = {
  open: "باز",
  collapsed: "جمع‌شده",
  closed: "بسته",
};

export function WindowMenu({ items, onToggle, onReset }: WindowMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="btn !px-2.5 !py-1.5 text-[11.5px]"
        onClick={() => setMenuOpen((o) => !o)}
        title="نمایش / پنهان کردن پنجره‌ها"
      >
        <IconWindow className="h-3.5 w-3.5" />
        پنجره
      </button>
      {menuOpen && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-60 rounded-lg border border-edge bg-panel/95 p-1.5 shadow-xl shadow-black/50 backdrop-blur">
          <div className="px-2 pb-1 pt-0.5 text-[10.5px] font-bold text-dim">پنجره‌ها</div>
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onToggle(it.id)}
              title={it.vis === "closed" ? "باز کردن پنجره" : "بستن پنجره"}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-right text-[12.5px] text-ink transition-colors hover:bg-panel3"
            >
              <span className={cn("h-2 w-2 shrink-0 rounded-full", VIS_DOT[it.vis])} />
              <span className="flex-1 truncate">{it.label}</span>
              <span className="shrink-0 text-[10px] text-dim">{VIS_TEXT[it.vis]}</span>
            </button>
          ))}
          <div className="my-1 h-px bg-edge" />
          <button
            type="button"
            onClick={() => {
              onReset();
              setMenuOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-right text-[12.5px] text-mute transition-colors hover:bg-panel3 hover:text-ink"
          >
            <IconReset className="h-3.5 w-3.5" />
            بازنشانی چیدمان
          </button>
        </div>
      )}
    </div>
  );
}
