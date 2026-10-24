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
  /** Whether this crop is for an already uploaded image (swaps description and secondary button to Cancel). */
  isExisting?: boolean;
  /** Fixed aspect ratio (width / height), e.g. 1 for square avatar. */
  aspectRatio?: number;
  /** Visual guide shape ("rect" | "circle"). "circle" draws a circular guide overlay inside the crop box. */
  shape?: "rect" | "circle";
  /** Apply → the cropped File; "Keep original" → "skip"; X/Escape/outside
   * click → null (discard the upload entirely). */
  onDone: (result: File | "skip" | null) => void;
}

const MAX_DISPLAY_W = 600;
const MAX_DISPLAY_H = 400;
const MIN_CROP_PX = 16;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type AnchorType = "nw" | "ne" | "se" | "sw" | "n" | "s" | "e" | "w";

type DragAction =
  | { type: "create"; startX: number; startY: number }
  | { type: "move"; startX: number; startY: number; origLeft: number; origTop: number }
  | {
      type: "resize";
      anchor: AnchorType;
      startX: number;
      startY: number;
      origRect: Rect;
    };

export function ImageCropModal({
  file,
  isExisting = false,
  aspectRatio,
  shape = "rect",
  onDone,
}: ImageCropModalProps) {
  const t = useTranslations("imageCrop");
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragActionRef = useRef<DragAction | null>(null);

  const [prevFile, setPrevFile] = useState<File | null>(file);
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [selection, setSelection] = useState<Rect | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  if (file !== prevFile) {
    setPrevFile(file);
    setDisplaySize({ w: 0, h: 0 });
    setNaturalSize({ w: 0, h: 0 });
    setSelection(null);
    setLoadFailed(false);
  }

  useEffect(() => {
    if (!file) {
      imageRef.current = null;
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    imageRef.current = img;
    img.onload = () => {
      if (imageRef.current !== img) return;
      const scale = Math.min(
        1,
        MAX_DISPLAY_W / img.naturalWidth,
        MAX_DISPLAY_H / img.naturalHeight,
      );
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      const dispW = Math.max(1, Math.round(img.naturalWidth * scale));
      const dispH = Math.max(1, Math.round(img.naturalHeight * scale));
      setDisplaySize({ w: dispW, h: dispH });

      // Initialize default crop box
      if (aspectRatio) {
        const targetSide = Math.min(dispW, dispH * aspectRatio) * 0.85;
        const width = Math.round(targetSide);
        const height = Math.round(targetSide / aspectRatio);
        setSelection({
          left: Math.round((dispW - width) / 2),
          top: Math.round((dispH - height) / 2),
          width,
          height,
        });
      } else {
        const width = Math.round(dispW * 0.85);
        const height = Math.round(dispH * 0.85);
        setSelection({
          left: Math.round((dispW - width) / 2),
          top: Math.round((dispH - height) / 2),
          width,
          height,
        });
      }
    };
    img.onerror = () => {
      if (imageRef.current !== img) return;
      setLoadFailed(true);
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, aspectRatio]);

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

  function getPoint(e: ReactPointerEvent): { x: number; y: number } {
    const container = containerRef.current;
    if (!container) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    const x = Math.min(Math.max(0, e.clientX - rect.left), displaySize.w);
    const y = Math.min(Math.max(0, e.clientY - rect.top), displaySize.h);
    return { x, y };
  }

  function handleAnchorPointerDown(e: ReactPointerEvent, anchor: AnchorType) {
    if (!selection) return;
    e.stopPropagation();
    e.preventDefault();
    const target = containerRef.current;
    if (target) target.setPointerCapture(e.pointerId);

    const p = getPoint(e);
    dragActionRef.current = {
      type: "resize",
      anchor,
      startX: p.x,
      startY: p.y,
      origRect: { ...selection },
    };
  }

  function handleBoxPointerDown(e: ReactPointerEvent) {
    if (!selection) return;
    e.stopPropagation();
    e.preventDefault();
    const target = containerRef.current;
    if (target) target.setPointerCapture(e.pointerId);

    const p = getPoint(e);
    dragActionRef.current = {
      type: "move",
      startX: p.x,
      startY: p.y,
      origLeft: selection.left,
      origTop: selection.top,
    };
  }

  function handleContainerPointerDown(e: ReactPointerEvent) {
    if (!displaySize.w || loadFailed) return;
    e.preventDefault();
    const target = containerRef.current;
    if (target) target.setPointerCapture(e.pointerId);

    const p = getPoint(e);
    dragActionRef.current = {
      type: "create",
      startX: p.x,
      startY: p.y,
    };
    setSelection({ left: p.x, top: p.y, width: 0, height: 0 });
  }

  function handlePointerMove(e: ReactPointerEvent) {
    const action = dragActionRef.current;
    if (!action) return;
    const p = getPoint(e);
    const dx = p.x - action.startX;
    const dy = p.y - action.startY;

    if (action.type === "move") {
      if (!selection) return;
      const maxLeft = Math.max(0, displaySize.w - selection.width);
      const maxTop = Math.max(0, displaySize.h - selection.height);
      const newLeft = Math.max(0, Math.min(action.origLeft + dx, maxLeft));
      const newTop = Math.max(0, Math.min(action.origTop + dy, maxTop));
      setSelection({
        ...selection,
        left: Math.round(newLeft),
        top: Math.round(newTop),
      });
      return;
    }

    if (action.type === "create") {
      if (aspectRatio) {
        let width = Math.abs(p.x - action.startX);
        let height = Math.abs(p.y - action.startY);
        const side = Math.min(width, height * aspectRatio);
        width = Math.max(MIN_CROP_PX, side);
        height = width / aspectRatio;

        const left = p.x < action.startX ? Math.max(0, action.startX - width) : action.startX;
        const top = p.y < action.startY ? Math.max(0, action.startY - height) : action.startY;
        setSelection({
          left: Math.round(left),
          top: Math.round(top),
          width: Math.round(Math.min(width, displaySize.w - left)),
          height: Math.round(Math.min(height, displaySize.h - top)),
        });
      } else {
        const left = Math.min(action.startX, p.x);
        const top = Math.min(action.startY, p.y);
        const width = Math.abs(p.x - action.startX);
        const height = Math.abs(p.y - action.startY);
        setSelection({
          left: Math.round(left),
          top: Math.round(top),
          width: Math.round(Math.min(width, displaySize.w - left)),
          height: Math.round(Math.min(height, displaySize.h - top)),
        });
      }
      return;
    }

    if (action.type === "resize") {
      const { anchor, origRect } = action;

      if (aspectRatio) {
        // Proportional resize with fixed opposite corner
        if (anchor === "se") {
          const maxW = displaySize.w - origRect.left;
          const maxH = displaySize.h - origRect.top;
          let candW = Math.max(MIN_CROP_PX, Math.min(origRect.width + dx, maxW));
          let candH = candW / aspectRatio;
          if (candH > maxH) {
            candH = maxH;
            candW = candH * aspectRatio;
          }
          setSelection({
            left: origRect.left,
            top: origRect.top,
            width: Math.round(candW),
            height: Math.round(candH),
          });
        } else if (anchor === "nw") {
          const fixedR = origRect.left + origRect.width;
          const fixedB = origRect.top + origRect.height;
          let candW = Math.max(MIN_CROP_PX, Math.min(origRect.width - dx, fixedR));
          let candH = candW / aspectRatio;
          if (candH > fixedB) {
            candH = fixedB;
            candW = candH * aspectRatio;
          }
          setSelection({
            left: Math.round(fixedR - candW),
            top: Math.round(fixedB - candH),
            width: Math.round(candW),
            height: Math.round(candH),
          });
        } else if (anchor === "ne") {
          const fixedL = origRect.left;
          const fixedB = origRect.top + origRect.height;
          const maxW = displaySize.w - fixedL;
          let candW = Math.max(MIN_CROP_PX, Math.min(origRect.width + dx, maxW));
          let candH = candW / aspectRatio;
          if (candH > fixedB) {
            candH = fixedB;
            candW = candH * aspectRatio;
          }
          setSelection({
            left: fixedL,
            top: Math.round(fixedB - candH),
            width: Math.round(candW),
            height: Math.round(candH),
          });
        } else if (anchor === "sw") {
          const fixedR = origRect.left + origRect.width;
          const fixedT = origRect.top;
          const maxH = displaySize.h - fixedT;
          let candW = Math.max(MIN_CROP_PX, Math.min(origRect.width - dx, fixedR));
          let candH = candW / aspectRatio;
          if (candH > maxH) {
            candH = maxH;
            candW = candH * aspectRatio;
          }
          setSelection({
            left: Math.round(fixedR - candW),
            top: fixedT,
            width: Math.round(candW),
            height: Math.round(candH),
          });
        }
        return;
      }

      // Freeform resize
      let left = origRect.left;
      let top = origRect.top;
      let width = origRect.width;
      let height = origRect.height;

      if (anchor.includes("e")) {
        width = Math.min(displaySize.w - origRect.left, Math.max(MIN_CROP_PX, origRect.width + dx));
      }
      if (anchor.includes("w")) {
        const newLeft = Math.min(origRect.left + origRect.width - MIN_CROP_PX, Math.max(0, origRect.left + dx));
        width = origRect.left + origRect.width - newLeft;
        left = newLeft;
      }
      if (anchor.includes("s")) {
        height = Math.min(displaySize.h - origRect.top, Math.max(MIN_CROP_PX, origRect.height + dy));
      }
      if (anchor.includes("n")) {
        const newTop = Math.min(origRect.top + origRect.height - MIN_CROP_PX, Math.max(0, origRect.top + dy));
        height = origRect.top + origRect.height - newTop;
        top = newTop;
      }

      setSelection({
        left: Math.round(left),
        top: Math.round(top),
        width: Math.round(width),
        height: Math.round(height),
      });
    }
  }

  function handlePointerUp(e: ReactPointerEvent) {
    dragActionRef.current = null;
    const target = containerRef.current;
    if (target && target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
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

    const sx = Math.min(img.naturalWidth, Math.round((selection.left / displaySize.w) * img.naturalWidth));
    const sy = Math.min(img.naturalHeight, Math.round((selection.top / displaySize.h) * img.naturalHeight));
    const sw = Math.min(img.naturalWidth - sx, Math.round((selection.width / displaySize.w) * img.naturalWidth));
    const sh = Math.min(img.naturalHeight - sy, Math.round((selection.height / displaySize.h) * img.naturalHeight));

    const dest = document.createElement("canvas");
    dest.width = Math.max(1, sw);
    dest.height = Math.max(1, sh);
    dest.getContext("2d")?.drawImage(img, sx, sy, sw, sh, 0, 0, dest.width, dest.height);

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
      description={isExisting ? t("editDescription") : t("description")}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={() => onDone("skip")}>
            {isExisting ? t("cancel") : t("useOriginal")}
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
            <div
              ref={containerRef}
              className="relative mx-auto overflow-hidden rounded-md border border-outline-variant select-none touch-none cursor-crosshair"
              style={{ width: displaySize.w, height: displaySize.h }}
              onPointerDown={handleContainerPointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <canvas
                ref={canvasRef}
                className="block pointer-events-none"
                style={{ width: displaySize.w, height: displaySize.h }}
              />

              {selection && selection.width > 0 && selection.height > 0 && (
                <div
                  data-box="true"
                  className="absolute border-2 border-white box-border cursor-move group/box transition-[border-color]"
                  style={{
                    left: selection.left,
                    top: selection.top,
                    width: selection.width,
                    height: selection.height,
                    boxShadow: "0 0 0 9999px rgba(0,0,0,0.52)",
                  }}
                  onPointerDown={handleBoxPointerDown}
                >
                  {/* Subtle Rule of Thirds Grid */}
                  <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-30 group-hover/box:opacity-50 transition-opacity">
                    <div className="border-r border-b border-white/60" />
                    <div className="border-r border-b border-white/60" />
                    <div className="border-b border-white/60" />
                    <div className="border-r border-b border-white/60" />
                    <div className="border-r border-b border-white/60" />
                    <div className="border-b border-white/60" />
                    <div className="border-r border-white/60" />
                    <div className="border-r border-white/60" />
                    <div />
                  </div>

                  {/* Circular guide for avatars / profile pictures */}
                  {shape === "circle" && (
                    <div className="absolute inset-0 rounded-full border-2 border-dashed border-white/80 pointer-events-none" />
                  )}

                  {/* Corner Anchors */}
                  <button
                    type="button"
                    aria-label="Resize Top Left"
                    className="absolute -top-2 -left-2 w-4 h-4 bg-white border-2 border-primary rounded-full shadow-md cursor-nwse-resize hover:scale-125 transition-transform z-20"
                    onPointerDown={(e) => handleAnchorPointerDown(e, "nw")}
                  />
                  <button
                    type="button"
                    aria-label="Resize Top Right"
                    className="absolute -top-2 -right-2 w-4 h-4 bg-white border-2 border-primary rounded-full shadow-md cursor-nesw-resize hover:scale-125 transition-transform z-20"
                    onPointerDown={(e) => handleAnchorPointerDown(e, "ne")}
                  />
                  <button
                    type="button"
                    aria-label="Resize Bottom Right"
                    className="absolute -bottom-2 -right-2 w-4 h-4 bg-white border-2 border-primary rounded-full shadow-md cursor-nwse-resize hover:scale-125 transition-transform z-20"
                    onPointerDown={(e) => handleAnchorPointerDown(e, "se")}
                  />
                  <button
                    type="button"
                    aria-label="Resize Bottom Left"
                    className="absolute -bottom-2 -left-2 w-4 h-4 bg-white border-2 border-primary rounded-full shadow-md cursor-nesw-resize hover:scale-125 transition-transform z-20"
                    onPointerDown={(e) => handleAnchorPointerDown(e, "sw")}
                  />

                  {/* Edge Anchors (Available for freeform crops) */}
                  {!aspectRatio && (
                    <>
                      <button
                        type="button"
                        aria-label="Resize Top"
                        className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-white border-2 border-primary rounded-full shadow-md cursor-ns-resize hover:scale-125 transition-transform z-20"
                        onPointerDown={(e) => handleAnchorPointerDown(e, "n")}
                      />
                      <button
                        type="button"
                        aria-label="Resize Right"
                        className="absolute top-1/2 -right-2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-primary rounded-full shadow-md cursor-ew-resize hover:scale-125 transition-transform z-20"
                        onPointerDown={(e) => handleAnchorPointerDown(e, "e")}
                      />
                      <button
                        type="button"
                        aria-label="Resize Bottom"
                        className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-white border-2 border-primary rounded-full shadow-md cursor-ns-resize hover:scale-125 transition-transform z-20"
                        onPointerDown={(e) => handleAnchorPointerDown(e, "s")}
                      />
                      <button
                        type="button"
                        aria-label="Resize Left"
                        className="absolute top-1/2 -left-2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-primary rounded-full shadow-md cursor-ew-resize hover:scale-125 transition-transform z-20"
                        onPointerDown={(e) => handleAnchorPointerDown(e, "w")}
                      />
                    </>
                  )}
                </div>
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
