import path from "path";
import fs from "fs";

function envEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function formatTime(unixSeconds) {
  if (!unixSeconds) return "";
  return new Date(unixSeconds * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getNativeTelegramId(chatId) {
  return Number(String(chatId || "").replace(/^telegram:/, ""));
}

function mapTdlibChat(chat) {
  return {
    id: `telegram:${chat.id}`,
    nativeId: String(chat.id),
    service: "telegram",
    title: chat.title || "telegram chat",
    subtitle: chat.type?._ || "telegram",
    unread: chat.unread_count || 0,
  };
}

function mapTdlibMessage(message) {
  const text =
    message?.content?._ === "messageText"
      ? message.content.text?.text || ""
      : `[${message?.content?._ || "message"}]`;

  return {
    id: `telegram:${message.id}`,
    nativeId: String(message.id),
    service: "telegram",
    chatId: `telegram:${message.chat_id}`,
    text,
    outgoing: Boolean(message.is_outgoing),
    time: formatTime(message.date),
    status: "sent",
  };
}

let tdlConfigured = false;

async function loadTdl() {
  const imported = await import("tdl");
  const tdl = imported.default ?? imported;

  if (!tdlConfigured) {
    const dllPath = String(process.env.TDLIB_LIBRARY_PATH || "").trim();

    tdl.configure({
      tdjson: dllPath ? path.resolve(dllPath) : "tdjson.dll",
      verbosityLevel: 1,
    });

    tdlConfigured = true;
  }

  return tdl;
}

export class TelegramTdlibClient {
  constructor() {
    this.client = null;
    this.connecting = null;
    this.loginPromise = null;

    this.state = "preview";
    this.accountLabel = "tdlib disabled";
    this.connected = false;

    this.pendingResolvers = new Map();
    this.pendingInputs = new Map();
  }

  refreshEnv() {
    this.enabled = envEnabled(process.env.TELEGRAM_TDLIB_ENABLED);
    this.apiId = Number(process.env.TELEGRAM_API_ID || 0);
    this.apiHash = String(process.env.TELEGRAM_API_HASH || "");
    this.databaseDirectory = path.resolve(
      process.env.TELEGRAM_TDLIB_DB_DIR || ".data/tdlib/telegram"
    );
    this.filesDirectory = path.resolve(
      process.env.TELEGRAM_TDLIB_FILES_DIR || ".data/tdlib/files"
    );
  }

  getStatus() {
    this.refreshEnv();

    if (!this.enabled) {
      return {
        ok: true,
        service: "telegram",
        state: "preview",
        accountLabel: "tdlib disabled",
        connected: false,
      };
    }

    if (!this.apiId || !this.apiHash) {
      return {
        ok: false,
        service: "telegram",
        state: "error",
        accountLabel: "missing TELEGRAM_API_ID or TELEGRAM_API_HASH",
        connected: false,
      };
    }

    return {
      ok: true,
      service: "telegram",
      state: this.connected ? "connected" : this.state,
      accountLabel: this.accountLabel,
      connected: this.connected,
    };
  }

  async ensureClient() {
    this.refreshEnv();

    if (!this.enabled) {
      throw new Error("tdlib is disabled. Set TELEGRAM_TDLIB_ENABLED=1");
    }

    if (!this.apiId || !this.apiHash) {
      throw new Error("missing TELEGRAM_API_ID or TELEGRAM_API_HASH");
    }

    if (this.client) return this.client;
    if (this.connecting) return this.connecting;

    this.connecting = this.createClient();
    return this.connecting;
  }

  async createClient() {
    fs.mkdirSync(this.databaseDirectory, { recursive: true });
    fs.mkdirSync(this.filesDirectory, { recursive: true });

    const tdl = await loadTdl();

    this.client = tdl.createClient({
      apiId: this.apiId,
      apiHash: this.apiHash,
      databaseDirectory: this.databaseDirectory,
      filesDirectory: this.filesDirectory,
      tdlibParameters: {
        use_message_database: true,
        use_secret_chats: false,
        system_language_code: "en",
        application_version: "1.0",
        device_model: "re.Term",
        system_version: process.platform,
      },
    });

    this.client.on("update", (update) => {
      if (update?._ === "updateAuthorizationState") {
        this.handleAuthState(update.authorization_state);
      }
    });

    this.client.on("error", (err) => {
      this.state = "error";
      this.accountLabel = err instanceof Error ? err.message : String(err);
      this.connected = false;
    });

    this.state = "connecting";
    this.accountLabel = "tdlib client created";

    return this.client;
  }

  handleAuthState(authState) {
    const name = authState?._ || "authorizationStateUnknown";

    switch (name) {
      case "authorizationStateReady":
        this.state = "connected";
        this.accountLabel = "telegram connected";
        this.connected = true;
        break;
      case "authorizationStateWaitPhoneNumber":
        this.state = "phone";
        this.accountLabel = "telegram phone required";
        this.connected = false;
        break;
      case "authorizationStateWaitCode":
        this.state = "code";
        this.accountLabel = "telegram code required";
        this.connected = false;
        break;
      case "authorizationStateWaitPassword":
        this.state = "password";
        this.accountLabel = "telegram password required";
        this.connected = false;
        break;
      case "authorizationStateClosed":
        this.state = "closed";
        this.accountLabel = "telegram closed";
        this.connected = false;
        break;
      default:
        this.state = "connecting";
        this.accountLabel = name.replace(/^authorizationState/, "telegram ");
        this.connected = false;
        break;
    }
  }

  consumeInput(name) {
    if (this.pendingInputs.has(name)) {
      const value = this.pendingInputs.get(name);
      this.pendingInputs.delete(name);
      return value;
    }

    return new Promise((resolve) => {
      this.pendingResolvers.set(name, resolve);
    });
  }

  provideInput(name, value) {
    const clean = String(value || "").trim();

    if (this.pendingResolvers.has(name)) {
      const resolve = this.pendingResolvers.get(name);
      this.pendingResolvers.delete(name);
      resolve(clean);
      return;
    }

    this.pendingInputs.set(name, clean);
  }

  async beginLogin() {
    const client = await this.ensureClient();

    if (this.connected) return this.getStatus();
    if (this.loginPromise) return this.getStatus();

    this.loginPromise = client
      .login({
        getPhoneNumber: async () => {
          this.state = "phone";
          this.accountLabel = "telegram phone required";
          return this.consumeInput("phone");
        },
        getAuthCode: async () => {
          this.state = "code";
          this.accountLabel = "telegram code required";
          return this.consumeInput("code");
        },
        getPassword: async () => {
          this.state = "password";
          this.accountLabel = "telegram password required";
          return this.consumeInput("password");
        },
      })
      .then(() => {
        this.connected = true;
        this.state = "connected";
        this.accountLabel = "telegram connected";
      })
      .catch((err) => {
        this.connected = false;
        this.state = "error";
        this.accountLabel = err instanceof Error ? err.message : String(err);
        this.loginPromise = null;
      });

    return this.getStatus();
  }

  async submitPhone(phone) {
    await this.beginLogin();
    this.provideInput("phone", phone);
    return this.getStatus();
  }

  async submitCode(code) {
    this.provideInput("code", code);
    return this.getStatus();
  }

  async submitPassword(password) {
    this.provideInput("password", password);
    return this.getStatus();
  }

  async ensureReady() {
    const client = await this.ensureClient();

    if (!this.connected) {
      await this.beginLogin();
      throw new Error(`telegram auth not ready: ${this.state}`);
    }

    return client;
  }

  async listChats() {
    const client = await this.ensureReady();

    const result = await client.invoke({
      _: "getChats",
      chat_list: { _: "chatListMain" },
      limit: 50,
    });

    const chatIds = result.chat_ids || [];
    const chats = [];

    for (const chatId of chatIds) {
      const chat = await client.invoke({
        _: "getChat",
        chat_id: chatId,
      });
      chats.push(mapTdlibChat(chat));
    }

    return chats;
  }

  async listMessages(chatId) {
    const client = await this.ensureReady();
    const nativeId = getNativeTelegramId(chatId);

    const result = await client.invoke({
      _: "getChatHistory",
      chat_id: nativeId,
      from_message_id: 0,
      offset: 0,
      limit: 50,
      only_local: false,
    });

    return (result.messages || []).reverse().map(mapTdlibMessage);
  }

  async sendMessage(chatId, text) {
    const client = await this.ensureReady();
    const nativeId = getNativeTelegramId(chatId);
    const clean = String(text || "").trim();

    if (!clean) throw new Error("message is empty");

    const result = await client.invoke({
      _: "sendMessage",
      chat_id: nativeId,
      input_message_content: {
        _: "inputMessageText",
        text: {
          _: "formattedText",
          text: clean,
          entities: [],
        },
      },
    });

    return mapTdlibMessage(result);
  }

  async logout() {
    const client = await this.ensureClient();
    await client.invoke({ _: "logOut" });

    this.connected = false;
    this.state = "closed";
    this.accountLabel = "telegram logged out";
    this.loginPromise = null;

    return this.getStatus();
  }
}

export const telegramTdlibClient = new TelegramTdlibClient();
