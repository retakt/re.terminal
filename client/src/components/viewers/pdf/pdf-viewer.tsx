import * as React from "react";
import { AlertCircle, FileText, Loader2 } from "lucide-react";
import { fileApi } from "@/lib/file-api";
import { base64ToUint8Array } from "@/lib/binary";

interface Props {
  filePath: string;
}

export function PdfViewer({ filePath }: Props) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    setUrl(null);

    fileApi.readBinary(filePath)
      .then(res => {
        if (cancelled) return;
        const bytes = base64ToUint8Array(res.contentBase64);
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: res.mime || "application/pdf" }));
        setUrl(objectUrl);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "failed to load pdf");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [filePath]);

  if (loading) {
    return (
      <div className="viewer-state">
        <Loader2 size={18} className="reterm-spin" />
        <span>loading pdf…</span>
      </div>
    );
  }

  if (error || !url) {
    return (
      <div className="viewer-state viewer-state--error">
        <AlertCircle size={18} />
        <span>{error || "pdf unavailable"}</span>
      </div>
    );
  }

  return (
    <div className="viewer-shell viewer-shell--pdf">
      <div className="viewer-toolbar">
        <div className="viewer-title">
          <FileText size={14} />
          <span>{filePath.split(/[/\\]/).pop()}</span>
        </div>
        <div className="viewer-meta">native pdf viewer</div>
      </div>

      <div className="viewer-scroll viewer-scroll--pdf">
        <object className="viewer-pdf-object" data={url} type="application/pdf" aria-label="pdf viewer">
          <iframe className="viewer-pdf-frame" src={url} title="pdf viewer" />
        </object>
      </div>
    </div>
  );
}
