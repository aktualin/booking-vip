"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";

export type PopoverPanelApi = {
  /** Closes the panel. */
  close: () => void;
};

type PopoverProps = {
  /** Content of the trigger button. */
  trigger: ReactNode;
  /** Panel content — receives a `close` helper. */
  children: (api: PopoverPanelApi) => ReactNode;
  /** Classes for the trigger button. */
  buttonClassName?: string;
  /** Classes for the floating panel. */
  panelClassName?: string;
  /** Which edge of the trigger the panel is anchored to. */
  align?: "left" | "right";
  /** Accessible name of the trigger. */
  ariaLabel?: string;
  /** Notified whenever the panel opens or closes. */
  onOpenChange?: (open: boolean) => void;
};

/** Space between the trigger and the panel, and the panel's viewport margin. */
const GAP = 8;

type Placement = { top: number; left: number; maxHeight: number };

/**
 * A lightweight popover — a trigger button with a floating panel that closes
 * on outside click or Escape.
 *
 * The panel is portalled to `document.body` and pinned with `position: fixed`
 * measured from the trigger's rect, so no ancestor `overflow-hidden` (or an
 * animated transform) can clip it. It opens below the trigger, flips above
 * when only that fits, and otherwise clamps its height to the roomier side —
 * the panel is a flex column, so whatever scrolls inside it (the option list)
 * gets the leftover height and stays the only scrollbar.
 *
 * The panel starts with a *focus guard* (the same markup headless UI
 * libraries render) so that keyboard focus entering the browser chrome
 * returns into the panel instead of escaping to the page behind it.
 */
export default function Popover({
  trigger,
  children,
  buttonClassName = "",
  panelClassName = "",
  align = "left",
  ariaLabel,
  onOpenChange,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const placedRef = useRef<Placement | null>(null);
  const panelId = useId();

  const setOpenState = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  /** Pin the panel to its trigger, inside the viewport. */
  const place = () => {
    const triggerEl = triggerRef.current;
    const panelEl = panelRef.current;
    if (!triggerEl || !panelEl) return;

    const rect = triggerEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = panelEl.offsetWidth;
    const height = panelEl.offsetHeight;

    // Horizontal — anchor the requested edge, then keep it on screen.
    const preferred = align === "right" ? rect.right - width : rect.left;
    const left = Math.max(GAP, Math.min(preferred, vw - width - GAP));

    // Vertical — below when it fits, above when only that fits, else clamped
    // to the roomier side (the inner scroller absorbs the overflow).
    const spaceBelow = Math.max(vh - GAP - (rect.bottom + GAP), 0);
    const spaceAbove = Math.max(rect.top - GAP, 0);
    let top: number;
    let maxHeight: number;
    if (height <= spaceBelow || spaceBelow >= spaceAbove) {
      top = rect.bottom + GAP;
      maxHeight = spaceBelow;
    } else {
      maxHeight = spaceAbove;
      top = rect.top - GAP - Math.min(height, spaceAbove);
    }

    const next = { top: Math.round(top), left: Math.round(left), maxHeight: Math.round(maxHeight) };
    const prev = placedRef.current;
    if (
      prev &&
      prev.top === next.top &&
      prev.left === next.left &&
      prev.maxHeight === next.maxHeight
    )
      return;
    placedRef.current = next;
    setStyle(next);
  };

  // Measure once the panel exists, then track scroll / resize / content
  // growth (drill-down, filtering) for as long as it is open.
  useLayoutEffect(() => {
    if (!open) {
      placedRef.current = null;
      setStyle(null);
      return;
    }
    place();
    const panelEl = panelRef.current;
    const ro = panelEl ? new ResizeObserver(place) : null;
    if (panelEl) ro?.observe(panelEl);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      ro?.disconnect();
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      // The panel lives in a portal now — test both subtrees.
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpenState(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenState(false);
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpenState(!open)}
        className={`block w-full text-left ${buttonClassName}`}
      >
        {trigger}
      </button>

      {open &&
        createPortal(
          <div
            id={panelId}
            role="dialog"
            ref={panelRef}
            style={style ?? undefined}
            className={`fixed z-50 flex flex-col overscroll-contain rounded-2xl border border-line bg-white p-3 shadow-xl shadow-slate-900/10 ${panelClassName}`}
          >
            {/* Focus guard — keeps keyboard focus from escaping the panel. */}
            <div
              data-focus-guard="true"
              tabIndex={0}
              className="fixed left-px top-px h-0 w-0 overflow-hidden p-0"
            />
            {/* Fallback scroller for panels whose content does not flex. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {children({ close: () => setOpenState(false) })}
            </div>
            {/* Trailing focus guard — Tab past the last control returns here
                instead of escaping into the page behind the panel. */}
            <div
              data-focus-guard="true"
              tabIndex={0}
              className="fixed left-px top-px h-0 w-0 overflow-hidden p-0"
            />
          </div>,
          document.body
        )}
    </div>
  );
}
