import { appendAuditEvents, queryAuditEvents } from "../lib/audit-log.js";
import { convertMcpLogsToAuditInputs } from "../lib/mcp-log-audit.js";

const baseUrl = process.env.RETERM_SERVER_URL || "http://127.0.0.1:3003";

async function tryServerImport() {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/logs/import-mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const data = await response.json().catch(() => ({}));
  if (response.ok && data.ok !== false) {
    return {
      mode: "server-route",
      imported: data.imported || 0,
      totalGatewayLogs: data.totalGatewayLogs || 0,
    };
  }

  if (response.status === 404) {
    return null;
  }

  throw new Error(data.error || `Import failed with HTTP ${response.status}`);
}

async function importFromGatewayFeed() {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/mcp/logs`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Gateway log fetch failed with HTTP ${response.status}`);
  }

  const logs = Array.isArray(data.logs) ? data.logs : [];
  const existingGatewayIds = new Set(
    queryAuditEvents({ category: "mcp", limit: 5000 }).events
      .map((event) => String(event?.refs?.gatewayLogId || ""))
      .filter(Boolean),
  );

  const missingLogs = logs.filter((entry) => !existingGatewayIds.has(String(entry?.id || "")));
  const appended = appendAuditEvents(
    convertMcpLogsToAuditInputs(missingLogs, {
      source: "server.mcp.import",
      action: "gateway.import",
      imported: true,
    }),
  );

  return {
    mode: "local-fallback",
    imported: appended.length,
    totalGatewayLogs: logs.length,
  };
}

async function main() {
  const imported = await tryServerImport();
  const result = imported || await importFromGatewayFeed();
  console.log(
    `Imported ${result.imported} MCP gateway log(s) into audit via ${result.mode}. Total gateway logs seen: ${result.totalGatewayLogs}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
