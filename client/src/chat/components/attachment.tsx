import { type PropsWithChildren, useEffect, useState, type FC } from "react";
import { XIcon, PlusIcon, FileText } from "lucide-react";
import {
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useAuiState,
  useAui,
} from "@assistant-ui/react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";

const useFileSrc = (file: File | undefined) => {
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!file) {
      setSrc(undefined);
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setSrc(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return src;
};

const useAttachmentSrc = () => {
  const { file, src } = useAuiState(
    useShallow((s): { file?: File; src?: string } => {
      if (s.attachment.type !== "image") return {};
      if (s.attachment.file) return { file: s.attachment.file };
      const src = s.attachment.content?.filter((c) => c.type === "image")[0]?.image;
      if (!src) return {};
      return { src };
    }),
  );
  return useFileSrc(file) ?? src;
};

const AttachmentPreviewDialog: FC<PropsWithChildren> = ({ children }) => {
  const src = useAttachmentSrc();
  if (!src) return children;

  return (
    <div className="cursor-pointer transition-colors hover:bg-accent/50" onClick={() => {
      // Simple preview - could be enhanced with a dialog
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(`<img src="${src}" style="max-width:100%;height:auto;" />`);
      }
    }}>
      {children}
    </div>
  );
};

const AttachmentThumb: FC = () => {
  const src = useAttachmentSrc();
  return (
    <div className="h-full w-full flex items-center justify-center bg-muted/50">
      {src ? (
        <img src={src} alt="Attachment" className="h-full w-full object-cover" />
      ) : (
        <FileText className="size-8 text-muted-foreground" />
      )}
    </div>
  );
};

const AttachmentUI: FC = () => {
  const aui = useAui();
  const isComposer = aui.attachment.source !== "message";

  const isImage = useAuiState((s) => s.attachment.type === "image");
  const typeLabel = useAuiState((s) => {
    const type = s.attachment.type;
    switch (type) {
      case "image": return "Image";
      case "document": return "Document";
      case "file": return "File";
      default: return type;
    }
  });

  return (
    <AttachmentPrimitive.Root
      className={cn(
        "relative",
        isImage && "only:*:first:size-24",
      )}
    >
      <AttachmentPreviewDialog>
        <div
          className="size-14 cursor-pointer overflow-hidden rounded-[calc(var(--composer-radius)-var(--composer-padding))] border bg-muted transition-opacity hover:opacity-75"
          role="button"
          tabIndex={0}
          aria-label={`${typeLabel} attachment`}
          title={typeLabel}
        >
          <AttachmentThumb />
        </div>
      </AttachmentPreviewDialog>
      {isComposer && <AttachmentRemove />}
    </AttachmentPrimitive.Root>
  );
};

const AttachmentRemove: FC = () => {
  return (
    <AttachmentPrimitive.Remove asChild>
      <button
        className="absolute end-1.5 top-1.5 size-3.5 rounded-full bg-white text-muted-foreground opacity-100 shadow-sm hover:bg-white hover:text-destructive border-none cursor-pointer"
        aria-label="Remove file"
      >
        <XIcon className="size-3 dark:stroke-[2.5px]" />
      </button>
    </AttachmentPrimitive.Remove>
  );
};

export const UserMessageAttachments: FC = () => {
  return (
    <div className="col-span-full col-start-1 row-start-1 flex w-full flex-row justify-end gap-2">
      <MessagePrimitive.Attachments>
        {() => <AttachmentUI />}
      </MessagePrimitive.Attachments>
    </div>
  );
};

export const ComposerAttachments: FC = () => {
  return (
    <div className="flex w-full flex-row items-center gap-2 overflow-x-auto empty:hidden">
      <ComposerPrimitive.Attachments>
        {() => <AttachmentUI />}
      </ComposerPrimitive.Attachments>
    </div>
  );
};

export const ComposerAddAttachment: FC = () => {
  return (
    <ComposerPrimitive.AddAttachment asChild>
      <button
        className="size-8 rounded-full p-1 font-semibold text-xs hover:bg-muted-foreground/15 dark:border-muted-foreground/15 dark:hover:bg-muted-foreground/30 bg-transparent border-none cursor-pointer"
        aria-label="Add Attachment"
        title="Add Attachment"
      >
        <PlusIcon className="size-5 stroke-[1.5px]" />
      </button>
    </ComposerPrimitive.AddAttachment>
  );
};
