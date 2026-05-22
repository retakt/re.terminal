import { normalizeService } from "./types.js";
import { telegramAdapter } from "./adapters/telegram-adapter.js";

const adapters = {
  telegram: telegramAdapter,
};

export function getCommunityAdapter(service) {
  return adapters[normalizeService(service)] || telegramAdapter;
}

export async function getCommunityServices() {
  const services = await Promise.all(
    Object.values(adapters).map(async (adapter) => adapter.getStatus())
  );

  return {
    ok: true,
    services,
  };
}

export async function getCommunityStatus(service) {
  return getCommunityAdapter(service).getStatus();
}

export async function listCommunityChats(service) {
  return getCommunityAdapter(service).listChats();
}

export async function listCommunityMessages(service, chatId) {
  return getCommunityAdapter(service).listMessages(chatId);
}

export async function sendCommunityMessage(service, chatId, text) {
  return getCommunityAdapter(service).sendMessage(chatId, text);
}
