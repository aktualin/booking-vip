"use client";

// Signature pad for the renter identity step. Draws on a DPR-aware canvas
// with Pointer Events (mouse / touch / stylus), then uploads the PNG via
// uploadRenterDoc and reports the stored URL through onChange. Purely
// presentational + one upload call — no router or server imports.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Check,
  Eraser,
  LoaderCircle,
  PenLine,
  RotateCcw,
  Upload,
} from "lucide-react";
import { uploadRenterDoc } from "@/lib/renter-upload";

const STROKE_WIDTH = 2.5;
const INK_COLOR = "#1a1a1a"; // --color-ink
const PAD_BG = "#ffffff";

type SignaturePadProps = {
  /** URL of the saved signature image; null when nothing is saved yet. */
  value: string | null;
  onChange: (url: string | null) => void;
};

type DrawingState = {
  active: boolean;
  pointerId: number;
  lastX: number;
  lastY: number;
};

export default function SignaturePad({ value, onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<DrawingState>({
    active: false,
    pointerId: -1,
    lastX: 0,
    lastY: 0,
  });
  // Mirror of hasInk for use inside handlers/observers without re-creating them.
  const hasInkRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Size the backing store to clientSize * devicePixelRatio and scale the
  // context so drawing coordinates stay in CSS pixels. Existing ink is
  // preserved across resizes.
  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.round(width * dpr);
    const targetHeight = Math.round(height * dpr);
    if (canvas.width === targetWidth && canvas.height === targetHeight) return;

    // Snapshot the current ink so a resize does not wipe the signature.
    let snapshot: HTMLCanvasElement | null = null;
    if (hasInkRef.current && canvas.width > 0 && canvas.height > 0) {
      const copy = document.createElement("canvas");
      copy.width = canvas.width;
      copy.height = canvas.height;
      const copyCtx = copy.getContext("2d");
      if (copyCtx) {
        copyCtx.drawImage(canvas, 0, 0);
        snapshot = copy;
      }
    }

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = STROKE_WIDTH;
    ctx.strokeStyle = INK_COLOR;
    // Paint a white background so the exported PNG is not transparent.
    ctx.fillStyle = PAD_BG;
    ctx.fillRect(0, 0, width, height);
    if (snapshot) {
      ctx.drawImage(
        snapshot,
        0,
        0,
        snapshot.width,
        snapshot.height,
        0,
        0,
        width,
        height,
      );
    }
  }, []);

  // The pad only exists while nothing is saved yet, so every (re)mount is a
  // blank canvas: reset the ink flag, size it, and watch for resizes.
  useEffect(() => {
    if (value) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawingRef.current = { active: false, pointerId: -1, lastX: 0, lastY: 0 };
    hasInkRef.current = false;
    setHasInk(false);
    sizeCanvas();

    const handleResize = () => sizeCanvas();
    window.addEventListener("resize", handleResize);
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(handleResize)
        : null;
    observer?.observe(canvas);
    return () => {
      window.removeEventListener("resize", handleResize);
      observer?.disconnect();
    };
  }, [value, sizeCanvas]);

  const pointFromEvent = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail for an already-released pointer; drawing still works.
    }
    const { x, y } = pointFromEvent(e);
    drawingRef.current = {
      active: true,
      pointerId: e.pointerId,
      lastX: x,
      lastY: y,
    };
    // A bare tap leaves a dot.
    ctx.fillStyle = INK_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, STROKE_WIDTH / 2, 0, Math.PI * 2);
    ctx.fill();
    if (!hasInkRef.current) {
      hasInkRef.current = true;
      setHasInk(true);
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const drawing = drawingRef.current;
    if (!drawing.active || drawing.pointerId !== e.pointerId) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    e.preventDefault();
    const { x, y } = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(drawing.lastX, drawing.lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    drawing.lastX = x;
    drawing.lastY = y;
  };

  const handlePointerEnd = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const drawing = drawingRef.current;
    if (!drawing.active || drawing.pointerId !== e.pointerId) return;
    drawing.active = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Already released.
    }
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.fillStyle = PAD_BG;
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    drawingRef.current.active = false;
    hasInkRef.current = false;
    setHasInk(false);
    setError(null);
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk || saving) return;
    setSaving(true);
    setError(null);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
    if (!blob) {
      setSaving(false);
      setError("Gagal membuat gambar tanda tangan. Coba lagi.");
      return;
    }
    const result = await uploadRenterDoc(blob, "signature");
    setSaving(false);
    if (result.ok) {
      onChange(result.url);
    } else {
      setError(result.error);
    }
  };

  const handleRedo = () => {
    hasInkRef.current = false;
    setHasInk(false);
    setError(null);
    // The pad remounts blank once value is null.
    onChange(null);
  };

  return (
    <div className="mb-6 rounded-2xl border border-line bg-white p-5">
      <h3 className="mb-4 flex items-center gap-2 text-base font-bold text-ink">
        <PenLine className="h-4 w-4 text-brand-dark" aria-hidden="true" />
        Tanda Tangan Penyewa
      </h3>

      {value ? (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-[12px] font-semibold text-brand-dark">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Tanda tangan tersimpan
            </span>
            <button
              type="button"
              onClick={handleRedo}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-canvas"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Ulangi
            </button>
          </div>
          <div className="rounded-xl border border-line bg-white p-2">
            <img
              src={value}
              alt="Tanda tangan penyewa yang tersimpan"
              className="h-[180px] w-full object-contain"
            />
          </div>
        </div>
      ) : (
        <div>
          <canvas
            ref={canvasRef}
            aria-label="Area gambar tanda tangan"
            className="h-[180px] w-full cursor-crosshair touch-none select-none rounded-xl border border-line bg-white"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
          >
            Browser Anda tidak mendukung canvas untuk menggambar tanda tangan.
          </canvas>
          <p className="mt-2 text-[12px] text-muted">
            Tanda tangan di atas menggunakan jari, stylus, atau mouse.
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleClear}
              disabled={!hasInk || saving}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-semibold text-ink transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Eraser className="h-4 w-4" aria-hidden="true" />
              Hapus
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!hasInk || saving}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <LoaderCircle
                  className="h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Upload className="h-4 w-4" aria-hidden="true" />
              )}
              {saving ? "Menyimpan…" : "Simpan tanda tangan"}
            </button>
          </div>
          {error && (
            <p className="mt-3 rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-[13px] text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
