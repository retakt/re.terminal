export type CommunityService = "telegram" | "whatsapp" | "signal" | "matrix";

export type TelegramChat = {
  id: string;
  nativeId?: string;
  service?: CommunityService;
  title: string;
  subtitle: string;
  unread?: number;
  active?: boolean;
};

export type TelegramMessage = {
  id: string;
  nativeId?: string;
  service?: CommunityService;
  chatId: string;
  text: string;
  outgoing?: boolean;
  time: string;
  status?: "sending" | "sent" | "failed";
};
