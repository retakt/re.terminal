const fs = require("fs");

const file = "client/src/chat/engine/chat-provider.tsx";
let src = fs.readFileSync(file, "utf8");

const helper = String.raw`

function parseToolJsonResult(value: unknown): any {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return { ok: false, raw: value };
  }
}

function cleanOneLine(value: unknown, limit = 180) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function listObservedLabels(values: any[] = [], limit = 8) {
  return values
    .map((item) => cleanOneLine(item?.text || item?.label || item?.name || item?.href || item?.selector || ""))
    .filter(Boolean)
    .slice(0, limit);
}

function observationFromBrowserAgent(payload: any) {
  const found = payload?.whatFound;

  if (found?.url || found?.title || found?.links || found?.buttons || found?.forms || found?.interactiveElements) {
    return found;
  }

  if (found?.observed?.url || found?.observed?.title || found?.observed?.links || found?.observed?.buttons) {
    return found.observed;
  }

  const lastObserveStep = Array.isArray(payload?.steps)
    ? [...payload.steps].reverse().find((step: any) => step?.type === "observe")
    : null;

  const previewPayload = lastObserveStep?.resultPreview;
  const parsedPreview = typeof previewPayload === "string"
    ? parseToolJsonResult(previewPayload)
    : previewPayload;

  if (parsedPreview?.url || parsedPreview?.title || parsedPreview?.links || parsedPreview?.buttons) {
    return parsedPreview;
  }

  return null;
}

function formatBrowserAgentDirectResponse(payload: any) {
  const observation = observationFromBrowserAgent(payload);
  const currentUrl = cleanOneLine(payload?.currentUrl || observation?.url || "unknown", 260);
  const currentTitle = cleanOneLine(payload?.currentTitle || observation?.title || "untitled", 180);
  const summary = cleanOneLine(payload?.summary || "", 700);

  const forms = Array.isArray(observation?.forms) ? observation.forms : [];
  const buttons = [
    ...(Array.isArray(observation?.buttons) ? observation.buttons : []),
    ...(Array.isArray(observation?.interactiveElements)
      ? observation.interactiveElements.filter((el: any) => /button/i.test(String(el?.role || el?.tag || "")))
      : []),
  ];
  const links = [
    ...(Array.isArray(observation?.links) ? observation.links : []),
    ...(Array.isArray(observation?.interactiveElements)
      ? observation.interactiveElements.filter((el: any) => el?.href || /link/i.test(String(el?.role || el?.tag || "")))
      : []),
  ];
  const inputs = [
    ...(Array.isArray(observation?.inputs) ? observation.inputs : []),
    ...forms.flatMap((form: any) => Array.isArray(form?.fields) ? form.fields : []),
  ];

  const lines: string[] = [];
  lines.push("**current url/title:** " + currentUrl + " — " + currentTitle);

  if (summary) {
    lines.push("");
    lines.push("**what happened:** " + summary);
  }

  if (payload?.blockedReason) {
    lines.push("");
    lines.push("**blocked:** " + cleanOneLine(payload.blockedReason, 700));
  }

  if (observation?.textPreview || observation?.text) {
    lines.push("");
    lines.push("**page text preview:** " + cleanOneLine(observation.textPreview || observation.text, 900));
  }

  const buttonLabels = listObservedLabels(buttons, 10);
  const linkLabels = listObservedLabels(links, 10);
  const inputLabels = inputs
    .map((field: any) => {
      const label = cleanOneLine(field?.placeholder || field?.ariaLabel || field?.name || field?.id || field?.selector || "");
      const type = cleanOneLine(field?.secret ? "password" : field?.type || "");
      return label ? label + (type ? " (" + type + ")" : "") : "";
    })
    .filter(Boolean)
    .slice(0, 10);

  lines.push("");
  lines.push("**forms/buttons/links actually observed on this page:**");

  if (forms.length) lines.push("- forms: " + forms.length);
  if (inputLabels.length) lines.push("- inputs: " + inputLabels.join(", "));
  if (buttonLabels.length) lines.push("- buttons: " + buttonLabels.join(", "));
  if (linkLabels.length) lines.push("- links: " + linkLabels.join(", "));

  if (!forms.length && !inputLabels.length && !buttonLabels.length && !linkLabels.length) {
    lines.push("- none clearly detected");
  }

  const safeAgentActions = Array.isArray(payload?.possibleNextActions) && payload?.extensionId
    ? payload.possibleNextActions
        .map((action: any) => cleanOneLine(action?.label || action?.text || ""))
        .filter(Boolean)
        .slice(0, 8)
    : [];

  lines.push("");
  lines.push("**possible next actions:**");

  if (safeAgentActions.length) {
    safeAgentActions.forEach((label: string, index: number) => {
      lines.push(String(index + 1) + ". " + label);
    });
  } else {
    lines.push("1. tell me what visible button/link to click");
    lines.push("2. ask me to scrape the current page");
    lines.push("3. give me another URL to navigate");
    lines.push("4. tell me what to learn from this page");
  }

  lines.push("");
  if (payload?.requiresUser || payload?.status === "needs_user" || payload?.status === "blocked") {
    lines.push("I need your next instruction before acting again.");
  } else {
    lines.push("What would you like to do next?");
  }

  return lines.join("\n");
}
`;

const directRenderBlock = String.raw`
        const browserAgentResult = mode === "browser"
          ? toolResults.find((tr) => tr.name.startsWith("mcp__browser_agent__"))
          : null;

        if (browserAgentResult && !browserAgentResult.error) {
          const parsed = parseToolJsonResult(browserAgentResult.result);
          const responseText = formatBrowserAgentDirectResponse(parsed);

          syncRunFromTools("success");
          setActivityStatus("idle");

          yield {
            content: [
              { type: "text" as const, text: responseText },
            ],
          };

          return;
        }

`;

if (!src.includes("function parseToolJsonResult(value: unknown): any")) {
  const marker = "function forcedMcpTool(text: string, sessionId: string, enabledTools: OllamaTool[], mode: ChatMode) {";
  if (!src.includes(marker)) {
    throw new Error("Could not find forcedMcpTool marker");
  }
  src = src.replace(marker, helper + "\n" + marker);
  console.log("inserted browser-agent direct formatting helpers");
} else {
  console.log("helpers already present");
}

if (!src.includes("const browserAgentResult = mode === \"browser\"")) {
  const marker = "        const toolErrors = toolResults.filter((tr) => tr.error);";
  if (!src.includes(marker)) {
    throw new Error("Could not find toolErrors marker");
  }
  src = src.replace(marker, directRenderBlock + marker);
  console.log("inserted browser-agent direct render block");
} else {
  console.log("direct render block already present");
}

fs.writeFileSync(file, src, "utf8");
console.log("updated " + file);
