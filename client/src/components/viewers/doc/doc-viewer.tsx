import * as React from "react";
import * as mammoth from "mammoth";
import { AlertCircle, FileText, Loader2 } from "lucide-react";
import { fileApi } from "@/lib/file-api";
import { base64ToUint8Array } from "@/lib/binary";

interface Props {
  filePath: string;
}

export function DocViewer({ filePath }: Props) {
  const [html, setHtml] = React.useState<string>("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [messageCount, setMessageCount] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml("");
    setMessageCount(0);

    fileApi.readBinary(filePath)
      .then(async res => {
        const bytes = base64ToUint8Array(res.contentBase64);
        const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
        if (cancelled) return;
        setHtml(result.value);
        setMessageCount(result.messages.length);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "failed to load document");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (loading) {
    return (
      <div className="viewer-state">
        <Loader2 size={18} className="reterm-spin" />
        <span>loading document…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="viewer-state viewer-state--error">
        <AlertCircle size={18} />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="viewer-shell viewer-shell--doc">
      <div className="viewer-toolbar">
        <div className="viewer-title">
          <FileText size={14} />
          <span>{filePath.split(/[/\\]/).pop()}</span>
        </div>
        <div className="viewer-meta">
          {messageCount > 0 ? `${messageCount} note${messageCount === 1 ? "" : "s"}` : "docx"}
        </div>
      </div>

      <div className="viewer-scroll viewer-doc-scroll">
        <div className="viewer-doc" dangerouslySetInnerHTML={{ __html: html || "<p>No document content.</p>" }} />
      </div>
    </div>
  );
}
