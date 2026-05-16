export type AttachedFile =
  | { type: "text"; name: string; content: string }
  | { type: "image"; name: string; base64: string; mimeType: string }
  | { type: "audio"; name: string; base64: string; mimeType: string };

export type ToolLog = {
  tool: string;
  args: Record<string, string>;
  result: string;
  status: "running" | "complete" | "error";
  timestamp?: number;
};
