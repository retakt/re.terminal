function textOf(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function includesAny(text = "", patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

function compactEngineFailures(engineFailures = {}) {
  return Object.entries(engineFailures || {})
    .slice(-4)
    .map(([engine, failure]) => ({
      engine,
      error: textOf(failure?.error || ""),
      requestedUrl: textOf(failure?.requestedUrl || ""),
      at: textOf(failure?.at || ""),
    }));
}

export function adviseBrowserFailure({
  watcher = {},
  command = {},
  result = {},
  observation = {},
  state = {},
  verification = null,
} = {}) {
  const haystack = textOf([
    result?.error,
    result?.blockedReason,
    observation?.error,
    observation?.snapshotError,
    verification?.reason,
    verification?.blockedReason,
    result?.status,
    result?.engine,
    observation?.engine,
  ].filter(Boolean).join(" "));
  const lower = haystack.toLowerCase();
  const engine = textOf(result?.engine || observation?.engine || state?.activeEngine || "");
  const tool = textOf(command?.tool || watcher?.expectedTool || "");
  const intent = textOf(watcher?.intent || "");
  const staticFetch = engine === "static_fetch" || /\bstatic_fetch\b/i.test(haystack);
  const cdpUnavailable = includesAny(haystack, [
    /cdp.*(connect|connection|refused|closed|timeout|unavailable)/i,
    /engine_unavailable/i,
    /no cdp browser engine/i,
    /websocket/i,
  ]);
  const runtimeAction = /Click|Fill|Submit|Action/i.test(tool) || ["click_or_open", "fill_form", "fill_and_submit", "submit_form"].includes(intent);
  const backendProxy = includesAny(haystack, [
    /econnrefused/i,
    /proxy error/i,
    /localhost:3003/i,
    /\/api\/services\/status/i,
  ]);
  const staticInsufficient = staticFetch && (
    runtimeAction ||
    /static html fallback is not enough|visible actions data|interactive/i.test(lower)
  );

  let diagnosis = "";
  const evidence = [];
  const fixes = [];

  if (backendProxy) {
    diagnosis = "The frontend cannot reach the backend server.";
    evidence.push("Vite proxies /api and /ws to http://localhost:3003 in client/vite.config.ts.");
    evidence.push("ECONNREFUSED means nothing is listening on that port, or the server crashed.");
    fixes.push("Start the backend with `npm run dev:server` or run the full app with `npm run dev` from the repo root.");
    fixes.push("Check that server/server.js logs `re.Term server starting` on port 3003.");
  } else if (staticInsufficient) {
    diagnosis = "The agent only had static HTML, but the user asked for a runtime browser action or rendered interactive data.";
    evidence.push("static_fetch can read HTML/forms/links, but it cannot click, fill, submit, or see JS-rendered menus.");
    fixes.push("Start Lightpanda CDP with `lightpanda serve --host 127.0.0.1 --port 9222`.");
    fixes.push("If using Chrome instead, start it with `--remote-debugging-port=9222` and set `BROWSER_ENGINE=chrome` if needed.");
    fixes.push("Then ask `browser agent status` in /browser mode to verify CDP health.");
  } else if (cdpUnavailable) {
    diagnosis = "The runtime browser engine is unavailable or did not return a valid page snapshot.";
    evidence.push("The action requires CDP because it needs a live page, not a static fetch.");
    fixes.push("Start Lightpanda on CDP port 9222, or set `LIGHTPANDA_CDP_URL` / `BROWSER_CDP_URL` to the active CDP endpoint.");
    fixes.push("If Lightpanda runs on another PC, do not use 127.0.0.1. Set `LIGHTPANDA_CDP_URL=ws://OTHER_PC_IP:9222` and start Lightpanda with a non-local bind address such as `--host 0.0.0.0`.");
    fixes.push("Run `browser agent status` to inspect configured engine priority and health.");
  } else if (verification && verification.ok === false) {
    diagnosis = "The browser tool ran, but its result did not prove it satisfied the instruction.";
    evidence.push(verification.reason || "Verifier rejected the result.");
    fixes.push(verification.nextSafeAction || "Retry with a clearer target or observe the current page first.");
  } else if (!result?.ok) {
    diagnosis = "The browser tool failed.";
    evidence.push(haystack || "No detailed tool error was returned.");
    fixes.push("Retry after observing the current page, or ask for browser agent status.");
  }

  if (!diagnosis) return null;

  const failures = compactEngineFailures(state?.engineFailures);
  return {
    diagnosis,
    evidence: [
      ...evidence,
      tool ? `Selected tool: ${tool}.` : "",
      intent ? `Watcher intent: ${intent}.` : "",
      engine ? `Engine: ${engine}.` : "",
    ].filter(Boolean),
    suggestedFixes: fixes,
    engineFailures: failures,
  };
}
