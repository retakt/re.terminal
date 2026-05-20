import * as React from "react";
import { ChevronRight } from "lucide-react";

interface Props {
  path: string;
  className?: string;
  rootLabel?: string;
}

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export function ScrollableBreadcrumb({ path, className, rootLabel = "/" }: Props) {
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  const segments = React.useMemo(() => {
    const clean = normalizePath(path).trim();
    if (!clean) return [];
    return clean.split("/").filter(Boolean);
  }, [path]);

  React.useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const scrollToLatest = () => {
      el.scrollLeft = el.scrollWidth;
    };

    scrollToLatest();
    const raf = requestAnimationFrame(scrollToLatest);
    return () => cancelAnimationFrame(raf);
  }, [path, segments.length]);

  return (
    <div
      ref={scrollerRef}
      className={`scroll-breadcrumb${className ? ` ${className}` : ""}`}
      title={normalizePath(path)}
      aria-label="file path"
    >
      <span className="scroll-breadcrumb__root">{rootLabel}</span>
      {segments.map((segment, index) => (
        <React.Fragment key={`${segment}-${index}`}>
          <ChevronRight size={11} className="scroll-breadcrumb__sep" />
          <span className="scroll-breadcrumb__item">{segment}</span>
        </React.Fragment>
      ))}
    </div>
  );
}
