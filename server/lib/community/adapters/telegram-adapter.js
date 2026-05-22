import { makeCommunityChatId, splitCommunityChatId } from "../types.js";

const MOCK_CHATS = [
  {
    id: makeCommunityChatId("telegram", "reterm"),
    nativeId: "reterm",
    service: "telegram",
    title: "re.Term",
    subtitle: "tdlib adapter preview",
    unread: 1,
  },
  {
    id: makeCommunityChatId("telegram", "updates"),
    nativeId: "updates",
    service: "telegram",
    title: "Telegram Updates",
    subtitle: "waiting for tdlib",
    unread: 0,
  },
  {
    id: makeCommunityChatId("telegram", "saved"),
    nativeId: "saved",
    service: "telegram",
    title: "Saved Messages",
    subtitle: "local preview",
    unread: 0,
  },
];

const MOCK_MESSAGES = [
  {
    id: "telegram:m1",
    nativeId: "m1",
    service: "telegram",
    chatId: makeCommunityChatId("telegram", "reterm"),
    text: "telegram adapter boundary is ready.",
    time: "12:04",
    outgoing: false,
    status: "sent",
  },
  {
    id: "telegram:m2",
    nativeId: "m2",
    service: "telegram",
    chatId: makeCommunityChatId("telegram", "reterm"),
    text: "next step is replacing this mock with tdlib.",
    time: "12:05",
    outgoing: true,
    status: "sent",
  },
];

export class TelegramAdapter {
  constructor() {
    this.service = "telegram";
  }

  async getStatus() {
    return {
      ok: true,
      service: this.service,
      state: "preview",
      accountLabel: "tdlib not connected",
      connected: false,
    };
  }

  async listChats() {
    return {
      ok: true,
      service: this.service,
      chats: MOCK_CHATS,
    };
  }

  async listMessages(chatId) {
    const { nativeId } = splitCommunityChatId(chatId);
    const fullChatId = makeCommunityChatId(this.service, nativeId);

    return {
      ok: true,
      service: this.service,
      chatId: fullChatId,
      messages: MOCK_MESSAGES.filter((message) => message.chatId === fullChatId),
    };
  }

  async sendMessage(chatId, text) {
    const clean = String(text || "").trim();
    if (!clean) {
      return { ok: false, service: this.service, error: "message is empty" };
    }

    const { nativeId } = splitCommunityChatId(chatId);
    const fullChatId = makeCommunityChatId(this.service, nativeId);

    return {
      ok: true,
      service: this.service,
      chatId: fullChatId,
      message: {
        id: `telegram:local-${Date.now()}`,
        nativeId: `local-${Date.now()}`,
        service: this.service,
        chatId: fullChatId,
        text: clean,
        outgoing: true,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        status: "sent",
      },
    };
  }
}

export const telegramAdapter = new TelegramAdapter();
