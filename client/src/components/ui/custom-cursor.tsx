"use client";

import * as React from "react";
import { AnimatePresence, motion, useMotionValue } from "motion/react";
import { cn } from "@/lib/utils";

type CustomCursorProps = {
  children: React.ReactNode;
  content: React.ReactNode;
  className?: string;
  panelClassName?: string;
  disabled?: boolean;
  offsetX?: number;
  offsetY?: number;
};

export function Cursor({
  children,
  content,
  className,
  panelClassName,
  disabled = false,
  offsetX = 14,
  offsetY = 16,
}: CustomCursorProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [open, setOpen] = React.useState(false);

  const handleMove = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return;

      const panelWidth = 820;
      const panelHeight = 170;
      const padding = 12;

      let nextX = event.clientX + offsetX;
      let nextY = event.clientY + offsetY;

      if (nextX + panelWidth > window.innerWidth - padding) {
        nextX = event.clientX - panelWidth - offsetX;
      }

      if (nextY + panelHeight > window.innerHeight - padding) {
        nextY = event.clientY - panelHeight - offsetY;
      }

      nextX = Math.max(padding, nextX);
      nextY = Math.max(padding, nextY);

      x.set(nextX);
      y.set(nextY);
    },
    [disabled, offsetX, offsetY, x, y],
  );

  if (disabled) {
    return <>{children}</>;
  }

  return (
    <div
      className={cn("relative", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseMove={handleMove}
      onMouseLeave={() => setOpen(false)}
    >
      {children}

      <AnimatePresence>
        {open && (
          <motion.div
            className={cn("log-cursor-tooltip", panelClassName)}
            style={{ left: x, top: y }}
            initial={{ opacity: 0, scale: 0.985, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.985, y: 4 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}