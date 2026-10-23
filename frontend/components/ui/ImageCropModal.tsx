"use client";

import { useTranslations } from "next-intl";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { Button } from "./Button";
import { Modal } from "./Modal";

interface ImageCropModalProps {
  /** The image awaiting a crop decision - null while the modal is closed. */
  file: File | null;
  /** Apply → the cropped File; "Keep original" → "skip"; X/Escape/outside
   * click → null (discard the upload entirely). */
  onDone: (result: File | "skip" | null) => void;
}

// Largest on-canvas presentation of the uploaded image. Cropping always
// works against the full-resolution source (the selection is mapped back up
// by naturalWidth / displayWidth), so these caps only limit DOM size, never
// the resulting image's quality.
const MAX_DISPLAY_W = 600;
const MAX_DISPLAY_H = 400;

// Below this the rectangle is treated as an accidental click, not a crop.
const MIN_CROP_PX = 4;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Crop step for images pasted or dropped into the Markdown editor: shows
 * the image on a canvas, lets the user drag a free-form rectangle over the
 * part to keep, and re-encodes just that region with canvas.toBlob (same
 * MIME type; JPEG at 0.92 quality) into a new File that flows back into the
 * editor's normal upload path. Runs identically on create and edit pages
 * since both render MarkdownEditor. */
export function ImageCropModal({ file, onDone }: ImageCropModalProps) {
  const t = useTranslations("imageCrop");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [selection, setSelection] = useState<Rect | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // Load each incoming file as an <img> (its object URL is revoked when the
  // file changes or the modal unmounts) and size the displayed canvas down
  // to MAX_DISPLAY_* while keeping the aspect ratio.
  useEffect(() => {
    if (!file) {
      imageRef.current = null;
      setDisplaySize({ w: 0, h: 0 });
      setNaturalSize({ w: 0, h: 0 });
      setSelection(null);
      setLoadFailed(false);
      return;
    }
    setSelection(null);
    setLoadFailed(false);
    const url = URL.createObjectURL(file);
    const img = new Image();
    imageRef.current = img;
    img.onload = () => {
      if (imageRef.current !== img) return; // the file changed mid-load
      const scale = Math.min(
        1,
        MAX_DISPLAY_W / img.naturalWidth,
        MAX_DISPLAY_H / img.naturalHeight,
      );
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      setDisplaySize({
        w: Math.max(1, Math.round(img.naturalWidth * scale)),
        h: Math.max(1, Math.round(img.naturalHeight * scale)),
      });
    };
    img.onerror = () => {
      if (imageRef.current !== img) return;
      setLoadFailed(true);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Draw once the image is loaded AND the canvas element exists (the onload
  // callback above only records sizes - the canvas isn't mounted until this
  // render). Backed at device-pixel resolution so the preview stays sharp.
  useEffect(() => {
    const img = imageRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !displaySize.w) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(displaySize.w * dpr);
    canvas.height = Math.round(displaySize.h * dpr);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }, [displaySize]);

  // Translate a pointer event into display-space canvas coordinates,
  // clamped to the image bounds.
  function canvasPoint(e: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * displaySize.w;
    const y = ((e.clientY - rect.top) / rect.height) * displaySize.h;
    return {
      x: Math.min(Math.max(x, 0), displaySize.w),
      y: Math.min(Math.max(y, 0), displaySize.h),
    };
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!displaySize.w || loadFailed) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = canvasPoint(e);
    dragStartRef.current = p;
    setSelection({ left: p.x, top: p.y, width: 0, height: 0 });
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const start = dragStartRef.current;
    if (!start) return;
    const p = canvasPoint(e);
    setSelection({
      left: Math.min(start.x, p.x),
      top: Math.min(start.y, p.y),
      width: Math.abs(p.x - start.x),
      height: Math.abs(p.y - start.y),
    });
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    dragStartRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  const canApply =
    !loadFailed &&
    selection !== null &&
    selection.width >= MIN_CROP_PX &&
    selection.height >= MIN_CROP_PX;

  function handleApply() {
    const img = imageRef.current;
    if (!img || !file || !selection) return;
    // Map the display-space rect back up to full-resolution source pixels.
    const sx = Math.min(img.naturalWidth, Math.round((selection.left / displaySize.w) * img.naturalWidth));
    const sy = Math.min(img.naturalHeight, Math.round((selection.top / displaySize.h) * img.naturalHeight));
    const sw = Math.min(img.naturalWidth - sx, Math.round((selection.width / displaySize.w) * img.naturalWidth));
    const sh = Math.min(img.naturalHeight - sy, Math.round((selection.height / displaySize.h) * img.naturalHeight));
    const dest = document.createElement("canvas");
    dest.width = sw;
    dest.height = sh;
    dest.getContext("2d")?.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    // Preserve the original format so a PNG screenshot stays PNG; JPEG gets
    // an explicit quality since canvas.toBlob's JPEG default is lossier.
    const mime = file.type.startsWith("image/") ? file.type : "image/png";
    dest.toBlob(
      (blob) => {
        if (blob) onDone(new File([blob], file.name, { type: mime }));
        else onDone(null);
      },
      mime,
      mime === "image/jpeg" ? 0.92 : undefined,
    );
  }

  const statusText = loadFailed
    ? t("loadFailed")
    : selection && naturalSize.w && displaySize.w
      ? t("selectedSize", {
          w: Math.max(0, Math.round((selection.width / displaySize.w) * naturalSize.w)),
          h: Math.max(0, Math.round((selection.height / displaySize.h) * naturalSize.h)),
        })
      : t("dragHint");

  return (
    <Modal
      open={file !== null}
      onOpenChange={(open) => {
        if (!open) onDone(null);
      }}
      title={t("title")}
      description={t("description")}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={() => onDone("skip")}>
            {t("useOriginal")}
          </Button>
          <Button onClick={handleApply} disabled={!canApply}>
            {t("apply")}
          </Button>
        </>
      }
    >
      {file && (
        <div>
          {displaySize.w > 0 && !loadFailed ? (
            // The selection rectangle's huge box-shadow dims everything
            // around it, and the wrapper's overflow-hidden clips that dim
            // to exactly the canvas - no separate mask layers needed.
            <div
              className="relative mx-auto overflow-hidden rounded-md border border-outline-variant"
              style={{ width: displaySize.w, height: displaySize.h }}
            >
              <canvas
                ref={canvasRef}
                className="block touch-none cursor-crosshair select-none"
                style={{ width: displaySize.w, height: displaySize.h }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              />
              {selection && (
                <div
                  className="pointer-events-none absolute border-2 border-white/90 box-border"
                  style={{
                    left: selection.left,
                    top: selection.top,
                    width: selection.width,
                    height: selection.height,
                    boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)",
                  }}
                />
              )}
            </div>
          ) : (
            <div
              className="mx-auto animate-pulse rounded-md border border-outline-variant bg-surface-variant"
              style={{ width: Math.min(MAX_DISPLAY_W, 480), height: loadFailed ? 0 : 280 }}
            />
          )}
          <p className="mt-3 text-center font-body-md text-body-md text-on-surface-variant">
            {statusText}
          </p>
        </div>
      )}
    </Modal>
  );
}
