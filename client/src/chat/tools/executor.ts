// ── Tool executors ───────────────────────────────────────────────────────────
// Pure functions — no React dependencies. Reusable by scripts/MCP/extensions.

import { callMcpTool } from "../api/mcp";

const DIRECT_SEARXNG_URL = (import.meta.env.VITE_SEARXNG_URL as string | undefined)?.replace(/\/+$/, "");

// ── Weather ──────────────────────────────────────────────────────────────────

export async function toolGetWeather(city: string): Promise<string> {
  try {
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return `Could not fetch weather for ${city}.`;
    const data = await res.json();
    const current = data.current_condition?.[0];
    if (!current) return `No weather data available for ${city}.`;
    const desc = current.weatherDesc?.[0]?.value ?? "Unknown";
    const tempC = current.temp_C;
    const feelsC = current.FeelsLikeC;
    const humidity = current.humidity;
    const windKmph = current.windspeedKmph;
    const visibility = current.visibility;
    const forecast = (data.weather ?? []).slice(0, 3).map((day: any) => {
      const date = day.date;
      const maxC = day.maxtempC;
      const minC = day.mintempC;
      const dayDesc = day.hourly?.[4]?.weatherDesc?.[0]?.value ?? "";
      return `${date}: ${dayDesc}, ${minC}°C–${maxC}°C`;
    }).join(" | ");
    return `Weather in ${city}: ${desc}, ${tempC}°C (feels like ${feelsC}°C), humidity ${humidity}%, wind ${windKmph} km/h, visibility ${visibility} km. 3-day forecast: ${forecast}`;
  } catch {
    return `Failed to fetch weather for ${city}. Network error.`;
  }
}

// ── Exchange rate ────────────────────────────────────────────────────────────

export async function toolGetExchangeRate(from: string, to: string): Promise<string> {
  try {
    const base = from.toUpperCase();
    const target = to.toUpperCase();
    const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    if (!res.ok) return `Could not fetch exchange rates for ${base}.`;
    const data = await res.json();
    if (data.result !== "success") return `Exchange rate API error for ${base}.`;
    const rates = data.rates;
    const updated = data.time_last_update_utc ?? "";
    if (target === "ALL") {
      const common = ["USD", "EUR", "GBP", "JPY", "SGD", "AUD", "CNY", "KRW", "THB", "IDR"];
      const lines = common.filter((c) => rates[c]).map((c) => `${c}: ${rates[c].toFixed(4)}`);
      return `Exchange rates for 1 ${base} (updated ${updated}): ${lines.join(", ")}`;
    }
    const rate = rates[target];
    if (!rate) return `Currency code ${target} not found.`;
    return `1 ${base} = ${rate.toFixed(4)} ${target} (updated ${updated})`;
  } catch {
    return "Failed to fetch exchange rate. Network error.";
  }
}

// ── Time ─────────────────────────────────────────────────────────────────────

export function toolGetTime(timezone: string): string {
  try {
    const now = new Date();
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
      timeZoneName: "short",
    }).format(now);
    return `Current time in ${timezone}: ${formatted}`;
  } catch {
    return `Unknown timezone: ${timezone}. Use IANA format like 'Asia/Tokyo'.`;
  }
}

// ── Web search (SearXNG) ─────────────────────────────────────────────────────

const SCORE_THRESHOLD = 0.4;

const RESULT_LIMITS: Record<string, number> = {
  general: 5,
  factcheck: 3,
  news: 3,
  reddit: 3,
  wiki: 2,
  code: 3,
};

const QUERY_SUFFIXES: Record<string, string> = {
  general: "",
  factcheck: "site:wikipedia.org OR site:reuters.com OR site:bbc.com OR site:apnews.com",
  news: "news",
  reddit: "site:reddit.com",
  wiki: "wikipedia",
  code: "site:stackoverflow.com OR site:github.com",
};

interface SearXNGResult {
  title: string;
  url: string;
  content: string;
  score: number;
  engine: string;
}

export async function toolSearchWeb(query: string, mode: string): Promise<string> {
  if (!query.trim()) return "No search query provided.";

  const modeKey = RESULT_LIMITS[mode] ? mode : "general";
  const maxResults = RESULT_LIMITS[modeKey];
  const suffix = QUERY_SUFFIXES[modeKey];
  const shapedQuery = suffix ? `${query.trim()} ${suffix}` : query.trim();

  try {
    return await callMcpTool("mcp__web__search", {
      query: shapedQuery,
      limit: String(maxResults),
    });
  } catch (mcpError) {
    if (!DIRECT_SEARXNG_URL) {
      const message = mcpError instanceof Error ? mcpError.message : String(mcpError);
      return `Search failed: ${message}`;
    }
  }

  try {
    const params = new URLSearchParams({
      q: shapedQuery,
      format: "json",
      pageno: "1",
      language: "en",
    });

    const res = await fetch(`${DIRECT_SEARXNG_URL}/search?${params.toString()}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return "Search unavailable. Answering from training data.";

    const data = await res.json();
    const raw: SearXNGResult[] = (data.results ?? [])
      .filter((r: any) => r.title && r.url && r.content && (r.score ?? 0) >= SCORE_THRESHOLD)
      .map((r: any) => ({
        title: String(r.title).trim(),
        url: String(r.url).trim(),
        content: String(r.content).trim().slice(0, 400),
        score: r.score ?? 0,
        engine: r.engine ?? "unknown",
      }));

    // Deduplicate by domain
    const seenDomains = new Set<string>();
    const deduped = raw.filter((r) => {
      try {
        const domain = new URL(r.url).hostname.replace(/^www\./, "");
        if (seenDomains.has(domain)) return false;
        seenDomains.add(domain);
        return true;
      } catch {
        return true;
      }
    });

    const top = deduped.slice(0, maxResults);

    if (top.length === 0) return "Search returned no relevant results. Answering from training data.";

    const label = modeKey === "factcheck" ? "Fact-check" : `Search (${modeKey})`;
    const lines = top.map((r, i) => `[${i + 1}] ${r.title} — ${r.content} (${r.url})`);
    return `${label}:\n${lines.join("\n")}`;
  } catch {
    return "Search failed. Answering from training data.";
  }
}

// ── Tool dispatcher ──────────────────────────────────────────────────────────

export async function executeTool(name: string, args: Record<string, string>): Promise<string> {
  if (name.startsWith("mcp__")) {
    return callMcpTool(name, args);
  }

  switch (name) {
    case "get_weather":
      return toolGetWeather(args.city ?? "Kuala Lumpur");
    case "get_exchange_rate":
      return toolGetExchangeRate(args.from ?? "MYR", args.to ?? "USD");
    case "get_time":
      return toolGetTime(args.timezone ?? "Asia/Kuala_Lumpur");
    case "search_web":
      return toolSearchWeb(args.query ?? "", args.mode ?? "general");
    default:
      return `Unknown tool: ${name}`;
  }
}
