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
  contentBase64?: string;
}

export interface SlashCommandDescriptor {
  name: string;
  hint: string;
  category: "analysis" | "generation" | "editing" | "debug";
  mode?: ChatMode;
  requiresAttachment?: boolean;
}

export interface Agent {
  id: string;
  label: string;
  icon?: string;
  description?: string;
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
  defaultAgentId?: string;
  defaultModelId?: string;
}

export interface BootstrapPayload {
  sessions: ChatSession[];
  activeSessionId: string;
  supportedCommands?: string[];
  commandDescriptors?: SlashCommandDescriptor[];
  availableAgents?: Agent[];
  availableModels?: string[];
}

export type ExtensionToWebviewMessage =
  | { type: "bootstrapped"; payload: BootstrapPayload }
  | { type: "sessionUpdated"; session: ChatSession; activeSessionId?: string }
  | { type: "sessionsCleared"; payload: BootstrapPayload }
  | { type: "assistantStream"; sessionId: string; requestId: string; chunk: string }
  | { type: "generationState"; running: boolean; requestId?: string }
  | { type: "composerPrefill"; sessionId: string; text: string; append?: boolean; contextChip?: { display: string; content: string; languageId: string }; contextChips?: Array<{ display: string; content?: string; languageId?: string; type: 'mention' | 'snippet'; id?: string }> }
  | { type: "fileSearchResults"; query: string; suggestions: string[] }
  | { type: "modelUpdated"; sessionId: string; modelId: string }
  | { type: "modeUpdated"; sessionId: string; mode: ChatMode }
  | { type: "debugModeToggled"; enabled: boolean }
  | { type: "info"; message: string }
  | { type: "error"; message: string }
  | { type: "permissionRequest"; requestId: string; message: string; options: Array<{ label: string; value: string }> };

export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "createSession" }
  | { type: "switchSession"; sessionId: string }
  | { type: "searchFiles"; query: string }
  | { type: "sendPrompt"; sessionId: string; prompt: string }
  | { type: "setAgent"; sessionId: string; agentId: string }
  | { type: "setModel"; sessionId: string; modelId: string }
  | { type: "toggleMode"; sessionId: string; mode: ChatMode }
  | { type: "attachFiles"; sessionId: string; files: DroppedFilePayload[] }
  | { type: "insertSelectedContext"; sessionId: string; text: string; source?: "editorSelection" | "manual" }
  | { type: "retryLast"; sessionId: string }
  | { type: "stopGeneration" }
  | { type: "toggleDebugMode"; enabled: boolean }
  | { type: "attachFile" }
  | { type: "removeAttachment"; sessionId: string; attachmentId: string }
  | { type: "clearSessions" }
  | { type: "deleteSession"; sessionId: string }
  | { type: "permissionResponse"; requestId: string; value: string };
