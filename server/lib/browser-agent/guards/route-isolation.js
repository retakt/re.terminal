const FORBIDDEN_ROUTE_KEYS = {
  playwright: ["lightpanda", "lightpanda_cdp", "lightpanda_native_mcp"],
  lightpanda: ["playwright", "playwright_mcp"],
};

function walk(value, visit, path = []) {
  visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, visit, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    walk(entry, visit, [...path, key]);
  }
}

export function assertRouteIsolation(route = "", payload = {}) {
  const routeKey = String(route || "").toLowerCase();
  const forbidden = FORBIDDEN_ROUTE_KEYS[routeKey] || [];
  const violations = [];

  walk(payload, (value, path) => {
    if (typeof value !== "string") return;
    const text = value.toLowerCase();
    for (const token of forbidden) {
      if (!token) continue;
      if (text.includes(token)) {
        violations.push({
          path: path.join("."),
          token,
        });
      }
    }
  });

  return {
    ok: violations.length === 0,
    route: routeKey,
    violations,
  };
}

export function sanitizeRoutePayload(route = "", payload = {}) {
  const routeKey = String(route || "").toLowerCase();
  const forbidden = new Set(FORBIDDEN_ROUTE_KEYS[routeKey] || []);

  function sanitize(value) {
    if (Array.isArray(value)) return value.map(sanitize);
    if (!value || typeof value !== "object") {
      if (typeof value === "string") {
        const lower = value.toLowerCase();
        for (const token of forbidden) {
          if (token && lower.includes(token)) {
            return value.replace(new RegExp(token, "ig"), "[redacted]");
          }
        }
      }
      return value;
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitize(entry)]));
  }

  return sanitize(payload);
}

