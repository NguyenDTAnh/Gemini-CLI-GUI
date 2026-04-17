import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { ContextCollector } from "./ContextCollector";
import { GeminiProcessManager } from "./GeminiProcessManager";
import { SlashCommandRouter } from "./SlashCommandRouter";
import { ChatSessionStore } from "../state/ChatSessionStore";
import {
  Attachment,
  ChatMessage,
  ChatMode,
  ChatSession,
  DroppedFilePayload,
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

  async prefillFromActiveSelection(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this.post({ type: "info", message: "No active editor found." });
      return;
    }

    const raw = editor.document.getText(editor.selection).trim();
    if (!raw) {
      this.post({ type: "info", message: "Please select some text first." });
      return;
    }

    const session = await this.ensureActiveSession();
    const startLine = editor.selection.start.line + 1;
    const endLine = editor.selection.end.line + 1;
    const targetPath = vscode.workspace.asRelativePath(editor.document.uri, false);
    const payload = [
      `## Selected context: ${targetPath}:${startLine}-${endLine}`,
      `\`\`\`${editor.document.languageId}`,
      raw,
      "```"
    ].join("\n");

    this.post({
      type: "composerPrefill",
      sessionId: session.id,
      text: payload,
      append: true
    });
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
      case "setModel":
        await this.setModel(message.sessionId, message.modelId);
        return;
      case "toggleMode":
        await this.setMode(message.sessionId, message.mode);
        return;
      case "attachFiles":
        await this.attachDroppedFiles(message.sessionId, message.files);
        return;
      case "insertSelectedContext":
        await this.insertSelectedContext(message.sessionId, message.text, message.source);
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
    this.syncSlashConfiguration();
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

    const preferredModel = (session.defaultModelId || "").trim();
    const modelName = preferredModel || this.extractModelNameFromArgs(defaultArgs) || "Gemini";
    const resolvedArgs = preferredModel ? this.overrideModelArg(defaultArgs, preferredModel) : defaultArgs;
    const effectiveMode = route.commandMeta?.mode ?? session.activeMode ?? "plan";

    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      status: "streaming",
      requestId,
      model: modelName,
      modelId: modelName,
      mode: effectiveMode
    };

    userMessage.mode = effectiveMode;

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

    const mentionContext = this.buildMentionContext(prompt, session.attachments);
    const transformedPrompt = mentionContext
      ? `${route.transformedPrompt}\n\n${mentionContext}`
      : route.transformedPrompt;

    this.processManager.runRequest({
      requestId,
      cliPath,
      args: resolvedArgs,
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      timeoutMs,
      prompt: transformedPrompt,
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

  private async setModel(sessionId: string, modelId: string): Promise<void> {
    const session = await this.ensureSession(sessionId);
    if (modelId === "auto") {
      session.defaultModelId = undefined;
      session.updatedAt = Date.now();
      await this.store.upsertSession(session);
      this.post({ type: "sessionUpdated", session });
      this.post({ type: "modelUpdated", sessionId: session.id, modelId: "" });
      return;
    }

    let nextModel = modelId.trim();
    if (modelId === "manual") {
      const picked = await vscode.window.showInputBox({
        title: "Select Gemini model",
        prompt: "Enter the Gemini CLI model id to use (e.g. gemini-3.1-pro-preview)",
        placeHolder: "gemini-3.1-pro-preview",
        value: session.defaultModelId || ""
      });

      if (picked === undefined) {
        // User cancelled, keep current selection in UI if possible, 
        // but we need to notify webview to reset its state.
        this.post({ type: "sessionUpdated", session });
        return;
      }

      nextModel = (picked || "").trim();
    }

    if (!nextModel) {
      this.post({ type: "info", message: "Model id is required." });
      // Reset UI to previous valid state
      this.post({ type: "sessionUpdated", session });
      return;
    }

    session.defaultModelId = nextModel;
    session.updatedAt = Date.now();
    await this.store.upsertSession(session);
    this.post({ type: "sessionUpdated", session });
    this.post({ type: "modelUpdated", sessionId: session.id, modelId: nextModel });
  }

  private async setMode(sessionId: string, mode: ChatMode): Promise<void> {
    const session = await this.ensureSession(sessionId);
    session.activeMode = mode;
    session.updatedAt = Date.now();
    await this.store.upsertSession(session);
    this.post({ type: "sessionUpdated", session });
    this.post({ type: "modeUpdated", sessionId: session.id, mode });
  }

  private async attachDroppedFiles(sessionId: string, files: DroppedFilePayload[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    const config = vscode.workspace.getConfiguration("geminiCliChat");
    const maxDroppedFileBytes = config.get<number>("maxDroppedFileBytes", 5 * 1024 * 1024);
    const maxAttachedFiles = config.get<number>("maxAttachedFiles", 5);
    const accepted = files.filter((file) => !file.size || file.size <= maxDroppedFileBytes);
    if (accepted.length !== files.length) {
      this.post({ type: "info", message: "Some dropped files were skipped because they are too large." });
    }

    const session = await this.ensureSession(sessionId);
    const available = Math.max(0, maxAttachedFiles - session.attachments.length);
    if (available === 0) {
      this.post({ type: "info", message: "Attachment limit reached for this session." });
      return;
    }

    const additions = this.contextCollector.fromDroppedFiles(accepted).slice(0, available);
    if (additions.length === 0) {
      this.post({ type: "info", message: "No valid files were dropped." });
      return;
    }

    await this.attachToSession(session, additions);

    const mentionTokens = additions.map((item) => `@${item.name}`).join(" ");
    if (mentionTokens) {
      this.post({
        type: "composerPrefill",
        sessionId: session.id,
        text: mentionTokens,
        append: true
      });
    }
  }

  private async insertSelectedContext(
    sessionId: string,
    text: string,
    source: "editorSelection" | "manual" = "manual"
  ): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    const session = await this.ensureSession(sessionId);
    const payload = source === "editorSelection" ? trimmed : ["## Context", trimmed].join("\n\n");
    this.post({ type: "composerPrefill", sessionId: session.id, text: payload, append: true });
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
    this.syncSlashConfiguration();
    const commandRegistry = this.slashRouter.getCommandRegistry();
    const commandDescriptors = Object.values(commandRegistry);

    this.post({
      type: "bootstrapped",
      payload: {
        sessions: this.store.getSessions(),
        activeSessionId: this.store.getActiveSessionId(),
        supportedCommands: this.slashRouter.getSupportedCommands(),
        commandDescriptors,
        availableModels: this.getAvailableModels()
      }
    });
  }

  private post(message: ExtensionToWebviewMessage): void {
    if (!this.webview) {
      return;
    }

    void this.webview.postMessage(message);
  }

  private extractModelNameFromArgs(args: string[]): string | undefined {
    for (let i = 0; i < args.length; i++) {
      const current = args[i];
      if ((current === "-m" || current === "--model") && i + 1 < args.length) {
        return args[i + 1];
      }

      if (current.startsWith("--model=")) {
        return current.slice("--model=".length);
      }
    }

    return undefined;
  }

  private overrideModelArg(args: string[], modelId: string): string[] {
    const next = [...args];
    for (let i = 0; i < next.length; i++) {
      if ((next[i] === "-m" || next[i] === "--model") && i + 1 < next.length) {
        next[i + 1] = modelId;
        return next;
      }

      if (next[i].startsWith("--model=")) {
        next[i] = `--model=${modelId}`;
        return next;
      }
    }

    next.push("--model", modelId);
    return next;
  }

  private syncSlashConfiguration(): void {
    const config = vscode.workspace.getConfiguration("geminiCliChat");
    const customCommands = config.get<Record<string, string | {
      hint: string;
      category?: "analysis" | "generation" | "editing" | "debug";
      mode?: ChatMode;
      requiresAttachment?: boolean;
    }>>("customSlashCommands");

    this.slashRouter.setCustomCommands(customCommands);
  }

  private getAvailableModels(): string[] {
    return ["auto", "manual"];
  }

  private buildMentionContext(prompt: string, attachments: Attachment[]): string {
    const matches = [...prompt.matchAll(/(?:^|\s)@([^\s@]+)/g)];
    if (matches.length === 0 || attachments.length === 0) {
      return "";
    }

    const queryTerms = new Set(matches.map((match) => match[1].toLowerCase()));
    const selected = attachments.filter((attachment) => {
      const name = attachment.name.toLowerCase();
      const fsPath = attachment.fsPath.toLowerCase();
      for (const token of queryTerms) {
        if (name === token || name.includes(token) || fsPath.includes(token)) {
          return true;
        }
      }

      return false;
    });

    if (selected.length === 0) {
      return "";
    }

    const lines = selected.map((attachment) => `- ${attachment.name} (${attachment.fsPath})`);
    return ["Referenced files:", ...lines].join("\n");
  }
}
