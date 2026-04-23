import * as cp from "node:child_process";
import * as readline from "node:readline";
import * as vscode from "vscode";
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

      if (update.sessionUpdate === "agent_message_chunk") {
        if (update.content?.type === "text" && update.content?.text) {
          this.callbacks.onChunk(update.content.text);
        }
      } else if (update.sessionUpdate === "tool_call") {
        const toolName = update.toolCall?.name || "unknown tool";
        this.callbacks.onChunk(`\n> Agent đang sử dụng tool: ${toolName}\n`);
      }
    });

    // Handle incoming JSON-RPC Requests from Server (Permission Prompts)
    this.connection.onRequest("session/request_permission", async (params: any) => {
      const title = params.toolCall?.title || "Agent wants to perform an action";
      const options = params.options || [];
      const optionNames = options.map((o: any) => o.name);
      
      const selection = await vscode.window.showInformationMessage(
        `Gemini CLI: ${title}`,
        { modal: true },
        ...optionNames
      );
      
      const selectedOption = options.find((o: any) => o.name === selection);
      if (selectedOption) {
        return { outcome: { outcome: "selected", optionId: selectedOption.optionId } };
      }
      
      return { outcome: { outcome: "cancelled" } };
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

  public async newSession(modelId?: string): Promise<string> {
    if (!this.connection) {
      await this.start();
    }
    try {
      const req = new RequestType<any, any, any>("session/new");
      const res = await this.connection!.sendRequest(req, { 
        model: modelId,
        cwd: this.cwd || process.cwd(),
        mcpServers: []
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