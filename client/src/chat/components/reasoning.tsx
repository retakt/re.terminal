import { memo, useEffect, useRef, useState } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import {
  useAuiState,
  type ReasoningMessagePartComponent,
  type ReasoningGroupComponent,
} from "@assistant-ui/react";
import { MarkdownText } from "./markdown-text";
import { cn } from "@/lib/utils";

const ANIMATION_DURATION = 200;

const reasoningVariants = cva("mb-4 w-full rounded-lg border px-3 py-2", {
  variants: {
    variant: {
      outline: "border-border/50",
      ghost: "",
      muted: "bg-muted/50 border-muted/30",
    },
  },
  defaultVariants: {
    variant: "outline",
  },
});

export type ReasoningRootProps = Omit<
  React.ComponentProps<"div">,
  "open" | "onOpenChange"
> &
  VariantProps<typeof reasoningVariants> & {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    defaultOpen?: boolean;
  };

function ReasoningRoot({
  className,
  variant,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ReasoningRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [uncontrolledOpen] = useState(defaultOpen);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  return (
    <div
      ref={collapsibleRef}
      data-slot="reasoning-root"
      data-variant={variant}
      data-state={isOpen ? "open" : "closed"}
      className={cn("group/reasoning-root", reasoningVariants({ variant, className }))}
      style={{ "--animation-duration": `${ANIMATION_DURATION}ms` } as React.CSSProperties}
      {...props}
    >
      {children}
    </div>
  );
}

function ReasoningTrigger({
  active,
  duration,
  className,
  onClick,
  ...props
}: React.ComponentProps<"button"> & {
  active?: boolean;
  duration?: number;
}) {
  const durationText = duration ? ` (${duration}s)` : "";

  return (
    <button
      data-slot="reasoning-trigger"
      className={cn(
        "group/trigger flex max-w-[75%] items-center gap-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground bg-transparent border-none cursor-pointer",
        className,
      )}
      onClick={onClick}
      {...props}
    >
      <BrainIcon data-slot="reasoning-trigger-icon" className="size-3 shrink-0" />
      <span className="relative inline-block leading-none">
        <span>Reasoning{durationText}</span>
        {active && (
          <span
            aria-hidden
            className="shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
          >
            Reasoning{durationText}
          </span>
        )}
      </span>
      <ChevronDownIcon
        className={cn(
          "mt-0.5 size-3 shrink-0 transition-transform duration-200 ease-out",
          "group-data-[state=closed]/reasoning-root:-rotate-90",
          "group-data-[state=open]/reasoning-root:rotate-0",
        )}
      />
    </button>
  );
}

function ReasoningContent({
  className,
  children,
  open,
  ...props
}: React.ComponentProps<"div"> & { open?: boolean }) {
  return (
    <div
      data-slot="reasoning-content"
      className={cn(
        "relative overflow-hidden text-[11px] text-muted-foreground outline-none",
        "transition-all duration-200 ease-out",
        open ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0",
        open ? "" : "pointer-events-none",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function ReasoningText({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="reasoning-text"
      className={cn(
        "relative z-0 max-h-64 space-y-4 overflow-y-auto ps-6 pt-2 pb-2 leading-relaxed",
        "[&_strong]:font-normal [&_strong]:text-muted-foreground/50",
        "[&_b]:font-normal [&_b]:text-muted-foreground/50",
        "[&_h1]:text-muted-foreground/50 [&_h1]:font-normal",
        "[&_h2]:text-muted-foreground/50 [&_h2]:font-normal",
        "[&_h3]:text-muted-foreground/50 [&_h3]:font-normal",
        className,
      )}
      {...props}
    />
  );
}

const ReasoningImpl: ReasoningMessagePartComponent = () => <MarkdownText />;

const ReasoningGroupImpl: ReasoningGroupComponent = ({
  children,
  startIndex,
  endIndex,
}) => {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);

  const isReasoningStreaming = useAuiState((s) => {
    if (s.message.status?.type !== "running") return false;
    const lastIndex = s.message.parts.length - 1;
    if (lastIndex < 0) return false;
    const lastType = s.message.parts[lastIndex]?.type;
    if (lastType !== "reasoning") return false;
    return lastIndex >= startIndex && lastIndex <= endIndex;
  });

  const prevStreaming = useRef(false);
  useEffect(() => {
    if (prevStreaming.current && !isReasoningStreaming && userOpen === null) {
      const t = setTimeout(() => setUserOpen(false), 0);
      return () => clearTimeout(t);
    }
    prevStreaming.current = isReasoningStreaming;
  }, [isReasoningStreaming, userOpen]);

  const isOpen = isReasoningStreaming ? true : (userOpen ?? false);

  return (
    <ReasoningRoot
      data-state={isOpen ? "open" : "closed"}
    >
      <ReasoningTrigger
        active={isReasoningStreaming}
        onClick={() => {
          if (!isReasoningStreaming) setUserOpen(!isOpen);
        }}
      />
      <ReasoningContent open={isOpen}>
        <ReasoningText>{children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  );
};

const Reasoning = memo(ReasoningImpl) as unknown as ReasoningMessagePartComponent & {
  Root: typeof ReasoningRoot;
  Trigger: typeof ReasoningTrigger;
  Content: typeof ReasoningContent;
  Text: typeof ReasoningText;
};

Reasoning.displayName = "Reasoning";
Reasoning.Root = ReasoningRoot;
Reasoning.Trigger = ReasoningTrigger;
Reasoning.Content = ReasoningContent;
Reasoning.Text = ReasoningText;

const ReasoningGroup = memo(ReasoningGroupImpl);
ReasoningGroup.displayName = "ReasoningGroup";

export { Reasoning, ReasoningGroup, ReasoningRoot, ReasoningTrigger, ReasoningContent, ReasoningText, reasoningVariants };
