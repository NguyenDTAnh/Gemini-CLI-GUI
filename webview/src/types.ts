export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "complete" | "streaming" | "error" | "cancelled";
export type ChatMode = "plan" | "edit";

export interface AttachmentDimensions {
  width: number;
  height: number;
}

export interface QuickContextMetadata {
  source: "editorSelection" | "manual";
  createdAt: number;
}

export interface DroppedFilePayload {
  name: string;
  fsPath?: string;
  uri?: string;
  mimeType?: string;
  size?: number;
  contentBase64?: string;
}

export interface Attachment {
  id: string;
  name: string;
  fsPath: string;
  uri: string;
  language?: string;
  mimeType?: string;
  size?: number;
  dimensions?: AttachmentDimensions;
  isImage?: boolean;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  status?: MessageStatus;
  requestId?: string;
  model?: string;
  modelId?: string;
  mode?: ChatMode;
  quickContext?: QuickContextMetadata;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  attachments: Attachment[];
  messages: ChatMessage[];
  activeMode?: ChatMode;
  defaultModelId?: string;
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
  | { type: "composerPrefill"; sessionId: string; text: string; append?: boolean }
  | { type: "modelUpdated"; sessionId: string; modelId: string }
  | { type: "modeUpdated"; sessionId: string; mode: ChatMode }
  | { type: "info"; message: string }
  | { type: "error"; message: string };

export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "createSession" }
  | { type: "switchSession"; sessionId: string }
  | { type: "sendPrompt"; sessionId: string; prompt: string }
  | { type: "setModel"; sessionId: string; modelId: string }
  | { type: "toggleMode"; sessionId: string; mode: ChatMode }
  | { type: "attachFiles"; sessionId: string; files: DroppedFilePayload[] }
  | { type: "insertSelectedContext"; sessionId: string; text: string; source?: "editorSelection" | "manual" }
  | { type: "retryLast"; sessionId: string }
  | { type: "stopGeneration" }
  | { type: "attachFile" }
  | { type: "removeAttachment"; sessionId: string; attachmentId: string }
  | { type: "clearSessions" };
