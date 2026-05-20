// ── Tool definitions (sent to Ollama so model knows what it can call) ────────
import type { OllamaTool } from "../api/ollama";

export const TOOLS: OllamaTool[] = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather conditions and temperature for any city. Use this when the user asks about weather, temperature, rain, humidity, or conditions in any location.",
      parameters: {
        type: "object",
        required: ["city"],
        properties: {
          city: { type: "string", description: "City name, e.g. 'Kuala Lumpur', 'Tokyo', 'London'" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_exchange_rate",
      description: "Get live currency exchange rates. Use this when the user asks about currency conversion, exchange rates, or how much something costs in another currency.",
      parameters: {
        type: "object",
        required: ["from", "to"],
        properties: {
          from: { type: "string", description: "Source currency code, e.g. 'MYR', 'USD', 'EUR'" },
          to: { type: "string", description: "Target currency code, e.g. 'USD', 'JPY', 'GBP'. Use 'ALL' to get all rates." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_time",
      description: "Get the current time in any city or timezone. Use this when the user asks what time it is somewhere, or wants to compare times between cities.",
      parameters: {
        type: "object",
        required: ["timezone"],
        properties: {
          timezone: { type: "string", description: "IANA timezone name e.g. 'Asia/Kuala_Lumpur', 'America/New_York', 'Europe/London', 'Asia/Tokyo'" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web for current information. Choose the mode based on what is needed: 'factcheck' for quick 2-result verification when you are uncertain (fast, use proactively), 'general' for user-requested searches (5 results), 'news' for current events and recent news (3 results), 'reddit' for opinions, discussions, recommendations and community experiences (3 results), 'wiki' for factual definitions and encyclopedic information (2 results), 'code' for programming questions, libraries, and technical issues (3 results). Always use factcheck mode proactively when you are not confident about a fact or after 2-3 turns where accuracy matters.",
      parameters: {
        type: "object",
        required: ["query", "mode"],
        properties: {
          query: { type: "string", description: "The search query. Be specific and concise." },
          mode: {
            type: "string",
            description: "Search mode: 'factcheck' (quick verify, 2 results), 'general' (5 results), 'news' (current events, 3 results), 'reddit' (opinions/discussions, 3 results), 'wiki' (encyclopedia, 2 results), 'code' (programming, 3 results)"
          },
        },
      },
    },
  },
];
