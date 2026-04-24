import * as cp from "node:child_process";
import * as readline from "node:readline";
import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import {
  createMessageConnection,
  MessageConnection,
  MessageReader,
  MessageWriter,
  Event,
  Emitter,
  Message,
  RequestType,
  NotificationType
} from "vscode-jsonrpc/node";

// --- Custom NDJSON Transports for vscode-jsonrpc ---

class NDJsonMessageReader implements MessageReader {
  private readonly _onError = new Emitter<Error>();
  private readonly _onClose = new Emitter<void>();
  private readonly _onPartialMessage = new Emitter<any>();
  private readonly _onData = new Emitter<Message>();
  
  public readonly onError: Event<Error> = this._onError.event;
  public readonly onClose: Event<void> = this._onClose.event;
  public readonly onPartialMessage: Event<any> = this._onPartialMessage.event;
  public readonly onData: Event<Message> = this._onData.event;

  private rl?: readline.Interface;

  constructor(private readonly stream: NodeJS.ReadableStream) {}

  public listen(callback: (message: Message) => void): vscode.Disposable {
    const d = this._onData.event(callback);
    this.rl = readline.createInterface({
      input: this.stream,
      terminal: false
    });

    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as Message;
        this._onData.fire(msg);
      } catch {
        console.log(`[ACP CLI Raw Output] ${trimmed}`);
      }
    });

    this.rl.on("close", () => {
      this._onClose.fire();
    });

    return {
      dispose: () => {
        d.dispose();
        this.rl?.close();
      }
    };
  }

  public dispose(): void {
    this.rl?.close();
    this._onError.dispose();
    this._onClose.dispose();
    this._onPartialMessage.dispose();
    this._onData.dispose();
  }
}

class NDJsonMessageWriter implements MessageWriter {
  private readonly _onError = new Emitter<[Error, Message | undefined, number | undefined]>();
  private readonly _onClose = new Emitter<void>();

  public readonly onError: Event<[Error, Message | undefined, number | undefined]> = this._onError.event;
  public readonly onClose: Event<void> = this._onClose.event;

  constructor(private readonly stream: NodeJS.WritableStream) {}

  public write(msg: Message): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const payload = JSON.stringify(msg) + "\n";
        this.stream.write(payload, "utf8", (error) => {
          if (error) reject(error);
          else resolve();
        });
      } catch (e) {
        this._onError.fire([e as Error, msg, undefined]);
        reject(e);
      }
    });
  }

  public end(): void {
    this.stream.end();
    this._onClose.fire();
  }

  public dispose(): void {
    this._onError.dispose();
    this._onClose.dispose();
  }
}

// --- ACP Client Definition ---

export interface PromptRequest {
  sessionId: string;
  prompt: string;
}

export interface ClientCallbacks {
  onChunk: (chunk: string) => void;
  onDone: (requestId: string) => void;
  onError: (requestId: string, message: string) => void;
}

/**
 * Mapping raw tool name -> display name giống Gemini CLI hiển thị.
 * Nguồn: danh sách tools chuẩn của Gemini CLI.
 */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  activate_skill: "Activate Skill",
  ask_user: "Ask User",
  cli_help: "CLI Help Agent",
  codebase_investigator: "Codebase Investigator Agent",
  replace: "Edit",
  enter_plan_mode: "Enter Plan Mode",
  glob: "FindFiles",
  generalist: "Generalist Agent",
  google_web_search: "GoogleSearch",
  list_background_processes: "List Background Processes",
  read_background_output: "Read Background Output",
  read_file: "ReadFile",
  list_directory: "ReadFolder",
  save_memory: "SaveMemory",
  grep_search: "SearchText",
  run_shell_command: "Shell",
  web_fetch: "WebFetch",
  write_file: "WriteFile",
};

export class GeminiACPClient {
  private process?: cp.ChildProcessWithoutNullStreams;
  private connection?: MessageConnection;
  private runningRequestId?: string;
  private inThoughtBlock = false;
  private _toolLabels = new Map<string, string>();
  private readonly callbacks: ClientCallbacks;

