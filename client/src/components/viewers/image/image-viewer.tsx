import * as React from "react";
import Zoom from "react-medium-image-zoom";
import "react-medium-image-zoom/dist/styles.css";
import { Loader2, AlertCircle, Image as ImageIcon } from "lucide-react";
import { fileApi } from "@/lib/file-api";
import { base64ToDataUrl } from "@/lib/binary";

interface Props {
  filePath: string;
}

export function ImageViewer({ filePath }: Props) {
  const [src, setSrc] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSrc(null);

    fileApi.readBinary(filePath)
      .then(res => {
        if (cancelled) return;
        setSrc(base64ToDataUrl(res.contentBase64, res.mime));
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "failed to load image");
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [filePath]);

  if (loading) {
    return (
      <div className="viewer-state">
        <Loader2 size={18} className="reterm-spin" />
        <span>loading image…</span>
      </div>
    );
  }

  if (error || !src) {
    return (
      <div className="viewer-state viewer-state--error">
        <AlertCircle size={18} />
        <span>{error || "image unavailable"}</span>
      </div>
    );
  }

  return (
    <div className="viewer-shell viewer-shell--image">
      <div className="viewer-toolbar">
        <div className="viewer-title">
          <ImageIcon size={14} />
          <span>{filePath.split(/[/\\]/).pop()}</span>
        </div>
      </div>

      <div className="viewer-canvas viewer-canvas--image">
        <Zoom>
          <img className="viewer-image" src={src} alt={filePath.split(/[/\\]/).pop() || "image"} />
        </Zoom>
      </div>
    </div>
  );
}

