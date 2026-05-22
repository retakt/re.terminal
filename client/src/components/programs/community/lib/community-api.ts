export type CommunityService = "telegram" | "whatsapp" | "signal" | "matrix";

export type CommunityServiceStatus = {
  ok: boolean;
  service: CommunityService;
  state: "preview" | "connecting" | "connected" | "error";
  accountLabel: string;
  connected: boolean;
  error?: string;
};

export type CommunityChat = {
  id: string;
  nativeId?: string;
  service: CommunityService;
  title: string;
  subtitle: string;
  unread?: number;
};

export type CommunityMessage = {
  id: string;
  nativeId?: string;
  service: CommunityService;
  chatId: string;
  text: string;
  outgoing?: boolean;
  time: string;
  status?: "sending" | "sent" | "failed";
};

const API_BASE = "";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || `request failed with ${response.status}`);
  }

  return data as T;
}

export function getCommunityStatus(service: CommunityService = "telegram") {
  return requestJson<CommunityServiceStatus>(`/api/community/${service}/status`);
}

export function listCommunityChats(service: CommunityService = "telegram") {
  return requestJson<{ ok: boolean; service: CommunityService; chats: CommunityChat[] }>(
    `/api/community/${service}/chats`
  );
}

export function listCommunityMessages(
  service: CommunityService,
  chatId: string,
) {
  return requestJson<{
    ok: boolean;
    service: CommunityService;
    chatId: string;
    messages: CommunityMessage[];
  }>(`/api/community/${service}/chats/${encodeURIComponent(chatId)}/messages`);
}

export function sendCommunityMessage(
  service: CommunityService,
  chatId: string,
  text: string,
) {
  return requestJson<{
    ok: boolean;
    service: CommunityService;
    chatId: string;
    message: CommunityMessage;
    error?: string;
  }>(`/api/community/${service}/chats/${encodeURIComponent(chatId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}
