import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "./attachment";
import { MarkdownText } from "./markdown-text";
import { ToolFallback } from "./tool-fallback";
import { TooltipIconButton } from "./tooltip-icon-button";
import { useChatContext } from "../engine/chat-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  useAuiState,
  useThreadViewport,
  useThreadViewportStore,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  LoaderIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
  SparklesIcon,
} from "lucide-react";
import type { FC } from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { AssistantRunLog } from "../types";

// ── Thread root ───────────────────────────────────────────────────────────────

const ThreadActiveContext = createContext(true);

export const Thread: FC<{ isActive?: boolean }> = ({ isActive = true }) => {
  return (
    <ThreadActiveContext.Provider value={isActive}>
      <ThreadPrimitive.Root
        className="chat-thread-root aui-root @container flex h-full flex-col"
        style={{
          ["--thread-max-width" as string]: "40rem",
          ["--composer-radius" as string]: "6px",
          ["--composer-padding" as string]: "8px",
        }}
      >
        <ThreadPrimitive.Viewport
          turnAnchor="top"
          className="chat-thread-viewport relative flex flex-1 flex-col overflow-x-hidden overflow-y-auto scroll-smooth"
        >
          <div className="mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-3 pt-3">
            <AuiIf condition={(s) => s.thread.isEmpty}>
              <ThreadWelcome />
            </AuiIf>

            <div className="mb-10 flex flex-col gap-y-5 empty:hidden">
              <ThreadPrimitive.Messages>
                {() => <ThreadMessage />}
              </ThreadPrimitive.Messages>
            </div>

            <ThreadPrimitive.ViewportFooter className="chat-thread-footer sticky bottom-0 mt-auto flex flex-col gap-1.5 overflow-visible rounded-t-(--composer-radius) pb-1.5 md:pb-2">
              <ThreadScrollToBottom />
              <ChatStatusLoader />
              <Composer />
            </ThreadPrimitive.ViewportFooter>
          </div>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </ThreadActiveContext.Provider>
  );
};

// ── Message router ────────────────────────────────────────────────────────────

const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);

  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessage />;
};

// ── Scroll to bottom ──────────────────────────────────────────────────────────

const ThreadScrollToBottom: FC = () => {
  const isAtBottom = useThreadViewport((s) => s.isAtBottom);
  const viewportStore = useThreadViewportStore();

  const scrollToBottom = useCallback(() => {
    viewportStore.getState().scrollToBottom({ behavior: "smooth" });
  }, [viewportStore]);

  return (
    <TooltipIconButton
      tooltip="Scroll to bottom"
      variant="outline"
      aria-hidden={isAtBottom}
      tabIndex={isAtBottom ? -1 : 0}
      onClick={scrollToBottom}
      className={cn(
        "chat-scroll-bottom-button absolute left-1/2 top-0 z-20 !size-10 !rounded-full !p-0",
        isAtBottom ? "pointer-events-none" : "is-visible",
      )}
    >
      <ArrowDownIcon className="size-4" />
    </TooltipIconButton>
  );
};

// ── Welcome screen ────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  idle: "",
  loading: "loading",
  "checking-memory": "checking memory",
  "choosing-tool": "choosing tool",
  "calling-tool": "calling tool",
  reasoning: "reasoning",
  crafting: "crafting response",
  "saving-memory": "saving memory",
} as const;

