function cleanPreview(value, limit = 220) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  const normalized = String(text || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function parseUsage(value) {
  if (!value || typeof value !== "object") return null;
  return value.usage && typeof value.usage === "object" ? value.usage : value;
}

function parseResultValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mapStatus(status) {
  if (status === "complete") return "success";
  if (status === "error") return "error";
  return "info";
}

export function convertMcpLogToAuditInput(entry, options = {}) {
  const parsedResult = parseResultValue(entry?.result);
  const usage = parseUsage(parsedResult);
  const tool = String(entry?.tool || "mcp call");
  const serverId = String(entry?.serverId || "unknown");
  const durationMs = Number(entry?.durationMs || 0);
  const argsPreview = cleanPreview(entry?.args, 120);
  const resultPreview = cleanPreview(entry?.result, 240);

  return {
    id: options.id || `mcp-${entry?.id || Date.now()}`,
    ts: Number.isFinite(Number(entry?.startedAt)) && Number(entry.startedAt) > 0
      ? new Date(Number(entry.startedAt)).toISOString()
      : new Date().toISOString(),
    source: options.source || "server.mcp.gateway",
    category: "mcp",
    action: options.action || "gateway.call",
    status: mapStatus(String(entry?.status || "running")),
    title: tool,
    summary: `${tool} server=${serverId} ${durationMs}ms args=${argsPreview}${resultPreview ? ` -> ${resultPreview}` : ""}`,
    refs: {
      tool,
      serverId,
      gatewayLogId: entry?.id || null,
      startedAt: Number(entry?.startedAt || 0) || null,
      durationMs,
      importedFromGatewayLog: options.imported === true,
    },
    usage,
    payload: {
      tool,
      serverId,
      args: entry?.args || {},
      status: entry?.status || "running",
      startedAt: Number(entry?.startedAt || 0) || null,
      durationMs,
      result: entry?.result ?? "",
    },
  };
}

export function convertMcpLogsToAuditInputs(entries = [], options = {}) {
  return (Array.isArray(entries) ? entries : [entries])
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => convertMcpLogToAuditInput(entry, options));
}