  constructor(
    private readonly cliPath: string,
    private readonly cwd: string | undefined,
    callbacks: ClientCallbacks
  ) {
    this.callbacks = callbacks;
  }

  public async start(): Promise<void> {
    if (this.connection) {
      return;
    }

    this.process = cp.spawn(this.cliPath, ["--acp"], {
      cwd: this.cwd,
      stdio: "pipe"
    });

    this.process.stderr.on("data", (data) => {
      console.error(`[ACP CLI Stderr] ${data.toString()}`);
    });

    const reader = new NDJsonMessageReader(this.process.stdout);
    const writer = new NDJsonMessageWriter(this.process.stdin);

    this.connection = createMessageConnection(reader, writer);

    // Logger cho tất cả các request để debug protocol
    this.connection.onRequest((method, params) => {
      console.log(`[ACP] Incoming Request: ${method}`, JSON.stringify(params, null, 2));
    });

    // Register Notification Handlers for streaming and tool calls
    console.log("🔥🔥🔥 [ACP] NEW CODE LOADED - session/update handler registered 🔥🔥🔥");
    this.connection.onNotification("session/update", (params: any) => {
      const update = params?.update;
      if (!update) return;

      const isThought = update.sessionUpdate === "agent_thought_chunk" || update.sessionUpdate === "agent_thought";
      
      if (this.inThoughtBlock && !isThought) {
        this.callbacks.onChunk("\n</thought>\n");
        this.inThoughtBlock = false;
      }

      if (update.sessionUpdate === "agent_message_chunk") {
        if (update.content?.type === "text" && update.content?.text) {
          this.callbacks.onChunk(update.content.text);
        }
      } else if (update.sessionUpdate === "agent_thought_chunk") {
        if (update.content?.type === "text" && update.content?.text) {
          if (!this.inThoughtBlock) {
            this.callbacks.onChunk("\n<thought>\n");
            this.inThoughtBlock = true;
          }
          // Kiểm tra nếu là JSON (thường từ agent_thought) thì format lại cho đẹp
          let text = update.content.text;
          try {
            if (text.trim().startsWith('{')) {
              const parsed = JSON.parse(text);
              text = parsed.query || parsed.thought || text;
            }
          } catch { /* JSON parse fallback, giữ text gốc */ }
          this.callbacks.onChunk(text);
        }
      } else if (update.sessionUpdate === "tool_call") {
        const tc = update.toolCall || update;
        const callId = tc?.id || tc?.toolCallId || update.id || update.toolCallId;
        const displayLabel = this.buildToolDisplayLabel(tc, update);
        console.log(`[ACP] tool_call: id=${callId} raw=${tc?.name || tc?.toolCallId} -> label="${displayLabel}"`);

        if (callId) {
            this._toolLabels.set(callId, displayLabel);
        }

        this.callbacks.onChunk(`\n[Tool: ${displayLabel}]\n`);
        // Extract diff từ tool_call content[] (có thể chứa diff khi completed)
        this.emitDiffFromContent(update.content || tc?.content);
      } else if (update.sessionUpdate === "tool_call_update") {
        const status = update.status === "completed" ? "Done" : update.status;
        const tc = update.toolCall || update;
        const callId = tc?.id || tc?.toolCallId || update.id || update.toolCallId;

        const displayLabel = (callId && this._toolLabels.has(callId))
          ? this._toolLabels.get(callId)!
          : this.buildToolDisplayLabel(tc, update, "Task");
        console.log(`[ACP] tool_call_update: id=${callId} status=${update.status} label="${displayLabel}" cached=${!!(callId && this._toolLabels.has(callId))}`);

        this.callbacks.onChunk(`\n[Tool: ${displayLabel} - ${status}]\n`);
        this.emitDiffFromContent(update.content || tc?.content);
      } else if (update.sessionUpdate === "agent_thought") {
        if (update.content?.type === "text" && update.content?.text) {
          if (!this.inThoughtBlock) {
            this.callbacks.onChunk("\n<thought>\n");
            this.inThoughtBlock = true;
          }
          this.callbacks.onChunk(update.content.text);
          this.callbacks.onChunk("\n</thought>\n");
          this.inThoughtBlock = false;
        }
      } else if (update.sessionUpdate === "available_commands_update") {
        console.log("[ACP] Available commands updated:", update.availableCommands?.length);
        // Tạm thời chưa cần hiển thị ra UI nhưng không báo unhandled nữa
      } else {
        // Fallback for other potential updates — log chi tiết để debug diff/file edit data
        console.log(`[ACP] Unhandled sessionUpdate: ${update.sessionUpdate}`, JSON.stringify(update, null, 2));
        if (update.content?.type === "text" && update.content?.text) {
          this.callbacks.onChunk(update.content.text);
        }
      }
    });

    // Handle incoming JSON-RPC Requests from Server (Permission Prompts)
    this.connection.onRequest("session/request_permission", async (params: any) => {
      console.log("🚨 [ACP-DEBUG-STEP-1] Received 'session/request_permission' from CLI");
      console.log("📦 Params:", JSON.stringify(params, null, 2));
      
      const requestId = randomUUID();
      
      // Nếu đang ở trong thought block, phải đóng nó lại trước khi hiện permission
      if (this.inThoughtBlock) {
        console.log("💭 [ACP-DEBUG-STEP-2] Closing open thought block before permission");
        this.callbacks.onChunk("\n</thought>\n");
        this.inThoughtBlock = false;
      }

      const tc = params.toolCall;
      const title = tc?.title || tc?.name || tc?.id || params.message || "Agent wants to perform an action";
      const options = params.options || [];

      // Cache display label cho tool này ngay từ permission request
      // để tool_call_update sau đó hiển thị đúng tên tool (VD: Edit [README.md])
      const permCallId = tc?.id || tc?.toolCallId;
      if (permCallId && !this._toolLabels.has(permCallId)) {
        const label = this.buildToolDisplayLabel(tc, params);
        this._toolLabels.set(permCallId, label);
        console.log(`[ACP] Cached tool label from permission: id=${permCallId} label="${label}"`);
      }

      // Extract diff data từ file_edit_details hoặc toolCall content (ACP Protocol)
      const fileEdit = params.file_edit_details || params.fileEditDetails || tc?.file_edit_details || tc?.fileEditDetails;
      let diffText: string | undefined;
      let filePath: string | undefined;

      if (fileEdit) {
        if (fileEdit.formatted_diff || fileEdit.formattedDiff) {
          diffText = fileEdit.formatted_diff || fileEdit.formattedDiff;
        } else if (fileEdit.old_content != null && fileEdit.new_content != null) {
          const fileName = fileEdit.file_name || fileEdit.fileName || fileEdit.file_path || fileEdit.filePath || "unknown";
          diffText = `--- a/${fileName}\n+++ b/${fileName}\n`;
        }
        filePath = fileEdit.file_path || fileEdit.filePath || fileEdit.file_name || fileEdit.fileName;
      } else if (tc?.content && Array.isArray(tc.content)) {
        // Fallback: Tìm diff trong toolCall.content
        const diffItem = tc.content.find((c: any) => c.type === 'diff');
        if (diffItem) {
          diffText = diffItem.formatted_diff || diffItem.formattedDiff;
          if (!diffText && diffItem.oldText !== undefined && diffItem.newText !== undefined) {
             // Tự tạo diff text đơn giản để hiển thị
             diffText = `FILE: ${diffItem.path}\n<<<< OLD\n${diffItem.oldText}\n==== NEW\n${diffItem.newText}\n>>>>`;
          }
          filePath = diffItem.path;
        }
      }

      // Gửi request xuống webview
      const permissionData: any = {
        requestId,
        message: title,
        options: options.map((o: any) => ({ label: o.name, value: o.optionId }))
      };
      if (diffText) permissionData.diffText = diffText;
      if (filePath) permissionData.filePath = filePath;
      
      const tagContent = `\n<permission_request>${JSON.stringify(permissionData)}</permission_request>\n`;
      console.log("📤 [ACP-DEBUG-STEP-3] Sending permission tag to Controller:", tagContent);
      this.callbacks.onChunk(tagContent);

      return new Promise((resolve) => {
        console.log(`⏳ [ACP-DEBUG-STEP-4] Waiting for user response for requestId: ${requestId}`);
        (this as any).pendingPermissions = (this as any).pendingPermissions || new Map();
        (this as any).pendingPermissions.set(requestId, resolve);
      });
    });

    this.process.on("error", (error) => {
      console.error("Gemini CLI process error", error);
      if (this.runningRequestId) {
        this.callbacks.onError(this.runningRequestId, error.message);
      }
    });

    this.process.on("close", (code) => {
      console.log(`Gemini CLI closed with code ${code}`);
      if (this.runningRequestId) {
        this.callbacks.onError(this.runningRequestId, `Process closed with code ${code}`);
      }
      this.stop();
    });

    this.connection.listen();

    try {
      const initReq = new RequestType<any, any, any>("initialize");
      await this.connection.sendRequest(initReq, { protocolVersion: 1 });
    } catch (e) {
      console.error("Failed to initialize ACP mode", e);
    }
  }

