import { randomUUID } from "node:crypto";
import * as path from "node:path";
import Fuse, { FuseResult } from "fuse.js";
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

interface MentionFileEntry {
  uri: vscode.Uri;
  relative: string;
  base: string;
  stem: string;
}

interface MentionIndexCache {
  workspaceKey: string;
  builtAt: number;
  entries: MentionFileEntry[];
  fuse: Fuse<MentionFileEntry>;
}

export class GeminiChatController {
  private webview?: vscode.Webview;
  private readonly processManager = new GeminiProcessManager();
  private readonly slashRouter = new SlashCommandRouter();
  private readonly contextCollector = new ContextCollector();
  private debugModeEnabled = false;
  private mentionSearchSeq = 0;
  private mentionIndexCache?: MentionIndexCache;
  private activeRequest?: { requestId: string; sessionId: string; assistantMessageId: string };
  private messageDisposable?: vscode.Disposable;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ChatSessionStore
  ) {}

  bindWebview(webview: vscode.Webview): void {
    if (this.messageDisposable) {
      this.messageDisposable.dispose();
    }

    this.webview = webview;

    this.messageDisposable = webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      void this.handleMessage(message);
    });

    void this.pushBootstrap();
  }

  dispose(): void {
    this.processManager.stopAll();
  }

  async createSession(): Promise<void> {
    const session = await this.store.createSession();
    console.log("GeminiChatController: createSession", { sessionId: session.id, activeSessionId: session.id });
    this.post({ type: "sessionUpdated", session, activeSessionId: session.id });
  }

  async clearSessions(): Promise<void> {
    await this.stopActiveRequest();
    const initial = await this.store.clearAll();
    console.log("GeminiChatController: clearSessions", { activeSessionId: initial.id, sessionCount: 1 });
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
    console.log("GeminiChatController: stopActiveRequest called", this.activeRequest);
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
      case "searchFiles":
        await this.searchFiles(message.query);
        return;
      case "sendPrompt":
        await this.sendPrompt(message.sessionId, message.prompt);
        return;
      case "setModel":
        await this.setModel(message.sessionId, message.modelId);
        return;
      case "setAgent":
        await this.setAgent(message.sessionId, message.agentId);
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
      case "toggleDebugMode":
        this.debugModeEnabled = message.enabled;
        this.post({ type: "debugModeToggled", enabled: this.debugModeEnabled });
        this.post({
          type: "info",
          message: this.debugModeEnabled ? "Debug mode enabled." : "Debug mode disabled."
        });
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
    const baseArgs = preferredModel ? this.overrideModelArg(defaultArgs, preferredModel) : defaultArgs;
    
    // Always force stream-json to get structured events for tool calls and streams
    const cleanArgs = baseArgs.filter(a => !["--output-format", "-o", "stream-json", "json", "text"].includes(a));
    const resolvedArgs = [...cleanArgs, "--output-format", "stream-json"];

    const effectiveMode = route.commandMeta?.mode ?? session.activeMode ?? "plan";
    const selectedAgent = (session.defaultAgentId || "").trim();

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

    await this.resolveMentionAttachments(prompt, session, maxAttachedFiles);

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
      agentCommand: selectedAgent ? `/${selectedAgent}` : undefined,
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

  private async setAgent(sessionId: string, agentId: string): Promise<void> {
    const session = await this.ensureSession(sessionId);
    const nextAgent = agentId.trim();

    session.defaultAgentId = nextAgent || undefined;
    session.updatedAt = Date.now();
    await this.store.upsertSession(session);
    this.post({ type: "sessionUpdated", session });
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

    const additions = (await this.contextCollector.fromDroppedFiles(accepted, available)).slice(0, available);
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
        availableAgents: this.getAvailableAgents(),
        availableModels: this.getAvailableModels()
      }
    });

    this.post({ type: "debugModeToggled", enabled: this.debugModeEnabled });
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
    const config = vscode.workspace.getConfiguration("geminiCliChat");
    const configuredModels = (config.get<string[]>("availableModels", []) || [])
      .map((item) => item.trim())
      .filter((item) => Boolean(item));

    const fallbackModels = [
      "gemini-3.1-pro-preview",
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite-preview",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite"
    ];

    const source = configuredModels.length > 0 ? configuredModels : fallbackModels;
    const normalized = source.filter((item) => item !== "auto" && item !== "manual");
    return [...new Set(["auto", ...normalized, "manual"] )];
  }

  private getAvailableAgents(): string[] {
    const config = vscode.workspace.getConfiguration("geminiCliChat");
    const configuredAgents = (config.get<string[]>("availableAgents", []) || [])
      .map((item) => item.trim())
      .filter((item) => Boolean(item));

    const fallbackAgents = [
      "codebase_investigator",
      "cli_help",
      "generalist"
    ];

    const source = configuredAgents.length > 0 ? configuredAgents : fallbackAgents;
    return [...new Set(source)];
  }

  private async searchFiles(query: string): Promise<void> {
    const normalized = query.trim().toLowerCase();
    const requestSeq = ++this.mentionSearchSeq;
    const suggestions = normalized.length < 2
      ? []
      : await this.findWorkspaceMentionSuggestions(normalized, 20);

    if (requestSeq !== this.mentionSearchSeq) {
      return;
    }

    this.post({
      type: "fileSearchResults",
      query: normalized,
      suggestions
    });
  }

  private async findWorkspaceMentionSuggestions(query: string, maxResults: number): Promise<string[]> {
    if (!query) {
      return [];
    }

    const index = await this.getMentionIndex();
    if (index.entries.length === 0) {
      return [];
    }

    const scored = index.fuse
      .search(query, { limit: maxResults * 5 })
      .map((result) => ({
        relative: result.item.relative,
        score: this.rankFuseResult(query, result)
      }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.relative);

    return [...new Set(scored)].slice(0, maxResults);
  }

  private async getMentionIndex(): Promise<MentionIndexCache> {
    const workspaceKey = this.buildWorkspaceKey();
    const now = Date.now();

    if (
      this.mentionIndexCache &&
      this.mentionIndexCache.workspaceKey === workspaceKey &&
      now - this.mentionIndexCache.builtAt < 15000
    ) {
      return this.mentionIndexCache;
    }

    const folders = vscode.workspace.workspaceFolders || [];
    const root = folders[0];
    if (!root) {
      const emptyFuse = new Fuse<MentionFileEntry>([], {
        includeScore: true,
        shouldSort: true,
        ignoreLocation: true,
        threshold: 0.4,
        minMatchCharLength: 2,
        keys: [
          { name: "stem", weight: 0.55 },
          { name: "base", weight: 0.30 },
          { name: "relative", weight: 0.15 }
        ]
      });

      this.mentionIndexCache = {
        workspaceKey,
        builtAt: now,
        entries: [],
        fuse: emptyFuse
      };
      return this.mentionIndexCache;
    }

    const include = new vscode.RelativePattern(root, "**/*");
    const exclude = "**/{.git,node_modules,vendor,dist,build,out,coverage,.next,.turbo,.cache}/**";
    const uris = await vscode.workspace.findFiles(include, exclude, 12000);
    const entries: MentionFileEntry[] = uris
      .filter((uri) => uri.scheme === "file")
      .map((uri) => {
        const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, "/");
        const base = uri.path.split("/").pop() || relative;
        const stem = base.replace(/\.[^.]+$/, "");

        return {
          uri,
          relative,
          base,
          stem
        };
      });

    const fuse = new Fuse(entries, {
      includeScore: true,
      shouldSort: true,
      ignoreLocation: true,
      threshold: 0.4,
      minMatchCharLength: 2,
      keys: [
        { name: "stem", weight: 0.55 },
        { name: "base", weight: 0.30 },
        { name: "relative", weight: 0.15 }
      ]
    });

    this.mentionIndexCache = {
      workspaceKey,
      builtAt: now,
      entries,
      fuse
    };

    return this.mentionIndexCache;
  }

  private buildWorkspaceKey(): string {
    const root = (vscode.workspace.workspaceFolders || [])[0];
    return root?.uri.fsPath || "";
  }

  private async resolveMentionAttachments(prompt: string, session: ChatSession, maxAttachedFiles: number): Promise<void> {
    const mentionMatches = [...prompt.matchAll(/(?:^|\s)@([^\s@]+)/g)];
    if (mentionMatches.length === 0) {
      return;
    }

    const available = Math.max(0, maxAttachedFiles - session.attachments.length);
    if (available === 0) {
      return;
    }

    const tokens = [...new Set(mentionMatches.map((match) => this.normalizeMentionToken(match[1])).filter(Boolean))] as string[];
    if (tokens.length === 0) {
      return;
    }

    const existing = new Set(session.attachments.map((item) => item.fsPath.toLowerCase()));
    const additions: Attachment[] = [];

    for (const token of tokens) {
      if (additions.length >= available) {
        break;
      }

      const candidates = await this.findWorkspaceFilesForMention(token, 25);
      for (const candidate of candidates) {
        if (additions.length >= available) {
          break;
        }

        const key = candidate.fsPath.toLowerCase();
        if (existing.has(key)) {
          continue;
        }

        existing.add(key);
        additions.push({
          id: randomUUID(),
          name: candidate.path.split("/").pop() || "untitled",
          fsPath: candidate.fsPath,
          uri: candidate.toString()
        });
      }
    }

    if (additions.length > 0) {
      await this.attachToSession(session, additions);
    }
  }

  private normalizeMentionToken(token: string): string {
    const stripped = token
      .trim()
      .replace(/^["'`([{]+/, "")
      .replace(/["'`\])}.,;:!?]+$/, "")
      .replace(/^@+/, "");

    return stripped;
  }

  private async findWorkspaceFilesForMention(token: string, maxResults: number): Promise<vscode.Uri[]> {
    const rawToken = token.trim();
    if (!rawToken) {
      return [];
    }

    const direct = await this.resolveDirectMentionPath(rawToken);
    if (direct) {
      return [direct];
    }

    const normalized = this.normalizeSearchKey(rawToken);
    if (!normalized) {
      return [];
    }

    const index = await this.getMentionIndex();
    const ranked = index.fuse
      .search(rawToken, { limit: maxResults * 6 })
      .map((result) => ({ uri: result.item.uri, score: this.rankFuseResult(normalized, result) }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.uri);

    const unique = new Map<string, vscode.Uri>();
    for (const uri of ranked) {
      if (!unique.has(uri.toString())) {
        unique.set(uri.toString(), uri);
      }
    }

    return [...unique.values()].slice(0, maxResults);
  }

  private async resolveDirectMentionPath(token: string): Promise<vscode.Uri | undefined> {
    const candidates: string[] = [];

    if (path.isAbsolute(token)) {
      candidates.push(token);
    }

    for (const folder of vscode.workspace.workspaceFolders || []) {
      candidates.push(path.resolve(folder.uri.fsPath, token));
    }

    for (const candidate of candidates) {
      const uri = vscode.Uri.file(candidate);
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type === vscode.FileType.File) {
          return uri;
        }
      } catch {
        // Ignore missing paths and continue with fallback search.
      }
    }

    return undefined;
  }

  private rankFuseResult(query: string, result: FuseResult<MentionFileEntry>): number {
    const normalizedQuery = this.normalizeSearchKey(query);
    const relative = result.item.relative.toLowerCase();
    const base = result.item.base.toLowerCase();
    const stem = result.item.stem.toLowerCase();
    const normalizedBase = this.normalizeSearchKey(base);
    const normalizedStem = this.normalizeSearchKey(stem);
    const depth = relative.split("/").length;
    let score = 1000 - Math.round((result.score ?? 1) * 1000);

    if (normalizedStem === normalizedQuery || normalizedBase === normalizedQuery) {
      score += 500;
    } else if (normalizedStem.startsWith(normalizedQuery) || normalizedBase.startsWith(normalizedQuery)) {
      score += 320;
    }

    if (relative.includes(`/${normalizedQuery}`)) {
      score += 140;
    }

    if (normalizedStem.includes(normalizedQuery)) {
      score += 120;
    }

    if (relative.includes("/src/")) {
      score += 20;
    }

    if (relative.includes("/views/") || relative.includes("/view/")) {
      score += 24;
    }

    if (relative.includes("/components/")) {
      score += 18;
    }

    score -= depth * 10;
    return score;
  }

  private normalizeSearchKey(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
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
