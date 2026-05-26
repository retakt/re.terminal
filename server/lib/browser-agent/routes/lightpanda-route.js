import { createLightpandaEngine } from "../engines/lightpanda-engine.js";
import { prepareLightpandaCommandWithRegistry } from "../registries/lightpanda.js";

function resolveHandler(engine, command = {}) {
  const tool = String(command.tool || "").trim();
  if (tool === "browserNavigate") return engine.navigate.bind(engine);
  if (tool === "browserObserve" || tool === "browserShowActions") return engine.observe.bind(engine);
  if (tool === "browserClickByText") return engine.click.bind(engine);
  if (tool === "browserFillFields") return engine.fill.bind(engine);
  if (tool === "browserSubmitForm" || tool === "browserFillAndSubmit") return engine.submit.bind(engine);
  if (tool === "browserScroll") return engine.scroll.bind(engine);
  if (tool === "browserScrape") return engine.scrape.bind(engine);
  if (tool === "browserExtract") return engine.extract.bind(engine);
  if (tool === "browserVerify") return engine.verify.bind(engine);
  if (tool === "browserScreenshot") return engine.screenshot.bind(engine);
  return null;
}

export function createLightpandaRoute() {
  const engine = createLightpandaEngine();

  return {
    route: "lightpanda",
    engine,

    async warm(context = {}) {
      return engine.warm(context);
    },

    async prepare(command = {}, context = {}) {
      return prepareLightpandaCommandWithRegistry({
        command,
        currentObservation: context.currentObservation || null,
      });
    },

    async run(command = {}, context = {}) {
      const handler = resolveHandler(engine, command);
      if (!handler) {
        return {
          ok: false,
          route: "lightpanda",
          backend: "lightpanda_cdp",
          tool: command.tool || "",
          error: `Unsupported Lightpanda route command: ${command.tool || "<missing>"}`,
        };
      }
      return handler(command, context);
    },
  };
}
