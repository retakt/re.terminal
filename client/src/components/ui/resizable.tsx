"use client"

import { GripVertical } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) => (
  <ResizablePrimitive.Group
    className={cn(
      "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
      className,
    )}
    {...props}
  />
)

const ResizablePanel = ResizablePrimitive.Panel

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean
}) => (
  <ResizablePrimitive.Separator
    className={cn(
      "relative -mx-1 flex w-2 cursor-col-resize items-center justify-center bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-oklch(0.708 0 0) focus-visible:ring-offset-1 data-[panel-group-direction=vertical]:-my-1 data-[panel-group-direction=vertical]:mx-0 data-[panel-group-direction=vertical]:h-2 data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:cursor-row-resize dark:focus-visible:ring-oklch(0.556 0 0)",
      className,
    )}
    {...props}
  >
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-oklch(0.922 0 0) data-[panel-group-direction=vertical]:left-0 data-[panel-group-direction=vertical]:top-1/2 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:-translate-y-1/2 data-[panel-group-direction=vertical]:translate-x-0 dark:bg-oklch(1 0 0 / 10%)"
    />
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border border-oklch(0.922 0 0) bg-oklch(0.922 0 0) dark:border-oklch(1 0 0 / 10%) dark:bg-oklch(1 0 0 / 10%)">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </ResizablePrimitive.Separator>
)

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
