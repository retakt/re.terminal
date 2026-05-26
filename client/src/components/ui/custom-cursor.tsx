"use client";

import * as React from "react";
import { AnimatePresence, motion, useMotionValue, type MotionValue } from "motion/react";
import { cn } from "@/lib/utils";

const DefaultPointerSVG = ({ className }: { className?: string }) => (
  <svg
    stroke="currentColor"
    fill="currentColor"
    strokeWidth="1"
    viewBox="0 0 16 16"
    className={className}
    height="1em"
    width="1em"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .557.103z" />
  </svg>
);

type CursorColor =
  | "sky"
  | "red"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "yellow"
  | "indigo"
  | string;

type CursorProps = {
  children: React.ReactNode;
  className?: string;

  /* Original Nyx API */
  name?: string;
  customSVG?: React.ReactNode;
  svgClassName?: string;
  cursorColor?: CursorColor;

  /* Extra API for logs only */
  content?: React.ReactNode;
  panelClassName?: string;
  disabled?: boolean;
  hideNativeCursor?: boolean;
};

type TooltipLayout = {
  left: number;
  top: number;
  placement: "above" | "below";
  maxHeight: number | null;
  maxWidth: number | null;
};

const TOOLTIP_POINTER_EPSILON = 2;
const TOOLTIP_CONTENT_MOVE_EPSILON = 6;
const TOOLTIP_POINTER_MOVE_WINDOW_MS = 180;
const DEFAULT_TOOLTIP_LAYOUT: TooltipLayout = {
  left: 0,
  top: 0,
  placement: "below",
  maxHeight: null,
  maxWidth: null,
};

let sharedTooltipSnapshot: {
  point: { x: number; y: number };
  content: React.ReactNode;
} | null = null;
let sharedTooltipLayout: TooltipLayout | null = null;
let lastTooltipPhysicalMoveAt = 0;

function pointerMoved(
  current: { x: number; y: number },
  previous: { x: number; y: number },
  epsilon = TOOLTIP_POINTER_EPSILON,
) {
  return (
    Math.abs(current.x - previous.x) > epsilon ||
    Math.abs(current.y - previous.y) > epsilon
  );
}

