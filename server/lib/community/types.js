/**
 * Shared Community backend shapes.
 *
 * Services can be telegram, whatsapp, signal, matrix, etc.
 * Telegram is first, but UI/routes should stay generic.
 */

export const COMMUNITY_SERVICES = ["telegram"];

export function normalizeService(value) {
  const service = String(value || "telegram").toLowerCase();
  return COMMUNITY_SERVICES.includes(service) ? service : "telegram";
}

export function makeCommunityChatId(service, nativeId) {
  return `${service}:${String(nativeId)}`;
}

export function splitCommunityChatId(chatId) {
  const [service, ...rest] = String(chatId || "").split(":");
  return {
    service: normalizeService(service),
    nativeId: rest.join(":"),
  };
}
