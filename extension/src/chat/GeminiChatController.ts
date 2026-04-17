import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { ContextCollector } from "./ContextCollector";
import { GeminiProcessManager } from "./GeminiProcessManager";
import { SlashCommandRouter } from "./SlashCommandRouter";
import { ChatSessionStore } from "../state/ChatSessionStore";
import {
  Attachment,
  ChatMessage,
  ChatSession,
  ExtensionToWebviewMessage,
  WebviewToExtensionMessage
} from "../types";

export class GeminiChatController {
  private webview?: vscode.Webview;
  private readonly processManager = new GeminiProcessManager();
  private readonly slashRouter = new SlashCommandRouter();
  private readonly contextCollector = new ContextCollector();
  private activeRequest?: { requestId: string; sessionId: string; assistantMessageId: string };

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ChatSessionStore
  ) {}

  bindWebview(webview: vscode.Webview): void {
    this.webview = webview;

    webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      void this.handleMessage(message);
    });

    void this.pushBootstrap();
  }

  dispose(): void {
    this.processManager.stopAll();
  }

  async createSession(): Promise<void> {
    const session = await this.store.createSession();
    this.post({ type: "sessionUpdated", session });
  }

  async clearSessions(): Promise<void> {
    await this.stopActiveRequest();
    const initial = await this.store.clearAll();
    this.post({
      type: "sessionsCleared",
      payload: {
        sessions: [initial],
        activeSessionId: initial.id
      }
    });
  }

  async attachFromActiveEditor(): Promise<void> {
    const session = await this.ensureActiveSession();
    const attachment = await this.contextCollector.attachFromActiveEditor();
    if (!attachment) {
      this.post({ type: "info", message: "No active editor found." });
      return;
    }

    await this.attachToSession(session, [attachment]);
  }

  async stopActiveRequest(): Promise<void> {
    if (!this.activeRequest) {
      return;
    }

    this.processManager.stopRequest(this.activeRequest.requestId);
  }

  private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        await this.pushBootstrap();
        return;
      case "createSession":
        await this.createSession();
        return;
      case "switchSession":
        await this.store.setActiveSession(message.sessionId);
        await this.pushBootstrap();
        return;
      case "sendPrompt":
        await this.sendPrompt(message.sessionId, message.prompt);
        return;
      case "retryLast":
        await this.retryLast(message.sessionId);
        return;
      case "stopGeneration":
        await this.stopActiveRequest();
        return;
      case "attachFile":
        await this.pickAndAttach();
        return;
      case "removeAttachment":
        await this.removeAttachment(message.sessionId, message.attachmentId);
        return;
      case "clearSessions":
        await this.clearSessions();
        return;
      default:
        return;
    }
  }

  private async sendPrompt(sessionId: string, rawPrompt: string): Promise<void> {
    const prompt = rawPrompt.trim();
    if (!prompt) {
      return;
    }

    if (this.activeRequest) {
      this.processManager.stopRequest(this.activeRequest.requestId);
    }

    const session = await this.ensureSession(sessionId);
    const route = this.slashRouter.parse(prompt);

    if (!route.valid && route.command) {
      this.post({ type: "info", message: `Unknown slash command /${route.command}. Sent as normal prompt.` });
    }

    const requestId = randomUUID();
    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: "user",
      content: prompt,
      createdAt: Date.now(),
      status: "complete"
    };

    const config = vscode.workspace.getConfiguration("geminiCliChat");
    const defaultArgs = config.get<string[]>("defaultArgs", []);
    
    // Extract model name from args if present (-m model or --model model)
    let modelName = "Gemini";
    for (let i = 0; i < defaultArgs.length; i++) {
      if ((defaultArgs[i] === "-m" || defaultArgs[i] === "--model") && i + 1 < defaultArgs.length) {
        modelName = defaultArgs[i + 1];
        break;
      }
    }

    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      status: "streaming",
      requestId,
      model: modelName
    };

    session.messages.push(userMessage, assistantMessage);
    session.updatedAt = Date.now();
    if (session.messages.length <= 2) {
      session.title = prompt.slice(0, 48) || "New Session";
    }

    await this.store.upsertSession(session);
    this.post({ type: "sessionUpdated", session });

    this.activeRequest = {
      requestId,
      sessionId: session.id,
      assistantMessageId: assistantMessage.id
    };

    this.post({ type: "generationState", running: true, requestId });

    const cliPath = config.get<string>("cliPath", "gemini");
    const maxContextChars = config.get<number>("maxContextChars", 16000);
    const maxAttachedFiles = config.get<number>("maxAttachedFiles", 5);
    const timeoutMs = config.get<number>("requestTimeoutMs", 120000);
    const responseLanguage = config.get<string>("responseLanguage", "vi");

    const contextText = await this.contextCollector.buildContext(
      session.attachments.slice(0, maxAttachedFiles),
      maxContextChars
    );

    this.processManager.runRequest({
      requestId,
      cliPath,
      args: defaultArgs,
      timeoutMs,
      prompt: route.transformedPrompt,
      responseLanguage,
      contextText,
      onChunk: (chunk) => {
        const liveSession = this.store.getSession(session.id);
        if (!liveSession) {
          return;
        }

        const messageRef = liveSession.messages.find((item) => item.id === assistantMessage.id);
        if (!messageRef) {
          return;
        }

        messageRef.content += chunk;
        messageRef.status = "streaming";
        liveSession.updatedAt = Date.now();

        this.post({
          type: "assistantStream",
          sessionId: liveSession.id,
          requestId,
          chunk
        });
      },
      onDone: () => {
        void this.finishRequest(session.id, assistantMessage.id, requestId, "complete");
      },
      onCancelled: () => {
        void this.finishRequest(session.id, assistantMessage.id, requestId, "cancelled");
      },
      onError: (errorMessage) => {
        void this.finishRequest(session.id, assistantMessage.id, requestId, "error", errorMessage);
      }
    });
  }

  private async finishRequest(
    sessionId: string,
    assistantMessageId: string,
    requestId: string,
    status: "complete" | "cancelled" | "error",
    errorMessage?: string
  ): Promise<void> {
    const session = this.store.getSession(sessionId);
    if (!session) {
      return;
    }

    const message = session.messages.find((item) => item.id === assistantMessageId);
    if (!message) {
      return;
    }

    message.status = status;
    if (status === "error") {
      const suffix = `\n\n[Gemini CLI error]\n${errorMessage || "Unknown error."}`;
      message.content += suffix;
    }

    session.updatedAt = Date.now();
    await this.store.upsertSession(session);
    this.post({ type: "sessionUpdated", session });

    if (this.activeRequest?.requestId === requestId) {
      this.activeRequest = undefined;
      this.post({ type: "generationState", running: false, requestId });
    }
  }

  private async retryLast(sessionId: string): Promise<void> {
    const session = await this.ensureSession(sessionId);
    const lastUserMessage = [...session.messages].reverse().find((message) => message.role === "user");
    if (!lastUserMessage) {
      this.post({ type: "info", message: "No previous prompt found in this session." });
      return;
    }

    await this.sendPrompt(session.id, lastUserMessage.content);
  }

  private async pickAndAttach(): Promise<void> {
    const config = vscode.workspace.getConfiguration("geminiCliChat");
    const maxAttachedFiles = config.get<number>("maxAttachedFiles", 5);

    const attachments = await this.contextCollector.pickAttachments(maxAttachedFiles);
    if (attachments.length === 0) {
      return;
    }

    const session = await this.ensureActiveSession();
    await this.attachToSession(session, attachments);
  }

  private async attachToSession(session: ChatSession, additions: Attachment[]): Promise<void> {
    const existing = new Set(session.attachments.map((item) => item.fsPath));
    const unique = additions.filter((item) => !existing.has(item.fsPath));

    if (unique.length === 0) {
      this.post({ type: "info", message: "Selected files are already attached." });
      return;
    }

    session.attachments = [...session.attachments, ...unique];
    session.updatedAt = Date.now();
    await this.store.upsertSession(session);
    this.post({ type: "sessionUpdated", session });
  }

  private async removeAttachment(sessionId: string, attachmentId: string): Promise<void> {
    const updated = await this.store.removeAttachment(sessionId, attachmentId);
    if (updated) {
      this.post({ type: "sessionUpdated", session: updated });
    }
  }

  private async ensureActiveSession(): Promise<ChatSession> {
    const active = this.store.getActiveSession();
    if (active) {
      return active;
    }

    return this.store.createSession();
  }

  private async ensureSession(sessionId: string): Promise<ChatSession> {
    const existing = this.store.getSession(sessionId);
    if (existing) {
      await this.store.setActiveSession(existing.id);
      return existing;
    }

    return this.store.createSession();
  }

  private async pushBootstrap(): Promise<void> {
    this.post({
      type: "bootstrapped",
      payload: {
        sessions: this.store.getSessions(),
        activeSessionId: this.store.getActiveSessionId()
      }
    });
  }

  private post(message: ExtensionToWebviewMessage): void {
    if (!this.webview) {
      return;
    }

    void this.webview.postMessage(message);
  }
}
