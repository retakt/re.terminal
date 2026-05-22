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


export async function beginCommunityLogin(service) {
  const adapter = getCommunityAdapter(service);
  if (!adapter.beginLogin) throw new Error(`${service} login is not supported`);
  return adapter.beginLogin();
}

export async function submitCommunityPhone(service, phone) {
  const adapter = getCommunityAdapter(service);
  if (!adapter.submitPhone) throw new Error(`${service} phone login is not supported`);
  return adapter.submitPhone(phone);
}

export async function submitCommunityCode(service, code) {
  const adapter = getCommunityAdapter(service);
  if (!adapter.submitCode) throw new Error(`${service} code login is not supported`);
  return adapter.submitCode(code);
}

export async function submitCommunityPassword(service, password) {
  const adapter = getCommunityAdapter(service);
  if (!adapter.submitPassword) throw new Error(`${service} password login is not supported`);
  return adapter.submitPassword(password);
}

export async function logoutCommunityService(service) {
  const adapter = getCommunityAdapter(service);
  if (!adapter.logout) throw new Error(`${service} logout is not supported`);
  return adapter.logout();
}
