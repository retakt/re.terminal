export type TelegramChat = {
  id: string;
  title: string;
  subtitle: string;
  unread?: number;
  active?: boolean;
};

export type TelegramMessage = {
  id: string;
  chatId: string;
  text: string;
  outgoing?: boolean;
  time: string;
};