const ChatStatusLoader: FC = () => {
  const { activityStatus } = useChatContext();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const label = activityStatus !== "idle" ? STATUS_LABELS[activityStatus] : (isRunning ? "working" : "");

  if (!label) return null;

  return (
    <div className="chat-run-status mx-auto flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
      <LoaderIcon className="size-3 animate-spin text-primary" />
      <span>{label}</span>
      <span className="chat-run-status-dots" aria-hidden>...</span>
    </div>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="my-auto flex grow flex-col">
      <div className="flex w-full grow flex-col items-center justify-center">
        <div className="flex size-full flex-col justify-center px-4">
          <div className="flex items-center gap-2 mb-1">
            <SparklesIcon className="size-4 text-primary" />
            <h1 className="fade-in slide-in-from-bottom-2 animate-in fill-mode-both font-mono text-[18px] font-semibold lowercase duration-300 text-foreground">
              ready
            </h1>
          </div>
          <p className="fade-in slide-in-from-bottom-2 animate-in fill-mode-both text-[13px] text-muted-foreground delay-100 duration-300">
            memory-aware local assistant
          </p>
        </div>
      </div>
      <ThreadSuggestions />
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  return (
    <div className="grid w-full @md:grid-cols-2 gap-2 pb-4">
      <ThreadPrimitive.Suggestions>
        {() => <ThreadSuggestionItem />}
      </ThreadPrimitive.Suggestions>
    </div>
  );
};

const ThreadSuggestionItem: FC = () => {
  return (
    <div className="fade-in slide-in-from-bottom-2 @md:nth-[n+3]:block nth-[n+3]:hidden animate-in fill-mode-both duration-300">
      <SuggestionPrimitive.Trigger send asChild>
        <Button
          variant="ghost"
          className="chat-suggestion h-auto w-full @md:flex-col flex-wrap items-start justify-start gap-1.5 rounded-sm px-3 py-2.5 text-start text-[13px] transition-all duration-150"
        >
          <SuggestionPrimitive.Title className="font-medium" />
          <SuggestionPrimitive.Description className="text-muted-foreground empty:hidden text-xs" />
        </Button>
      </SuggestionPrimitive.Trigger>
    </div>
  );
};

// ── Composer ──────────────────────────────────────────────────────────────────

const Composer: FC = () => {
  return (
    <ComposerPrimitive.Root className="relative flex w-full flex-col">
      <ComposerPrimitive.AttachmentDropzone asChild>
        <div
          className={cn(
            "chat-composer-shell relative flex w-full flex-col overflow-hidden rounded-(--composer-radius) p-0",
            "transition-all duration-150",
            "data-[dragging=true]:border-dashed",
          )}
        >
          <ComposerAttachments />
          <ComposerPrimitive.Input
            placeholder="Send a message..."
            className="chat-composer-input w-full resize-none bg-transparent px-2.5 pb-8 pt-2 text-[13px] leading-5 outline-none placeholder:text-muted-foreground/60"
            minRows={2}
            maxRows={8}
            autoFocus
            aria-label="Message input"
          />
          <ComposerAction />
        </div>
      </ComposerPrimitive.AttachmentDropzone>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  return (
    <div className="absolute inset-x-2.5 bottom-1.5 flex items-center justify-between">
      <ComposerAddAttachment />
      <AuiIf condition={(s) => !s.thread.isRunning}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="Send message"
            side="bottom"
            type="button"
            variant="default"
            size="icon"
            className="chat-send-button size-8 rounded-sm text-primary-foreground transition-all duration-150"
            aria-label="Send message"
          >
            <ArrowUpIcon className="size-4" />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(s) => s.thread.isRunning}>
        <ComposerPrimitive.Cancel asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            className="size-8 rounded-sm bg-destructive text-destructive-foreground transition-all duration-150 hover:bg-destructive/90"
            aria-label="Stop generating"
          >
            <SquareIcon className="size-3 fill-current" />
          </Button>
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </div>
  );
};

// ── Error display ─────────────────────────────────────────────────────────────

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-destructive text-sm transition-all duration-200">
        <ErrorPrimitive.Message className="line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

// ── Assistant message ─────────────────────────────────────────────────────────

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-role="assistant"
      className="fade-in slide-in-from-bottom-2 relative animate-in duration-200"
    >
      <div className="wrap-break-word px-2 text-foreground leading-relaxed">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            Reasoning: () => null,
            ReasoningGroup: () => null,
            tools: { Fallback: ToolFallback },
          }}
        />
        <MessageError />
        <AssistantDebugMeta />
      </div>

      <div className="chat-assistant-action-row ms-2 flex items-center">
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

function shortModelName(model = "") {
  const clean = model.split("/").pop() || model || "model";
  return clean.length > 24 ? `${clean.slice(0, 21)}...` : clean;
}

function formatDuration(ms?: number) {
  if (typeof ms !== "number") return "running";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

const AssistantDebugMeta: FC = () => {
  const { runLogsRef } = useChatContext();
  const [run, setRun] = useState<AssistantRunLog | null>(null);
  const isLast = useAuiState((s: any) => Boolean(s.message?.isLast));
  const isActive = useContext(ThreadActiveContext);

  useEffect(() => {
    if (!isActive) return;
    const refresh = () => {
      const latest = [...runLogsRef.current].reverse().find((entry) => entry.status !== "queued") || null;
      setRun(latest);
    };
    refresh();
    const interval = window.setInterval(refresh, 500);
    return () => window.clearInterval(interval);
  }, [isActive, runLogsRef]);

  if (!run || !isLast) return null;

  return (
    <div className="chat-message-meta">
      <span className="chat-meta-pill chat-meta-pill--model">{shortModelName(run.model)}</span>
      <span className="chat-meta-pill chat-meta-pill--run">{run.id.slice(0, 8)}</span>
      <span className="chat-meta-pill chat-meta-pill--time">{formatDuration(run.durationMs)}</span>
      <span className="chat-meta-pill chat-meta-pill--tools">{run.toolsUsed.length || run.toolCount} tools</span>
    </div>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="chat-message-actions col-start-3 row-start-2 -ms-1 flex gap-0.5 text-muted-foreground"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton tooltip="More" className="data-[state=open]:bg-accent">
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          className="z-50 min-w-32 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

// ── User message ──────────────────────────────────────────────────────────────

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-role="user"
      className="fade-in slide-in-from-bottom-2 grid animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-200 [&:where(>*)]:col-start-2"
    >
      <UserMessageAttachments />

      <div className="relative col-start-2 min-w-0">
        <div className="chat-user-message wrap-break-word peer rounded-sm px-3 py-2 text-foreground empty:hidden">
          <MessagePrimitive.Parts />
        </div>
        <div className="absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        className="col-span-full col-start-1 row-start-3 -me-1 justify-end"
      />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

// ── Edit composer ─────────────────────────────────────────────────────────────

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root className="flex flex-col px-2">
      <ComposerPrimitive.Root className="chat-edit-composer ms-auto flex w-full max-w-[85%] flex-col rounded-sm">
        <ComposerPrimitive.Input
          className="min-h-14 w-full resize-none bg-transparent p-3 text-foreground text-[13px] outline-none"
          autoFocus
        />
        <div className="mx-3 mb-3 flex items-center gap-2 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm">Cancel</Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm">Update</Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

// ── Branch picker ─────────────────────────────────────────────────────────────

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "-ms-2 me-2 inline-flex items-center text-muted-foreground text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
