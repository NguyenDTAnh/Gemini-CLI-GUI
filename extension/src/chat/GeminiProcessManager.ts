import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";

interface RunRequestOptions {
  requestId: string;
  cliPath: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  agentCommand?: string;
  prompt: string;
  responseLanguage: string;
  contextText: string;
  onChunk: (chunk: string) => void;
  onDone: () => void;
  onCancelled: () => void;
  onError: (message: string) => void;
}

interface ActiveRequest {
  process: ChildProcessWithoutNullStreams;
  cancelled: boolean;
  done: boolean;
  stderr: string;
  timer?: NodeJS.Timeout;
  onDone: () => void;
  onCancelled: () => void;
  onError: (message: string) => void;
}

export class GeminiProcessManager {
  private readonly requests = new Map<string, ActiveRequest>();

  runRequest(options: RunRequestOptions): void {
    if (this.requests.has(options.requestId)) {
      options.onError("Request id already exists.");
      return;
    }

    const envelope = this.buildEnvelope(options.prompt, options.contextText, options.responseLanguage, options.agentCommand);
    const useArgPrompt = options.args.some((arg) => arg.includes("{{prompt}}"));
    const resolvedArgs = useArgPrompt
      ? options.args.map((arg) => arg.replaceAll("{{prompt}}", envelope))
      : options.args;

    let process: ChildProcessWithoutNullStreams;
    try {
      process = spawn(options.cliPath, resolvedArgs, { 
        stdio: "pipe",
        cwd: options.cwd
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.onError(`Cannot start Gemini CLI: ${message}`);
      return;
    }

    const active: ActiveRequest = {
      process,
      cancelled: false,
      done: false,
      stderr: "",
      onDone: options.onDone,
      onCancelled: options.onCancelled,
      onError: options.onError
    };

    this.requests.set(options.requestId, active);

    process.stdout.setEncoding("utf8");
    process.stderr.setEncoding("utf8");

    const resetTimer = () => {
      if (active.timer) {
        clearTimeout(active.timer);
      }
      active.timer = setTimeout(() => {
        const timedOut = this.stopRequest(options.requestId, "SIGTERM");
        if (timedOut) {
          this.finalizeError(options.requestId, "Gemini CLI request timed out.");
        }
      }, options.timeoutMs);
    };

    resetTimer();

    let stdoutBuffer = "";

    process.stdout.on("data", (chunk: string) => {
      if (active.done || active.cancelled) {
        return;
      }
      resetTimer();
      
      stdoutBuffer += chunk;
      
      let newlineIndex;
      while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        
        if (!line) continue;
        
        try {
          const event = JSON.parse(line);
          if (event.type === "message" && event.role === "assistant") {
            if (event.delta && event.content) {
              options.onChunk(event.content);
            } else if (!event.delta && event.content) {
              options.onChunk(event.content);
            }
          } else if (event.type === "tool_use") {
            options.onChunk(`\n> call: ${event.tool_name}\n`);
          } else if (event.type === "tool_result") {
            // Optional: emit something or let it be
          }
        } catch(e) {
          // Fallback if not stream-json
          options.onChunk(line + '\n');
        }
      }
    });

    process.stderr.on("data", (chunk: string) => {
      resetTimer();
      active.stderr += chunk;
    });

    process.on("error", (error: Error) => {
      this.finalizeError(options.requestId, `Gemini CLI error: ${error.message}`);
    });

    process.on("close", (code, signal) => {
      if (stdoutBuffer.trim() && !active.done && !active.cancelled) {
        try {
          const event = JSON.parse(stdoutBuffer.trim());
          if (event.type === "message" && event.role === "assistant" && event.content) {
            options.onChunk(event.content);
          }
        } catch {
          options.onChunk(stdoutBuffer);
        }
      }

      if (active.done) {
        return;
      }

      if (active.cancelled) {
        this.finalizeCancelled(options.requestId);
        return;
      }

      if (code === 0) {
        this.finalizeDone(options.requestId);
        return;
      }

      const stderr = active.stderr.trim();
      const reason = stderr || `Gemini CLI exited with code ${code ?? "unknown"}, signal ${signal ?? "none"}.`;
      this.finalizeError(options.requestId, reason);
    });

    if (!useArgPrompt) {
      process.stdin.write(envelope);
    }

    process.stdin.end();
  }

  stopRequest(requestId: string, signal: NodeJS.Signals = "SIGKILL"): boolean {
    console.log(`GeminiProcessManager: stopRequest called for ${requestId} with signal ${signal}`);
    const active = this.requests.get(requestId);
    if (!active || active.done) {
      console.log(`GeminiProcessManager: stopRequest - request ${requestId} not found or already done`);
      return false;
    }

    active.cancelled = true;
    try {
      if (active.process.pid) {
        console.log(`GeminiProcessManager: killing process group for ${requestId} (pid: ${active.process.pid})`);
        if (process.platform === "win32") {
          active.process.kill(signal);
        } else {
          // Kill toàn bộ process group (pid âm) trên POSIX
          try {
            process.kill(-active.process.pid, signal);
          } catch (e) {
            // Fallback nếu không kill được group
            active.process.kill(signal);
          }
        }
      } else {
        active.process.kill(signal);
      }
    } catch (e) {
      console.error(`GeminiProcessManager: error killing process for ${requestId}`, e);
      return false;
    }

    return true;
  }

  stopAll(): void {
    for (const requestId of this.requests.keys()) {
      this.stopRequest(requestId);
    }
  }

  private finalizeDone(requestId: string): void {
    const active = this.requests.get(requestId);
    if (!active) {
      return;
    }

    active.done = true;
    this.cleanup(requestId);
    active.onDone();
  }

  private finalizeCancelled(requestId: string): void {
    const active = this.requests.get(requestId);
    if (!active) {
      return;
    }

    active.done = true;
    this.cleanup(requestId);
    active.onCancelled();
  }

  private finalizeError(requestId: string, message: string): void {
    const active = this.requests.get(requestId);
    if (!active) {
      return;
    }

    active.done = true;
    this.cleanup(requestId);
    active.onError(message);
  }

  private cleanup(requestId: string): void {
    const active = this.requests.get(requestId);
    if (!active) {
      return;
    }

    if (active.timer) {
      clearTimeout(active.timer);
    }

    this.requests.delete(requestId);
  }

  private buildEnvelope(prompt: string, contextText: string, responseLanguage: string, agentCommand?: string): string {
    const sections = [
      ...(agentCommand ? [agentCommand] : []),
      "You are Gemini CLI running inside VS Code extension.",
      `Respond in language: ${responseLanguage}.`,
      "If context files are provided, use them as primary source.",
      ""
    ];

    if (contextText.trim()) {
      sections.push("Attached context:");
      sections.push(contextText);
      sections.push("");
    }

    sections.push("User prompt:");
    sections.push(prompt);

    return `${sections.join("\n")}\n`;
  }
}
