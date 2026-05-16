import * as React from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertCircle, FileSpreadsheet, Loader2 } from "lucide-react";
import { fileApi } from "@/lib/file-api";
import { base64ToUint8Array } from "@/lib/binary";
import { getFileExtension } from "@/lib/file-routing";

interface Props {
  filePath: string;
}

function decodeText(bytes: Uint8Array) {
  return new TextDecoder("utf-8").decode(bytes);
}

function normalizeRows(rows: unknown[][]) {
  return rows.map(row => row.map(cell => cell == null ? "" : String(cell)));
}

export function SpreadsheetViewer({ filePath }: Props) {
  const [rows, setRows] = React.useState<string[][]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);

    fileApi.readBinary(filePath)
      .then(res => {
        if (cancelled) return;
        const ext = getFileExtension(filePath);
        const bytes = base64ToUint8Array(res.contentBase64);

        if (ext === "csv") {
          const parsed = Papa.parse<string[]>(decodeText(bytes), {
            skipEmptyLines: true,
          });
          if (parsed.errors.length > 0 && !parsed.data.length) {
            throw new Error(parsed.errors[0]?.message || "csv parse failed");
          }
          setRows(normalizeRows(parsed.data as unknown[][]));
        } else {
          const workbook = XLSX.read(bytes, { type: "array" });
          const sheetName = workbook.SheetNames[0];
          if (!sheetName) {
            setRows([]);
          } else {
            const sheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
              header: 1,
              blankrows: false,
              defval: "",
            });
            setRows(normalizeRows(data));
          }
        }

        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "failed to load spreadsheet");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const header = rows[0] || [];
  const bodyRows = rows.slice(1);
  const columnCount = React.useMemo(
    () => Math.max(header.length, ...bodyRows.map(row => row.length), 0),
    [bodyRows, header.length],
  );

  const rowVirtualizer = useVirtualizer({
    count: bodyRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 34,
    overscan: 8,
  });

  if (loading) {
    return (
      <div className="viewer-state">
        <Loader2 size={18} className="reterm-spin" />
        <span>loading spreadsheet…</span>
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

  if (rows.length === 0) {
    return (
      <div className="viewer-state">
        <FileSpreadsheet size={18} />
        <span>empty spreadsheet</span>
      </div>
    );
  }

  const gridStyle = {
    minWidth: `${Math.max(columnCount, 1) * 128}px`,
    gridTemplateColumns: `repeat(${Math.max(columnCount, 1)}, minmax(128px, 1fr))`,
  } as React.CSSProperties;

  return (
    <div className="viewer-shell viewer-shell--spreadsheet">
      <div className="viewer-toolbar">
        <div className="viewer-title">
          <FileSpreadsheet size={14} />
          <span>{filePath.split(/[/\\]/).pop()}</span>
        </div>
        <div className="viewer-meta">
          {rows.length} row{rows.length === 1 ? "" : "s"}
        </div>
      </div>

      <div ref={scrollRef} className="viewer-scroll viewer-scroll--spreadsheet">
        <div className="viewer-spreadsheet-header" style={gridStyle}>
          {Array.from({ length: Math.max(columnCount, 1) }, (_, index) => {
            const label = header[index] || `col ${index + 1}`;
            return (
              <div key={index} className="viewer-cell viewer-cell--header">
                {label}
              </div>
            );
          })}
        </div>

        <div className="viewer-spreadsheet-body" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
          {rowVirtualizer.getVirtualItems().map(virtualRow => {
            const row = bodyRows[virtualRow.index] || [];
            return (
              <div
                key={virtualRow.key}
                className="viewer-spreadsheet-row"
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div className="viewer-spreadsheet-grid" style={gridStyle}>
                  {Array.from({ length: Math.max(columnCount, 1) }, (_, columnIndex) => (
                    <div key={columnIndex} className="viewer-cell">
                      {row[columnIndex] || ""}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

