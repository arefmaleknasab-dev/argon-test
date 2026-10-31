import { Component, type ErrorInfo, type ReactNode } from "react";

interface RootProps {
  children: ReactNode;
}

interface RootState {
  error: Error | null;
}

export class RootErrorBoundary extends Component<RootProps, RootState> {
  state: RootState = { error: null };

  static getDerivedStateFromError(error: Error): RootState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[KharraatCode RootErrorBoundary]", error, info);
  }

  private handleRecover = () => {
    this.setState({ error: null });
  };

  private handleResetLayoutAndRecover = () => {
    try {
      const raw = localStorage.getItem("kharraatcode-v1");
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        delete parsed.layout;
        localStorage.setItem("kharraatcode-v1", JSON.stringify(parsed));
      }
    } catch {
      /* ignore */
    }
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fixed inset-0 z-[999] grid place-items-center bg-bg p-6 text-ink" dir="rtl">
        <div className="w-full max-w-md rounded-xl border border-brass/50 bg-panel p-6 shadow-2xl">
          <h2 className="text-base font-bold text-brass2">خطای غیرمنتظره در نمایش پنجره‌ها</h2>
          <p className="mt-2.5 text-xs leading-6 text-mute">
            یک خطای موقت در رابط کاربری رخ داد، اما اطلاعات طراحی شما محفوظ است. برای بازگردانی فوری پنجره‌ها یکی از گزینه‌های زیر را بزنید:
          </p>
          <p dir="ltr" className="mt-3 max-h-20 overflow-auto rounded border border-edge bg-bg/80 p-2 font-mono text-[10px] text-dim">
            {this.state.error.message || "Unexpected UI error"}
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={this.handleResetLayoutAndRecover}
              className="rounded-md border border-edge2 bg-panel2 px-3.5 py-2 text-xs font-semibold text-ink hover:border-brass/60"
            >
              بازنشانی چیدمان پنجره‌ها
            </button>
            <button
              type="button"
              onClick={this.handleRecover}
              className="rounded-md bg-brass px-4 py-2 text-xs font-bold text-[#241a0c] hover:bg-brass2"
            >
              بازگردانی پنجره‌ها
            </button>
          </div>
        </div>
      </div>
    );
  }
}

interface PanelProps {
  panelTitle: string;
  children: ReactNode;
}

interface PanelState {
  error: Error | null;
}

export class PanelErrorBoundary extends Component<PanelProps, PanelState> {
  state: PanelState = { error: null };

  static getDerivedStateFromError(error: Error): PanelState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[KharraatCode PanelErrorBoundary: ${this.props.panelTitle}]`, error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-full min-h-[140px] w-full place-items-center rounded-lg border border-edge bg-panel p-4 text-center" dir="rtl">
        <div className="max-w-xs">
          <p className="text-xs font-bold text-brass2">خطا در بارگذاری پنجره «{this.props.panelTitle}»</p>
          <p className="mt-1.5 text-[11px] leading-5 text-mute">سایر پنجره‌های نرم‌افزار فعال هستند. برای بازسازی این پنجره دکمه زیر را بزنید.</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="btn btn-brass mx-auto mt-3 !px-3.5 !py-1.5 text-xs"
          >
            تلاش مجدد
          </button>
        </div>
      </div>
    );
  }
}
