import { createPlaywrightEngine } from "../engines/playwright-engine.js";
import { preparePlaywrightCommandWithRegistry } from "../registries/playwright.js";

function resolveHandler(engine, command = {}) {
  const tool = String(command.tool || "").trim();
  if (tool === "browserNavigate") return engine.navigate.bind(engine);
  if (tool === "browserObserve" || tool === "browserShowActions") return engine.observe.bind(engine);
  if (tool === "browserClickByText") return engine.click.bind(engine);
  if (tool === "browserFillFields") return engine.fill.bind(engine);
  if (tool === "browserSubmitForm" || tool === "browserFillAndSubmit") return engine.submit.bind(engine);
  if (tool === "browserScrape") return engine.scrape.bind(engine);
  if (tool === "browserExtract") return engine.extract.bind(engine);
  if (tool === "browserScreenshot") return engine.screenshot.bind(engine);
  if (tool === "browserVerify") return engine.verify.bind(engine);
  return null;
}

export function createPlaywrightRoute() {
  const engine = createPlaywrightEngine();

  return {
    route: "playwright",
    engine,

    async warm(context = {}) {
      return engine.warm(context);
    },

    async prepare(command = {}, context = {}) {
      return preparePlaywrightCommandWithRegistry({
        command,
        state: context.state || {},
        currentUrl: context.currentUrl || "",
      });
    },

    async run(command = {}, context = {}) {
      const handler = resolveHandler(engine, command);
      if (!handler) {
        return {
          ok: false,
          route: "playwright",
          backend: "playwright_mcp",
          tool: command.tool || "",
          error: `Unsupported Playwright route command: ${command.tool || "<missing>"}`,
        };
      }
      return handler(command, context);
    },
  };
}
