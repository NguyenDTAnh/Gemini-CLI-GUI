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
        // Not a JSON message, ignore or log
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

    const reader = new NDJsonMessageReader(this.process.stdout);
    const writer = new NDJsonMessageWriter(this.process.stdin);

    this.connection = createMessageConnection(reader, writer);

    // Register Notification Handlers for streaming and tool calls
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
          } catch (e) {}
          this.callbacks.onChunk(text);
        }
      } else if (update.sessionUpdate === "tool_call") {
        console.log("[ACP] tool_call update:", JSON.stringify(update, null, 2));
        const tc = update.toolCall;
        const toolName = tc?.name || tc?.title || tc?.id || update.title || "Executing...";
        this.callbacks.onChunk(`\n[Tool: ${toolName}]\n`);
      } else if (update.sessionUpdate === "tool_call_update") {
        console.log("[ACP] tool_call_update:", JSON.stringify(update, null, 2));
        const status = update.status === "completed" ? "Done" : update.status;
        const toolName = update.title || update.toolCall?.name || update.toolCall?.title || "Task";
        this.callbacks.onChunk(`\n[Tool: ${toolName} - ${status}]\n`);
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
        // Fallback for other potential updates
        console.log("[ACP] Other update:", JSON.stringify(update, null, 2));
        if (update.content?.type === "text" && update.content?.text) {
          this.callbacks.onChunk(update.content.text);
        } else if (update.sessionUpdate) {
          console.log(`[ACP] Received unhandled sessionUpdate: ${update.sessionUpdate}`, update);
        }
      }
    });

    // Handle incoming JSON-RPC Requests from Server (Permission Prompts)
    this.connection.onRequest("session/request_permission", async (params: any) => {
      const requestId = randomUUID();
      const tc = params.toolCall;
      const title = tc?.title || tc?.name || tc?.id || params.message || "Agent wants to perform an action";
      const options = params.options || [];

      // Gửi request xuống webview thay vì hiện popup
      console.log(`[ACP] Requesting permission: ${title} (requestId: ${requestId})`);
      this.callbacks.onChunk(`\n<permission_request>${JSON.stringify({
        requestId,
        message: title,
        options: options.map((o: any) => ({ label: o.name, value: o.optionId }))
      })}</permission_request>\n`);

      // Chờ phản hồi từ webview thông qua cơ chế event-driven hoặc await (cần cách xử lý async)
      // Hiện tại do kiến trúc ACP, anh sẽ tạm dùng một promise để chờ
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

  public async newSession(modelId?: string, mcpServers: any[] = []): Promise<string> {
    if (!this.connection) {
      await this.start();
    }
    try {
      const req = new RequestType<any, any, any>("session/new");
      const res = await this.connection!.sendRequest(req, { 
        model: modelId,
        cwd: this.cwd || process.cwd(),
        mcpServers: mcpServers
      });
      return res.sessionId;
    } catch (e) {
      console.error("Failed to create new session", e);
      return "";
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