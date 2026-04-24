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
      } catch (e) {
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

export class GeminiACPClient {
  private process?: cp.ChildProcessWithoutNullStreams;
  private connection?: MessageConnection;
  private runningRequestId?: string;
  private inThoughtBlock = false;
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
        const tc = update.toolCall;
        const toolName = tc?.name || tc?.title || tc?.id || update.title || "Executing...";
        const contentLen = Array.isArray(update.content) ? update.content.length : 0;
        console.log(`[ACP] tool_call: "${update.title}" status=${update.status} kind=${update.kind} contentLen=${contentLen}`);
        if (contentLen > 0) {
          for (const c of update.content) {
            console.log(`[ACP] tool_call content item: type=${c.type} keys=${Object.keys(c)}`);
          }
        }
        this.callbacks.onChunk(`\n[Tool: ${toolName}]\n`);
        // Extract diff từ tool_call content[] (có thể chứa diff khi completed)
        this.emitDiffFromContent(update.content);
      } else if (update.sessionUpdate === "tool_call_update") {
        const status = update.status === "completed" ? "Done" : update.status;
        const toolName = update.title || update.toolCall?.name || update.toolCall?.title || "Task";
        // Debug: ALWAYS log tool_call_update
        const contentLen = Array.isArray(update.content) ? update.content.length : 0;
        console.log(`[ACP] tool_call_update: "${toolName}" status=${update.status} contentLen=${contentLen} keys=${Object.keys(update)}`);
        if (contentLen > 0) {
          for (const c of update.content) {
            console.log(`[ACP] content item: type=${c.type} keys=${Object.keys(c)} hasOldText=${!!c.oldText} hasNewText=${!!c.newText} hasOld_text=${!!c.old_text} hasNew_text=${!!c.new_text}`);
          }
        }
        this.callbacks.onChunk(`\n[Tool: ${toolName} - ${status}]\n`);
        console.log(`🟡 [ACP] About to call emitDiffFromContent, contentLen=${contentLen}`);
        try {
          this.emitDiffFromContent(update.content);
          console.log(`🟡 [ACP] emitDiffFromContent call completed`);
        } catch (err) {
          console.error(`🔴 [ACP] emitDiffFromContent THREW:`, err);
        }
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
      console.log(">>>> [DEBUG] RECEIVED PERMISSION REQUEST FROM ACP CLI:", JSON.stringify(params, null, 2));
      const requestId = randomUUID();
      
      // Nếu đang ở trong thought block, phải đóng nó lại trước khi hiện permission
      if (this.inThoughtBlock) {
        this.callbacks.onChunk("\n</thought>\n");
        this.inThoughtBlock = false;
      }

      const tc = params.toolCall;
      const title = tc?.title || tc?.name || tc?.id || params.message || "Agent wants to perform an action";
      const options = params.options || [];

      // Extract diff data từ file_edit_details nếu có (ACP FileDiff protocol)
      const fileEdit = params.file_edit_details || params.fileEditDetails || tc?.file_edit_details || tc?.fileEditDetails;
      let diffText: string | undefined;
      let filePath: string | undefined;
      
      if (fileEdit) {
        if (fileEdit.formatted_diff || fileEdit.formattedDiff) {
          diffText = fileEdit.formatted_diff || fileEdit.formattedDiff;
        } else if (fileEdit.old_content != null && fileEdit.new_content != null) {
          // Fallback: tạo simple context từ old/new content
          const fileName = fileEdit.file_name || fileEdit.fileName || fileEdit.file_path || fileEdit.filePath || "unknown";
          diffText = `--- a/${fileName}\n+++ b/${fileName}\n`;
        }
        filePath = fileEdit.file_path || fileEdit.filePath || fileEdit.file_name || fileEdit.fileName;
      } else if (tc?.content && Array.isArray(tc.content)) {
        // Fallback: Tìm diff trong toolCall.content (ACP ToolCall protocol)
        const diffItem = tc.content.find((c: any) => c.type === 'diff');
        if (diffItem) {
          diffText = diffItem.formatted_diff || diffItem.formattedDiff;
          if (!diffText && diffItem.oldText !== undefined && diffItem.newText !== undefined) {
             diffText = `FILE: ${diffItem.path}\n<<<< OLD\n${diffItem.oldText}\n==== NEW\n${diffItem.newText}\n>>>>`;
          }
          filePath = diffItem.path;
        }
      }

      // Gửi request xuống webview thay vì hiện popup
      console.log(`[ACP] Requesting permission: ${title} (requestId: ${requestId})`, diffText ? `[has diff]` : "[no diff]");
      const permissionData: any = {
        requestId,
        message: title,
        options: options.map((o: any) => ({ label: o.name, value: o.optionId }))
      };
      if (diffText) permissionData.diffText = diffText;
      if (filePath) permissionData.filePath = filePath;
      
      this.callbacks.onChunk(`\n<permission_request>${JSON.stringify(permissionData)}</permission_request>\n`);

      // Chờ phản hồi từ webview thông qua cơ chế event-driven hoặc await (cần cách xử lý async)
      return new Promise((resolve) => {
        // Cần lưu requestId này vào một map để handle callback khi webview gửi về
        // Tạm thời anh sẽ mock việc resolve này dựa trên message từ webview sau
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
        const oldText = item.oldText ?? item.old_text ?? "";
        const newText = item.newText ?? item.new_text ?? "";
        const payload = JSON.stringify({ path: item.path, oldText, newText });
        console.log(`🟢 [ACP] EMIT <file_diff> path=${item.path} oldLen=${oldText.length} newLen=${newText.length} payloadLen=${payload.length}`);
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
  }
}