export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "complete" | "streaming" | "error" | "cancelled";

export interface Attachment {
  id: string;
  name: string;
  fsPath: string;
  uri: string;
  language?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  status?: MessageStatus;
  requestId?: string;
  model?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  attachments: Attachment[];
  messages: ChatMessage[];
}

export interface BootstrapPayload {
  sessions: ChatSession[];
  activeSessionId: string;
}

export type ExtensionToWebviewMessage =
  | { type: "bootstrapped"; payload: BootstrapPayload }
  | { type: "sessionUpdated"; session: ChatSession }
  | { type: "sessionsCleared"; payload: BootstrapPayload }
  | { type: "assistantStream"; sessionId: string; requestId: string; chunk: string }
  | { type: "generationState"; running: boolean; requestId?: string }
  | { type: "info"; message: string }
  | { type: "error"; message: string };

export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "createSession" }
  | { type: "switchSession"; sessionId: string }
  | { type: "sendPrompt"; sessionId: string; prompt: string }
  | { type: "retryLast"; sessionId: string }
  | { type: "stopGeneration" }
  | { type: "attachFile" }
  | { type: "removeAttachment"; sessionId: string; attachmentId: string }
  | { type: "clearSessions" };