  public async newSession(modelId?: string, mcpServers?: any[]): Promise<string> {
    if (!this.connection) {
      await this.start();
    }
    try {
      const payload: any = { 
        model: modelId,
        cwd: this.cwd || process.cwd(),
        mcpServers: mcpServers || [] // CLI requires an array, even if empty
      };
      
      console.log("[ACP] Sending session/new with payload:", JSON.stringify(payload));
      
      const req = new RequestType<any, any, any>("session/new");
      const res = await this.connection!.sendRequest(req, payload);
      
      if (!res || !res.sessionId) {
        throw new Error("CLI returned an empty or invalid session response");
      }
      
      return res.sessionId;
    } catch (e) {
      console.error("[ACP] Failed to create new session. Error details:", e);
      // Re-throw to let controller handle it
      throw e;
    }
  }

  public async setSessionModel(sessionId: string, modelId: string | undefined): Promise<void> {
    if (!this.connection) return;
    try {
      const req = new RequestType<any, any, any>("session/unstable_setSessionModel");
      await this.connection.sendRequest(req, { sessionId, model: modelId });
      console.log(`[ACP] Session model updated to: ${modelId}`);
    } catch (e) {
      console.error("Failed to set session model", e);
    }
  }

  private emitDiffFromContent(content: any): void {
    if (!Array.isArray(content)) return;
    for (const item of content) {
      if (item?.type === "diff" && item.path) {
        const payload = JSON.stringify({
          path: item.path,
          oldText: item.oldText ?? item.old_text ?? "",
          newText: item.newText ?? item.new_text ?? ""
        });
        this.callbacks.onChunk(`\n<file_diff>${payload}</file_diff>\n`);
      }
    }
  }

