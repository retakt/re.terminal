import "@assistant-ui/react-markdown/styles/dot.css";
import "katex/dist/katex.min.css";

import {
  type CodeHeaderProps,
  type SyntaxHighlighterProps,
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { type FC, memo, type ComponentProps, type ComponentType, type ComponentPropsWithoutRef } from "react";
import ShikiHighlighter from "react-shiki";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

// ── Code header with copy button ──────────────────────────────────────────────

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (code) {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="mt-2.5 flex items-center justify-between rounded-t-lg border border-border/50 border-b-0 bg-muted/50 px-3 py-1.5 text-xs">
      <span className="font-medium text-muted-foreground lowercase">
        {language || "code"}
      </span>
      <button
        onClick={handleCopy}
        className="size-6 flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground transition-colors bg-transparent border-none cursor-pointer"
        title="Copy code"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
};

// ── Syntax-highlighted code block ─────────────────────────────────────────────

const SyntaxHighlighter: FC<SyntaxHighlighterProps> = ({
  components: { Pre, Code },
  language,
  code,
}) => {
  return (
    <Pre className="overflow-x-auto rounded-t-none rounded-b-lg border border-border/50 border-t-0 bg-muted/30 p-0 text-[13px] leading-relaxed font-mono">
      <ShikiHighlighter
        language={language || "plaintext"}
        theme="github-dark"
        delay={200}
        addDefaultStyles={false}
        showLanguage={false}
        as={Code as ComponentType<ComponentPropsWithoutRef<"code">>}
        className="block p-3"
      >
        {code}
      </ShikiHighlighter>
    </Pre>
  );
};

// ── Inline code ───────────────────────────────────────────────────────────────

function InlineCodeComponent({ className, children, ...props }: ComponentProps<"code">) {
  const isCodeBlock = useIsMarkdownCodeBlock();
  if (isCodeBlock) {
    return <code className={cn(className)} {...props}>{children}</code>;
  }
  const text = typeof children === "string" ? children : "";
  return (
    <code
      className={cn(
        "rounded-md border border-border/50 bg-muted/50 px-1.5 py-0.5 font-mono text-[0.85em] cursor-pointer hover:bg-muted/80 transition-colors",
        className,
      )}
      onClick={() => text && navigator.clipboard.writeText(text)}
      title={text ? "Click to copy" : undefined}
      {...props}
    >
      {children}
    </code>
  );
}

// ── Markdown components ───────────────────────────────────────────────────────

const defaultComponents = {
  ...memoizeMarkdownComponents({
    h1: ({ className, ...props }) => (
      <h1 className={cn("mb-2 scroll-m-20 font-semibold text-base first:mt-0 last:mb-0", className)} {...props} />
    ),
    h2: ({ className, ...props }) => (
      <h2 className={cn("mt-3 mb-1.5 scroll-m-20 font-semibold text-sm first:mt-0 last:mb-0", className)} {...props} />
    ),
    h3: ({ className, ...props }) => (
      <h3 className={cn("mt-2.5 mb-1 scroll-m-20 font-semibold text-sm first:mt-0 last:mb-0", className)} {...props} />
    ),
    h4: ({ className, ...props }) => (
      <h4 className={cn("mt-2 mb-1 scroll-m-20 font-medium text-sm first:mt-0 last:mb-0", className)} {...props} />
    ),
    h5: ({ className, ...props }) => (
      <h5 className={cn("mt-2 mb-1 font-medium text-sm first:mt-0 last:mb-0", className)} {...props} />
    ),
    h6: ({ className, ...props }) => (
      <h6 className={cn("mt-2 mb-1 font-medium text-sm first:mt-0 last:mb-0", className)} {...props} />
    ),
    p: ({ className, ...props }) => (
      <p className={cn("my-2.5 leading-normal first:mt-0 last:mb-0", className)} {...props} />
    ),
    a: ({ className, ...props }) => (
      <a className={cn("text-primary underline underline-offset-2 hover:text-primary/80", className)} {...props} />
    ),
    blockquote: ({ className, ...props }) => (
      <blockquote className={cn("my-2.5 border-muted-foreground/30 border-s-2 ps-3 text-muted-foreground italic", className)} {...props} />
    ),
    ul: ({ className, ...props }) => (
      <ul className={cn("my-2 ms-4 list-disc marker:text-muted-foreground [&>li]:mt-1", className)} {...props} />
    ),
    ol: ({ className, ...props }) => (
      <ol className={cn("my-2 ms-4 list-decimal marker:text-muted-foreground [&>li]:mt-1", className)} {...props} />
    ),
    hr: ({ className, ...props }) => (
      <hr className={cn("my-2 border-muted-foreground/20", className)} {...props} />
    ),
    table: ({ className, ...props }) => (
      <table className={cn("my-2 w-full border-separate border-spacing-0 overflow-y-auto", className)} {...props} />
    ),
    th: ({ className, ...props }) => (
      <th className={cn("bg-muted px-2 py-1 text-start font-medium first:rounded-ss-lg last:rounded-se-lg [[align=center]]:text-center [[align=right]]:text-right", className)} {...props} />
    ),
    td: ({ className, ...props }) => (
      <td className={cn("border-muted-foreground/20 border-s border-b px-2 py-1 text-start last:border-e [[align=center]]:text-center [[align=right]]:text-right", className)} {...props} />
    ),
    tr: ({ className, ...props }) => (
      <tr className={cn("m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-es-lg [&:last-child>td:last-child]:rounded-ee-lg", className)} {...props} />
    ),
    li: ({ className, ...props }) => (
      <li className={cn("leading-normal", className)} {...props} />
    ),
    sup: ({ className, ...props }) => (
      <sup className={cn("[&>a]:text-xs [&>a]:no-underline", className)} {...props} />
    ),
    pre: ({ className, ...props }) => (
      <pre className={cn("overflow-x-auto rounded-t-none rounded-b-lg border border-border/50 border-t-0 bg-muted/30 p-3 text-xs leading-relaxed", className)} {...props} />
    ),
    CodeHeader,
    SyntaxHighlighter,
  }),
  code: InlineCodeComponent,
};

// ── MarkdownText component ────────────────────────────────────────────────────

const MarkdownTextImpl = () => {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
      rehypePlugins={[[rehypeKatex, { strict: false, trust: true }]]}
      className="prose max-w-none text-[14px] leading-[1.55] [&_p]:my-2 [&_p]:leading-[1.55] [&_li]:leading-[1.55] [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&>*:empty]:hidden [&_ul:empty]:hidden [&_li:empty]:hidden"
      components={defaultComponents}
    />
  );
};

export const MarkdownText = memo(MarkdownTextImpl);
