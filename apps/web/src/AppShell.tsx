import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  normalizeSidebarWidth,
  readSidebarPreference,
  writeSidebarPreference,
} from "./sidebar-preference.js";

type AppShellProps = {
  sidebar: ReactNode;
  children: ReactNode;
};

const KEYBOARD_RESIZE_STEP = 12;

export function AppShell({ sidebar, children }: AppShellProps) {
  const shellRef = useRef<HTMLElement>(null);
  const pendingWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const [preference, setPreference] = useState(readSidebarPreference);
  const [resizing, setResizing] = useState(false);

  pendingWidthRef.current = preference.width;

  function setSidebarWidth(width: number, persist: boolean): void {
    const normalized = normalizeSidebarWidth(width);
    pendingWidthRef.current = normalized;
    const next = { width: normalized, collapsed: false };
    setPreference(next);
    if (persist) writeSidebarPreference(next);
  }

  function collapseSidebar(): void {
    const next = { ...preference, collapsed: true };
    setPreference(next);
    writeSidebarPreference(next);
  }

  function expandSidebar(): void {
    const next = { ...preference, collapsed: false };
    setPreference(next);
    writeSidebarPreference(next);
  }

  function handleResizeStart(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    if (preference.collapsed || event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  }

  function handleResizeMove(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    if (!resizing) return;

    const shellLeft = shellRef.current?.getBoundingClientRect().left ?? 0;
    setSidebarWidth(event.clientX - shellLeft, false);
  }

  function handleResizeEnd(
    event: ReactPointerEvent<HTMLDivElement>,
  ): void {
    if (!resizing) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setResizing(false);
    writeSidebarPreference({
      width: pendingWidthRef.current,
      collapsed: false,
    });
  }

  function handleResizeKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void {
    let nextWidth: number | null = null;

    switch (event.key) {
      case "ArrowLeft":
        nextWidth = preference.width - KEYBOARD_RESIZE_STEP;
        break;
      case "ArrowRight":
        nextWidth = preference.width + KEYBOARD_RESIZE_STEP;
        break;
      case "Home":
        nextWidth = MIN_SIDEBAR_WIDTH;
        break;
      case "End":
        nextWidth = MAX_SIDEBAR_WIDTH;
        break;
      default:
        return;
    }

    event.preventDefault();
    setSidebarWidth(nextWidth, true);
  }

  const sidebarWidth = preference.collapsed ? 0 : preference.width;
  const style = {
    "--sidebar-width": `${sidebarWidth}px`,
  } as CSSProperties;

  return (
    <main
      className="app-shell"
      data-sidebar-collapsed={preference.collapsed}
      data-sidebar-resizing={resizing}
      ref={shellRef}
      style={style}
    >
      <aside className="sidebar">
        {sidebar}
        <button
          className="sidebar-collapse-button"
          type="button"
          aria-label="Hide sidebar"
          title="Hide sidebar"
          onClick={collapseSidebar}
        >
          ‹
        </button>
      </aside>

      {!preference.collapsed ? (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={preference.width}
          tabIndex={0}
          onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH, true)}
          onKeyDown={handleResizeKeyDown}
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
        />
      ) : null}

      <section className="main-pane">
        {preference.collapsed ? (
          <button
            className="sidebar-restore-button"
            type="button"
            aria-label="Show sidebar"
            title="Show sidebar"
            onClick={expandSidebar}
          >
            ☰
          </button>
        ) : null}
        {children}
      </section>
    </main>
  );
}
