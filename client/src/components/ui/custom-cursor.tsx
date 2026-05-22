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
  const [mouseInside, setMouseInside] = React.useState(false);

  const handleMouseMove = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;

      posX.set(localX);
      posY.set(localY);
    },
    [disabled, posX, posY],
  );

  if (disabled) return <>{children}</>;

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      style={hideNativeCursor ? { cursor: "none" } : undefined}
      onMouseEnter={() => setMouseInside(true)}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setMouseInside(false)}
    >
      {children}

      <AnimatePresence>
        {mouseInside && (
          <FollowCursor
            x={posX}
            y={posY}
            name={name}
            customSVG={customSVG}
            svgClassName={svgClassName}
            cursorColor={cursorColor}
            content={content}
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
  name,
  customSVG,
  svgClassName,
  cursorColor = "sky",
  content,
  panelClassName,
}: {
  x: MotionValue<number>;
  y: MotionValue<number>;
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

  return (
    <motion.div
      className="pointer-events-none absolute z-[999999]"
      style={{
        left: x,
        top: y,
      }}
      initial={{ scale: 0.96, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.96, opacity: 0 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      {content ? (
        <div className={cn("log-cursor-tooltip", panelClassName)}>
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