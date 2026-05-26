function safeText(value = "", limit = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function roundMs(value = 0) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstText(...values) {
  for (const value of values) {
    const text = safeText(value || "", 2000);
    if (text) return text;
  }
  return "";
}

function uniqueTexts(values = [], limit = 20) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = safeText(value, 500);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function maskSecretField(field = {}) {
  const secret = Boolean(field.secret) || /\b(password|pass|pwd|otp|code|pin|secret)\b/i.test(
    `${field.label || ""} ${field.name || ""} ${field.id || ""} ${field.type || ""}`
  );
  return {
    label: safeText(field.label || field.name || field.id || field.key || "", 160),
    value: secret ? "[redacted]" : safeText(field.value ?? field.valuePreview ?? field.actualPreview ?? "", 240),
    actualValue: secret ? "[redacted]" : safeText(field.actualPreview ?? field.actualValue ?? "", 240),
    type: safeText(field.type || "", 80),
    selector: safeText(field.selector || "", 220),
    verified: field.verified === undefined ? null : Boolean(field.verified),
    secret,
  };
}

function compactCommand(command = {}) {
  const args = command.args && typeof command.args === "object" && !Array.isArray(command.args)
    ? command.args
    : {};

  return {
    kind: safeText(command.kind || "", 80),
    tool: safeText(command.tool || "", 80),
    route: safeText(command.route || "", 80),
    notes: safeText(command.notes || "", 500),
    args: {
      url: safeText(args.url || args.currentUrl || "", 800),
      text: safeText(args.text || args.targetText || "", 240),
      query: safeText(args.query || args.focus || "", 300),
      direction: safeText(args.direction || args.to || "", 80),
      fullPage: args.fullPage === undefined ? undefined : Boolean(args.fullPage),
      expectedText: safeText(args.expectedText || "", 240),
      expectedUrl: safeText(args.expectedUrl || "", 800),
      expectedTitle: safeText(args.expectedTitle || "", 240),
      fields: asArray(args.fields).map(maskSecretField),
    },
  };
}

function imageFromSnapshot(snapshot = {}, stepIndex = 0, includeImages = false) {
  const base64 = safeText(snapshot.imageBase64 || "", Number.MAX_SAFE_INTEGER);
  const imagePath = safeText(snapshot.imagePath || "", 1000);
  if (!base64 && !imagePath) return null;

  const mimeType = safeText(snapshot.mimeType || "image/png", 80);
  return {
    id: `screenshot-${stepIndex}`,
    stepIndex,
    label: safeText(snapshot.label || "screenshot", 120),
    capturedAt: safeText(snapshot.capturedAt || "", 80),
    mimeType,
    imagePath,
    hasImage: Boolean(base64 || imagePath),
    bytesApprox: base64 ? Math.round(base64.length * 0.75) : 0,
    dataUrl: includeImages && base64 ? `data:${mimeType};base64,${base64}` : "",
  };
}

function screenshotsForStep(stepResult = {}, includeImages = false) {
  const stepIndex = Number(stepResult.step?.index || 0);
  const screenshots = [];
  const snapshotImage = imageFromSnapshot(stepResult.result?.snapshot || stepResult.afterSnapshot || {}, stepIndex, includeImages);
  if (snapshotImage) screenshots.push(snapshotImage);

  for (const [index, image] of asArray(stepResult.result?.images).entries()) {
    const data = safeText(image.data || image.imageBase64 || "", Number.MAX_SAFE_INTEGER);
    if (!data) continue;
    const mimeType = safeText(image.mimeType || image.mime_type || "image/png", 80);
    screenshots.push({
      id: `screenshot-${stepIndex}-${index + 1}`,
      stepIndex,
      label: `image ${index + 1}`,
      capturedAt: safeText(stepResult.result?.snapshot?.capturedAt || "", 80),
      mimeType,
      imagePath: "",
      hasImage: true,
      bytesApprox: Math.round(data.length * 0.75),
      dataUrl: includeImages ? `data:${mimeType};base64,${data.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "")}` : "",
    });
  }

  return screenshots;
}

function actionResultForStep(stepResult = {}) {
  return stepResult.result?.actionResult ||
    stepResult.result?.fillResult ||
    stepResult.result?.domFallback?.fillResult ||
    stepResult.result?.result?.actionResult ||
    {};
}

function filledFieldsForStep(stepResult = {}) {
  const action = actionResultForStep(stepResult);
  const fillResult = action.fillResult || action.domFallback?.fillResult || action;
  return asArray(fillResult.filled || fillResult.fields).map(maskSecretField);
}

function missingFieldsForStep(stepResult = {}) {
  const action = actionResultForStep(stepResult);
  const fillResult = action.fillResult || action.domFallback?.fillResult || action;
  return asArray(fillResult.missing).map((field) => ({
    key: safeText(field.key || field.label || field.name || field.selector || "field", 180),
    reason: safeText(field.reason || field.error || "", 240),
  }));
}

function scrollForStep(stepResult = {}) {
  const scroll =
    stepResult.result?.actionResult?.scroll ||
    stepResult.result?.scroll ||
    stepResult.afterSnapshot?.scroll ||
    stepResult.result?.observation?.scroll ||
    null;
  if (!scroll || typeof scroll !== "object") return null;
  const after = scroll.after || scroll;
  return {
    direction: safeText(scroll.direction || "", 80),
    before: scroll.before || null,
    after,
    scrollY: Number(after.scrollY || 0),
    viewportHeight: Number(after.viewportHeight || 0),
    scrollHeight: Number(after.scrollHeight || 0),
    progress: Number(after.progress || 0),
    hasMoreBelow: Boolean(after.hasMoreBelow),
    atBottom: Boolean(after.atBottom || scroll.reachedBottom),
    reachedBottom: Boolean(scroll.reachedBottom || after.atBottom),
  };
}

function extractionForStep(stepResult = {}) {
  const extracted = stepResult.result?.extracted || {};
  const observation = stepResult.result?.observation || stepResult.afterSnapshot || {};
  const source = extracted && typeof extracted === "object" ? extracted : {};
  return {
    textPreview: safeText(source.textPreview || source.text || observation.textPreview || observation.text || "", 1200),
    links: asArray(source.links || observation.links).slice(0, 20),
    buttons: asArray(source.buttons || observation.buttons).slice(0, 20),
    inputs: asArray(source.inputs || observation.inputs).slice(0, 30),
    forms: asArray(source.forms || observation.forms).slice(0, 10),
    counts: {
      links: asArray(source.links || observation.links).length,
      buttons: asArray(source.buttons || observation.buttons).length,
      inputs: asArray(source.inputs || observation.inputs).length,
      forms: asArray(source.forms || observation.forms).length,
    },
  };
}

function compactAgentTrace(trace = []) {
  return asArray(trace).map((entry) => ({
    role: safeText(entry.role || "", 80),
    title: safeText(entry.title || "", 120),
    status: safeText(entry.status || "", 80),
    ok: entry.ok === undefined ? null : Boolean(entry.ok),
    tool: safeText(entry.tool || "", 80),
    summary: safeText(entry.summary || entry.reason || "", 500),
    tokens: Number(entry.tokens || 0),
    durationMs: entry.durationMs === null || entry.durationMs === undefined ? null : roundMs(entry.durationMs),
  }));
}

function stepView(stepResult = {}, includeImages = false) {
  const screenshots = screenshotsForStep(stepResult, includeImages);
  const extraction = extractionForStep(stepResult);
  const filledFields = filledFieldsForStep(stepResult);
  const missingFields = missingFieldsForStep(stepResult);
  const scroll = scrollForStep(stepResult);
  const command = compactCommand(stepResult.command || {});
  const backend = firstText(stepResult.result?.backend, stepResult.result?.engine, "");

  return {
    id: `step-${Number(stepResult.step?.index || 0) || 0}`,
    index: Number(stepResult.step?.index || 0) || 0,
    kind: safeText(stepResult.step?.kind || command.kind || "", 80),
    text: safeText(stepResult.step?.text || "", 500),
    route: safeText(stepResult.route || stepResult.result?.route || "", 80),
    backend,
    tool: command.tool,
    status: safeText(stepResult.status || "", 80),
    ok: Boolean(stepResult.ok),
    durationMs: roundMs(stepResult.runtimeMs || 0),
    summary: safeText(stepResult.summary || stepResult.report?.summary || "", 900),
    nextSafeAction: safeText(stepResult.nextSafeAction || stepResult.report?.nextSafeAction || "", 700),
    currentUrl: firstText(stepResult.currentUrl, stepResult.afterSnapshot?.url, stepResult.result?.currentUrl),
    currentTitle: firstText(stepResult.currentTitle, stepResult.afterSnapshot?.title, stepResult.result?.currentTitle),
    command,
    checker: stepResult.agentTrace?.find?.((entry) => entry.role === "checker") || null,
    watcher: stepResult.watch || null,
    reporter: stepResult.report || null,
    verification: stepResult.result?.verification || null,
    extraction,
    filledFields,
    missingFields,
    scroll,
    screenshots,
    snapshotDelta: stepResult.snapshotDelta || null,
    isolation: stepResult.isolation || null,
    agents: compactAgentTrace(stepResult.agentTrace),
  };
}

function tokenUsageView(tokenUsage = {}) {
  return {
    totalTokens: Number(tokenUsage.totalTokens || 0),
    promptTokens: Number(tokenUsage.promptTokens || 0),
    completionTokens: Number(tokenUsage.completionTokens || 0),
    totalDurationMs: roundMs(tokenUsage.totalDurationMs || 0),
    models: asArray(tokenUsage.models),
    byRole: tokenUsage.roles || {},
    byRoute: tokenUsage.routes || {},
    calls: asArray(tokenUsage.callsDetail).map((call) => ({
      role: safeText(call.role || "", 80),
      route: safeText(call.route || "", 80),
      model: safeText(call.model || "", 120),
      provider: safeText(call.provider || "", 80),
      promptTokens: Number(call.promptTokens || 0),
      completionTokens: Number(call.completionTokens || 0),
      totalTokens: Number(call.totalTokens || 0),
      totalDurationMs: roundMs(call.totalDurationMs || 0),
    })),
  };
}

function planView(plan = {}) {
  return {
    status: safeText(plan.status || "", 80),
    userIntent: safeText(plan.userIntent || "", 500),
    routeHint: safeText(plan.routeHint || "", 80),
    reason: safeText(plan.reason || "", 900),
    confidence: Number(plan.confidence || 0),
    needsLightpandaWarmup: Boolean(plan.needsLightpandaWarmup),
    steps: asArray(plan.steps).map((step) => ({
      index: Number(step.index || 0),
      kind: safeText(step.kind || "", 80),
      text: safeText(step.text || "", 500),
      url: safeText(step.url || "", 800),
      targetText: safeText(step.targetText || "", 240),
      fields: asArray(step.fields).map(maskSecretField),
      shouldVerify: step.shouldVerify === undefined ? null : Boolean(step.shouldVerify),
      shouldScreenshot: Boolean(step.shouldScreenshot),
    })),
  };
}

function routeSelectionView(routeSelection = {}) {
  return {
    route: safeText(routeSelection.route || "", 80),
    reason: safeText(routeSelection.reason || "", 800),
    confidence: Number(routeSelection.confidence || 0),
    warmLightpanda: Boolean(routeSelection.warmLightpanda),
  };
}

function latestScroll(steps = []) {
  return [...steps].reverse().find((step) => step.scroll)?.scroll || null;
}

function reportFacts(result = {}, steps = []) {
  return uniqueTexts([
    ...asArray(result.report?.facts),
    ...steps.flatMap((step) => asArray(step.reporter?.facts)),
    ...steps.map((step) => step.verification?.reason),
    ...steps.map((step) => step.summary),
  ], 30);
}

function controlSummary(observation = {}) {
  return {
    url: safeText(observation.url || "", 800),
    title: safeText(observation.title || "", 240),
    textPreview: safeText(observation.textPreview || observation.text || "", 1200),
    links: asArray(observation.links).slice(0, 20),
    buttons: asArray(observation.buttons).slice(0, 20),
    inputs: asArray(observation.inputs).slice(0, 40),
    forms: asArray(observation.forms).slice(0, 10),
    stats: observation.stats || {},
  };
}

export function buildBrowserAgentUiReport(result = {}, options = {}) {
  const includeImages = options.includeImages === true;
  const steps = asArray(result.stepResults).map((step) => stepView(step, includeImages));
  const screenshots = steps.flatMap((step) => step.screenshots);
  const failedStep = steps.find((step) => !step.ok) || null;
  const backend = firstText(result.state?.routeEngine, steps.find((step) => step.backend)?.backend, result.route);
  const isolationOk = steps.every((step) => step.isolation?.ok !== false);
  const finalObservation = result.state?.lastValidObservation || result.state?.lastObservation || null;

  return {
    reportVersion: "browser-agent-ui-report/v1",
    generatedAt: new Date().toISOString(),
    ok: Boolean(result.ok),
    status: safeText(result.status || "", 80),
    route: safeText(result.route || result.state?.route || "", 80),
    backend,
    requiredUserInput: Boolean(result.requiredUserInput || result.status === "needs_user"),
    summary: safeText(result.summary || "", 1200),
    nextSafeAction: safeText(result.nextSafeAction || "", 900),
    current: {
      url: firstText(result.currentUrl, result.state?.currentUrl, finalObservation?.url),
      title: firstText(result.currentTitle, result.state?.currentTitle, finalObservation?.title),
    },
    routeIsolation: {
      ok: isolationOk,
      selectedRoute: safeText(result.route || "", 80),
      backend,
      stepRoutes: uniqueTexts(steps.map((step) => step.route), 10),
      stepBackends: uniqueTexts(steps.map((step) => step.backend), 10),
    },
    metrics: {
      totalMs: roundMs(result.runtimeTiming?.totalMs || 0),
      stepCount: steps.length,
      completedSteps: steps.filter((step) => step.ok).length,
      failedStepIndex: failedStep?.index || null,
      screenshotCount: screenshots.length,
      scrollCount: steps.filter((step) => step.tool === "browserScroll").length,
      reachedBottom: steps.some((step) => step.scroll?.reachedBottom || step.scroll?.atBottom),
    },
    llm: tokenUsageView(result.tokenUsage || {}),
    plan: planView(result.plan || {}),
    routeSelection: routeSelectionView(result.routeSelection || {}),
    steps,
    evidence: {
      facts: reportFacts(result, steps),
      screenshots,
      latestScroll: latestScroll(steps),
      finalObservation: controlSummary(finalObservation || {}),
      filledFields: steps.flatMap((step) => step.filledFields),
      missingFields: steps.flatMap((step) => step.missingFields),
    },
    trace: compactAgentTrace(result.agentTrace),
    raw: {
      hasRawResult: true,
      hasStepResults: steps.length > 0,
      imageDataIncluded: includeImages,
    },
  };
}

export function buildBrowserAgentStatusReport(status = {}) {
  const state = status.state || {};
  return {
    reportVersion: "browser-agent-status-report/v1",
    generatedAt: new Date().toISOString(),
    ok: Boolean(status.ok),
    status: safeText(status.status || "", 80),
    sessionId: safeText(status.sessionId || state.sessionId || "", 140),
    route: safeText(state.route || "", 80),
    backend: safeText(state.routeEngine || "", 80),
    current: {
      url: firstText(state.currentUrl, state.lastValidObservation?.url),
      title: firstText(state.currentTitle, state.lastValidObservation?.title),
    },
    lastInstruction: safeText(state.lastInstruction || "", 1000),
    lastCommand: compactCommand(state.lastCommand || {}),
    finalObservation: controlSummary(state.lastValidObservation || state.lastObservation || {}),
    history: asArray(state.history).slice(-20).map((entry) => ({
      at: safeText(entry.at || "", 80),
      route: safeText(entry.route || "", 80),
      tool: safeText(entry.tool || "", 80),
      status: safeText(entry.status || "", 80),
      url: safeText(entry.url || "", 800),
      title: safeText(entry.title || "", 240),
    })),
    runtime: status.runtime || null,
    browserHealth: status.browserHealth || null,
  };
}

export function buildBrowserAgentMarkdownReport(result = {}) {
  const report = result.uiReport || buildBrowserAgentUiReport(result);
  const lines = [
    `# Browser Agent Report`,
    ``,
    `Status: ${report.ok ? "success" : report.status || "failed"}`,
    `Route: ${report.route || "unknown"} (${report.backend || "unknown backend"})`,
    `URL: ${report.current.url || ""}`,
    `Summary: ${report.summary || ""}`,
    report.nextSafeAction ? `Next: ${report.nextSafeAction}` : "",
    ``,
    `## Metrics`,
    `- Total time: ${report.metrics.totalMs}ms`,
    `- Steps: ${report.metrics.completedSteps}/${report.metrics.stepCount}`,
    `- Screenshots: ${report.metrics.screenshotCount}`,
    `- Scrolls: ${report.metrics.scrollCount}`,
    `- Tokens: ${report.llm.totalTokens}`,
    ``,
    `## Steps`,
    ...report.steps.map((step) => `- ${step.index}. ${step.tool || step.kind}: ${step.ok ? "ok" : "failed"} - ${step.summary || step.text || ""}`),
  ].filter((line) => line !== "");

  return `${lines.join("\n")}\n`;
}