  public async prompt(requestId: string, req: PromptRequest): Promise<void> {
    if (!this.connection) {
      await this.start();
    }
    
    this.runningRequestId = requestId;
    
    try {
      const promptReq = new RequestType<any, any, any>("session/prompt");
      // Mặc dù sendRequest sẽ chờ tới khi Agent sinh xong nội dung
      // Các callback stream vẫn sẽ gọi onChunk qua notification.
      await this.connection!.sendRequest(promptReq, {
        sessionId: req.sessionId,
        prompt: [{ type: "text", text: req.prompt }]
      });
      
      this.callbacks.onDone(requestId);
    } catch (e) {
      this.callbacks.onError(requestId, (e as Error).message);
    } finally {
      if (this.runningRequestId === requestId) {
        this.runningRequestId = undefined;
      }
    }
  }

  public cancel(): void {
    if (!this.connection) return;
    try {
      const cancelNotif = new NotificationType<any>("session/cancel");
      this.connection.sendNotification(cancelNotif, {});
    } catch (e) {
      console.error("Failed to cancel", e);
    }
  }

  public stop(): void {
    if (this.connection) {
      this.connection.dispose();
      this.connection = undefined;
    }
    if (this.process) {
      this.process.kill();
      this.process = undefined;
    }
    this.runningRequestId = undefined;
    this._toolLabels.clear();
  }