export function Cursor({
  children,
  className,
  name = "",
  customSVG,
  svgClassName,
  cursorColor = "sky",
  content,
  panelClassName,
  disabled = false,
  hideNativeCursor = true,
}: CursorProps) {
  const posX = useMotionValue(0);
  const posY = useMotionValue(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  const [mouseInside, setMouseInside] = React.useState(false);
  const [cursorPoint, setCursorPoint] = React.useState({ x: 0, y: 0 });
  const [stableContent, setStableContent] = React.useState<React.ReactNode>(null);
  const [tooltipLayout, setTooltipLayout] = React.useState<TooltipLayout>(
    () => sharedTooltipLayout ?? DEFAULT_TOOLTIP_LAYOUT,
  );
  const [tooltipReady, setTooltipReady] = React.useState(Boolean(sharedTooltipLayout));

  const handleMouseMove = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const point = { x: event.clientX, y: event.clientY };

      posX.set(point.x);
      posY.set(point.y);
      setCursorPoint(point);

      const hasPhysicalMovement =
        Math.abs(event.movementX) > 0 || Math.abs(event.movementY) > 0;
      const movedFarEnough =
        !sharedTooltipSnapshot ||
        pointerMoved(point, sharedTooltipSnapshot.point, TOOLTIP_CONTENT_MOVE_EPSILON);

      if (content && hasPhysicalMovement && movedFarEnough) {
        lastTooltipPhysicalMoveAt = performance.now();
        sharedTooltipSnapshot = { point, content };
        setStableContent(content);
      }
    },
    [content, disabled, posX, posY],
  );

  const handleMouseEnter = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return;

      const point = { x: event.clientX, y: event.clientY };
      const recentlyMoved =
        performance.now() - lastTooltipPhysicalMoveAt < TOOLTIP_POINTER_MOVE_WINDOW_MS;
      const shouldKeepSnapshot =
        Boolean(sharedTooltipSnapshot?.content) &&
        sharedTooltipSnapshot != null &&
        !recentlyMoved;
      const nextContent = shouldKeepSnapshot ? sharedTooltipSnapshot?.content : content;

      posX.set(point.x);
      posY.set(point.y);
      setCursorPoint(point);
      setStableContent(nextContent ?? null);
      if (shouldKeepSnapshot && sharedTooltipLayout) {
        setTooltipLayout(sharedTooltipLayout);
        setTooltipReady(true);
      }
      setMouseInside(true);

      if (content && !shouldKeepSnapshot) {
        sharedTooltipSnapshot = { point, content };
      }
    },
    [content, disabled, posX, posY],
  );

  React.useLayoutEffect(() => {
    if (!mouseInside || !stableContent) return;

    const updatePlacement = () => {
      const panel = tooltipRef.current;
      if (!panel) return;

      const gap = 0;
      const pad = 10;
      const minHeight = 96;
      const maxAllowedHeight = 320;
      const boundsElement = containerRef.current?.closest(".log-container");
      const boundsRect = boundsElement?.getBoundingClientRect();
      const boundary = boundsRect
        ? {
            left: boundsRect.left + pad,
            top: boundsRect.top + pad,
            right: boundsRect.right - pad,
            bottom: boundsRect.bottom - pad,
          }
        : {
            left: pad,
            top: pad,
            right: window.innerWidth - pad,
            bottom: window.innerHeight - pad,
          };
      const boundaryWidth = Math.max(0, boundary.right - boundary.left);
      const boundaryHeight = Math.max(0, boundary.bottom - boundary.top);
      const maxAllowedWidth = Math.min(820, Math.max(0, boundaryWidth));
      const desiredHeight = panel.scrollHeight || panel.offsetHeight || minHeight;
      const desiredWidth = panel.scrollWidth || panel.offsetWidth || 320;
      const spaceAbove = Math.max(0, cursorPoint.y - gap - boundary.top);
      const spaceBelow = Math.max(0, boundary.bottom - cursorPoint.y - gap);
      const requiredBelowSpace = Math.max(desiredHeight + 24, boundaryHeight * 0.25);

      const nextPlacement: TooltipLayout["placement"] =
        spaceBelow < requiredBelowSpace
          ? "above"
          : desiredHeight <= spaceBelow
            ? "below"
            : desiredHeight <= spaceAbove
              ? "above"
              : spaceBelow >= spaceAbove
                ? "below"
                : "above";

      const nextMaxHeight = Math.min(
        maxAllowedHeight,
        Math.max(minHeight, nextPlacement === "below" ? spaceBelow : spaceAbove),
      );
      const effectiveHeight = Math.min(desiredHeight, nextMaxHeight);
      const effectiveWidth = Math.min(desiredWidth, maxAllowedWidth);
      const minLeft = boundary.left;
      const maxLeft = Math.max(boundary.left, boundary.right - effectiveWidth);
      const nextLeft = Math.min(
        Math.max(cursorPoint.x - effectiveWidth / 2, minLeft),
        maxLeft,
      );
      const nextTop = nextPlacement === "above"
        ? Math.max(boundary.top, cursorPoint.y - effectiveHeight - gap)
        : Math.min(
            Math.max(boundary.top, boundary.bottom - effectiveHeight),
            cursorPoint.y + gap,
          );

      const nextLayout: TooltipLayout = {
        left: nextLeft,
        top: nextTop,
        placement: nextPlacement,
        maxHeight: nextMaxHeight,
        maxWidth: maxAllowedWidth,
      };

      sharedTooltipLayout = nextLayout;
      setTooltipLayout((current) => {
        if (
          current.left === nextLayout.left &&
          current.top === nextLayout.top &&
          current.placement === nextLayout.placement &&
          current.maxHeight === nextLayout.maxHeight &&
          current.maxWidth === nextLayout.maxWidth
        ) {
          return current;
        }
        return nextLayout;
      });
      setTooltipReady(true);
    };

    if (!sharedTooltipLayout) {
      setTooltipReady(false);
    }
    const frame = window.requestAnimationFrame(updatePlacement);
    window.addEventListener("resize", updatePlacement);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePlacement);
    };
  }, [cursorPoint.x, cursorPoint.y, mouseInside, stableContent]);

  if (disabled) return <>{children}</>;

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      style={hideNativeCursor ? { cursor: "none" } : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        setMouseInside(false);
        if (!sharedTooltipLayout) {
          setTooltipReady(false);
        }
      }}
    >
      {children}

      <AnimatePresence>
        {mouseInside && (
          <FollowCursor
            x={posX}
            y={posY}
            tooltipRef={tooltipRef}
            tooltipLayout={tooltipLayout}
            tooltipReady={tooltipReady}
            name={name}
            customSVG={customSVG}
            svgClassName={svgClassName}
            cursorColor={cursorColor}
            content={stableContent}
            panelClassName={panelClassName}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export function FollowCursor({
  x,
  y,
  tooltipRef,
  tooltipLayout,
  tooltipReady,
  name,
  customSVG,
  svgClassName,
  cursorColor = "sky",
  content,
  panelClassName,
}: {
  x: MotionValue<number>;
  y: MotionValue<number>;
  tooltipRef: React.RefObject<HTMLDivElement>;
  tooltipLayout: {
    left: number;
    top: number;
    placement: "above" | "below";
    maxHeight: number | null;
    maxWidth: number | null;
  };
  tooltipReady: boolean;
  name?: string;
  customSVG?: React.ReactNode;
  svgClassName?: string;
  cursorColor?: CursorColor;
  content?: React.ReactNode;
  panelClassName?: string;
}) {
  const getColorClasses = (color: string) => {
    const predefinedColors = {
      sky: "stroke-sky-600 text-sky-500 bg-sky-500",
      red: "stroke-red-600 text-red-500 bg-red-500",
      green: "stroke-green-600 text-green-500 bg-green-500",
      blue: "stroke-blue-600 text-blue-500 bg-blue-500",
      purple: "stroke-purple-600 text-purple-500 bg-purple-500",
      pink: "stroke-pink-600 text-pink-500 bg-pink-500",
      yellow: "stroke-yellow-600 text-yellow-500 bg-yellow-500",
      indigo: "stroke-indigo-600 text-indigo-500 bg-indigo-500",
    };

    return predefinedColors[color as keyof typeof predefinedColors] || predefinedColors.sky;
  };

  const [strokeClass, textClass, bgClass] = getColorClasses(cursorColor).split(" ");
  const hasPanel = Boolean(content);

  return (
    <motion.div
      className="pointer-events-none fixed z-[999999]"
      style={{
        left: content ? tooltipLayout.left : x,
        top: content ? tooltipLayout.top : y,
      }}
      initial={hasPanel ? false : { scale: 0.96, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={hasPanel ? { scale: 1, opacity: 1 } : { scale: 0.96, opacity: 0 }}
      transition={hasPanel ? { duration: 0 } : { duration: 0.12, ease: "easeOut" }}
    >
      {content ? (
        <div
          ref={tooltipRef}
          className={cn("log-cursor-tooltip", panelClassName)}
          data-placement={tooltipLayout.placement}
          style={{
            transform: "none",
            maxHeight: tooltipLayout.maxHeight ? `${tooltipLayout.maxHeight}px` : undefined,
            maxWidth: tooltipLayout.maxWidth ? `${tooltipLayout.maxWidth}px` : undefined,
            minWidth: tooltipLayout.maxWidth
              ? `${Math.min(320, tooltipLayout.maxWidth)}px`
              : undefined,
            opacity: tooltipReady ? 1 : 0,
          }}
        >
          {content}
        </div>
      ) : (
        <>
          {customSVG ? (
            <div
              className={cn(
                "h-6 w-6 -translate-x-[12px] -translate-y-[10px] -rotate-[70deg] transform",
                textClass,
                svgClassName,
              )}
            >
              {customSVG}
            </div>
          ) : (
            <DefaultPointerSVG
              className={cn(
                "h-6 w-6 -translate-x-[12px] -translate-y-[10px] -rotate-[70deg] transform",
                strokeClass,
                textClass,
                svgClassName,
              )}
            />
          )}

          {name ? (
            <div
              className={cn(
                "w-fit rounded-full px-2 py-1 text-xs whitespace-nowrap text-white",
                bgClass,
              )}
            >
              {name}
            </div>
          ) : null}
        </>
      )}
    </motion.div>
  );
}
