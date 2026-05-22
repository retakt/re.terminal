import { makeCommunityChatId, splitCommunityChatId } from "../types.js";
import { telegramTdlibClient } from "./telegram-tdlib-client.js";

function tdlibEnabled() {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.TELEGRAM_TDLIB_ENABLED || "").toLowerCase()
  );
}

const MOCK_CHATS = [
  {
    id: makeCommunityChatId("telegram", "reterm"),
    nativeId: "reterm",
    service: "telegram",
    title: "re.Term",
    subtitle: "tdlib disabled preview",
    unread: 1,
  },
];

const INITIAL_MESSAGES = [
  {
    id: "telegram:m1",
    nativeId: "m1",
    service: "telegram",
    chatId: makeCommunityChatId("telegram", "reterm"),
    text: "tdlib adapter is installed. set TDLIB_LIBRARY_PATH and enable TELEGRAM_TDLIB_ENABLED=1.",
    time: "12:04",
    outgoing: false,
    status: "sent",
  },
];

export class TelegramAdapter {
  constructor() {
    this.service = "telegram";
    this.messages = [...INITIAL_MESSAGES];
  }

  async getStatus() {
    if (tdlibEnabled()) {
      return telegramTdlibClient.getStatus();
    }

    return {
      ok: true,
      service: this.service,
      state: "preview",
      accountLabel: "tdlib disabled",
      connected: false,
    };
  }

  async listChats() {
    if (tdlibEnabled()) {
      return {
        ok: true,
        service: this.service,
        chats: await telegramTdlibClient.listChats(),
      };
    }

    return {
      ok: true,
      service: this.service,
      chats: MOCK_CHATS,
    };
  }

  async listMessages(chatId) {
    if (tdlibEnabled()) {
      return {
        ok: true,
        service: this.service,
        chatId,
        messages: await telegramTdlibClient.listMessages(chatId),
      };
    }

    const { nativeId } = splitCommunityChatId(chatId);
    const fullChatId = makeCommunityChatId(this.service, nativeId);

    return {
      ok: true,
      service: this.service,
      chatId: fullChatId,
      messages: this.messages.filter((message) => message.chatId === fullChatId),
    };
  }

  async sendMessage(chatId, text) {
    if (tdlibEnabled()) {
      const message = await telegramTdlibClient.sendMessage(chatId, text);
      return {
        ok: true,
        service: this.service,
        chatId,
        message,
      };
    }

    const clean = String(text || "").trim();
    if (!clean) {
      return { ok: false, service: this.service, error: "message is empty" };
    }

    const { nativeId } = splitCommunityChatId(chatId);
    const fullChatId = makeCommunityChatId(this.service, nativeId);
    const now = Date.now();

    const message = {
      id: `telegram:local-${now}`,
      nativeId: `local-${now}`,
      service: this.service,
      chatId: fullChatId,
      text: clean,
      outgoing: true,
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      status: "sent",
    };

    this.messages.push(message);

    return {
      ok: true,
      service: this.service,
      chatId: fullChatId,
      message,
    };
  }

  async beginLogin() {
    return telegramTdlibClient.beginLogin();
  }

  async submitPhone(phone) {
    return telegramTdlibClient.submitPhone(phone);
  }

  async submitCode(code) {
    return telegramTdlibClient.submitCode(code);
  }

  async submitPassword(password) {
    return telegramTdlibClient.submitPassword(password);
  }

  async logout() {
    return telegramTdlibClient.logout();
  }
}

export const telegramAdapter = new TelegramAdapter();