  /**
   * Tính display label cho tool call: map tên tool sang display name (giống CLI)
   * + trích xuất target (file/path/url/command) từ arguments.
   * Format: "DisplayName: target" (webview sẽ parse thành "DisplayName [target]")
   *
   * Lưu ý: KHÔNG fallback về `title` vì ACP title là human description
   * (VD: "themes/README.md: hotfix..."), không phải tên tool.
   */
  private buildToolDisplayLabel(tc: any, update: any, fallbackName = "Executing"): string {
    // Ưu tiên: tc.name > update.name > parse từ toolCallId (VD: "replace-1777051203110-2" -> "replace")
    let rawToolName: string = tc?.name || update.name || "";
    if (!rawToolName) {
      const rawId: string = tc?.id || tc?.toolCallId || update.id || update.toolCallId || "";
      // Format: "{tool_name}-{timestamp}-{idx}" - bỏ 2 segment số cuối
      const parsed = rawId.replace(/-\d+-\d+$/, '').replace(/-\d+$/, '');
      if (parsed && parsed !== rawId) rawToolName = parsed;
    }
    if (!rawToolName) rawToolName = fallbackName;

    // Bỏ prefix default_api:, mcp_provider_ nếu có để lấy tool key thuần
    const normalizedKey = (rawToolName.split(':').pop() || rawToolName)
      .replace(/^mcp_[^_]+_/, '')
      .toLowerCase();

    // Map sang display name chuẩn CLI, fallback: snake_case -> PascalCase
    const displayToolName = TOOL_DISPLAY_NAMES[normalizedKey]
      || normalizedKey.split('_').map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join('');

    // Trích xuất target từ arguments (path/file/url/command/query/pattern)
    let target = "";
    const args = tc?.arguments || tc?.args || tc?.input || tc?.parameters || {};
    if (typeof args === 'object' && args !== null) {
      target = args.path || args.file_path || args.filePath || args.absolute_path
        || args.dir_path || args.dirPath
        || args.command // run_shell_command
        || args.pattern // glob / grep
        || args.query   // google_web_search / agents
        || args.url     // web_fetch
        || args.prompt  // ask_user / subagents
        || "";
    }

    // Fallback: extract path từ tc.locations hoặc tc.content[].path nếu args không có
    if (!target && Array.isArray(tc?.locations) && tc.locations.length > 0) {
      target = tc.locations[0]?.path || "";
    }
    if (!target && Array.isArray(tc?.content)) {
      const pathItem = tc.content.find((c: any) => c?.path);
      if (pathItem) target = pathItem.path;
    }

    // Rút gọn target: hostname cho URL, basename cho path, truncate cho command dài
    let displayTarget = typeof target === 'string' ? target : String(target ?? '');
    if (displayTarget.includes('/')) {
      if (displayTarget.startsWith('http')) {
        try { displayTarget = new URL(displayTarget).hostname; } catch { /* giữ nguyên */ }
      } else if (!displayTarget.includes(' ')) {
        // Chỉ split path khi không phải shell command
        displayTarget = displayTarget.split('/').filter(Boolean).pop() || displayTarget;
      }
    }
    // Truncate command/query dài
    if (displayTarget.length > 80) {
      displayTarget = displayTarget.slice(0, 77) + '...';
    }
    // Chỉ lấy dòng đầu cho shell command nhiều dòng
    displayTarget = displayTarget.split('\n')[0];

    return displayTarget ? `${displayToolName}: ${displayTarget}` : displayToolName;
  }
}
