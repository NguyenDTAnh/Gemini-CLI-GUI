import { useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { ChatTimeline } from "./components/ChatTimeline";
import { SessionSidebar } from "./components/SessionSidebar";
import {
  ChatMode,
  ChatSession,
  ExtensionToWebviewMessage,
  SlashCommandDescriptor,
  WebviewToExtensionMessage
} from "./types";
import { vscode } from "./vscode";

const DEFAULT_SLASH_COMMANDS = ["/explain", "/fix", "/summarize", "/tests"];
const DEFAULT_MODEL_OPTIONS = [
  "auto",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "manual"
];

function upsertSession(sessions: ChatSession[], nextSession: ChatSession): ChatSession[] {
  const existingIndex = sessions.findIndex((item) => item.id === nextSession.id);
  if (existingIndex === -1) {
    return [nextSession, ...sessions];
  }

  const clone = [...sessions];
  clone[existingIndex] = nextSession;
  return clone.sort((a, b) => b.updatedAt - a.updatedAt);
}

function postMessage(message: WebviewToExtensionMessage): void {
  vscode.postMessage(message);
}

export default function App() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [banner, setBanner] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>(DEFAULT_MODEL_OPTIONS);
  const [slashCommands, setSlashCommands] = useState<string[]>(DEFAULT_SLASH_COMMANDS);
  const [commandDescriptors, setCommandDescriptors] = useState<SlashCommandDescriptor[]>([]);
  const [mentionSearchResults, setMentionSearchResults] = useState<string[]>([]);
  const mentionSearchQueryRef = useRef("");
  const [composerPrefill, setComposerPrefill] = useState<{
    nonce: number;
    text: string;
    append: boolean;
  } | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || sessions[0],
    [sessions, activeSessionId]
  );

  const mentionCandidates = useMemo(() => {
    const attached = (activeSession?.attachments || []).map((attachment) => ({
      name: attachment.name,
      fsPath: attachment.fsPath
    }));
    const searched = mentionSearchResults.map((path) => ({
      name: path.split("/").pop() || path,
      fsPath: path
    }));

    const all = [...searched, ...attached];
    const unique = new Map<string, { name: string; fsPath: string }>();
    for (const item of all) {
      if (!unique.has(item.fsPath)) {
        unique.set(item.fsPath, item);
      }
    }

    return Array.from(unique.values());
  }, [activeSession?.attachments, mentionSearchResults]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;

      switch (message.type) {
        case "bootstrapped": {
          setSessions(message.payload.sessions);
          setActiveSessionId(message.payload.activeSessionId);
          setAvailableModels(message.payload.availableModels?.length ? message.payload.availableModels : DEFAULT_MODEL_OPTIONS);
          setSlashCommands(message.payload.supportedCommands?.length ? message.payload.supportedCommands : DEFAULT_SLASH_COMMANDS);
          setCommandDescriptors(message.payload.commandDescriptors || []);
          setMentionSearchResults([]);
          return;
        }
        case "sessionsCleared": {
          setSessions(message.payload.sessions);
          setActiveSessionId(message.payload.activeSessionId);
          setMentionSearchResults([]);
          setRunning(false);
          return;
        }
        case "sessionUpdated": {
          setSessions((prev) => upsertSession(prev, message.session));
          return;
        }
        case "assistantStream": {
          setSessions((prev) =>
            prev.map((session) => {
              if (session.id !== message.sessionId) {
                return session;
              }

              return {
                ...session,
                messages: session.messages.map((item) => {
                  if (item.role === "assistant" && item.requestId === message.requestId) {
                    return {
                      ...item,
                      status: "streaming",
                      content: item.content + message.chunk
                    };
                  }

                  return item;
                }),
                updatedAt: Date.now()
              };
            })
          );
          return;
        }
        case "generationState": {
          setRunning(message.running);
          return;
        }
        case "modelUpdated": {
          setSessions((prev) =>
            prev.map((session) =>
              session.id === message.sessionId
                ? {
                    ...session,
                    defaultModelId: message.modelId || undefined,
                    updatedAt: Date.now()
                  }
                : session
            )
          );
          return;
        }
        case "modeUpdated": {
          setSessions((prev) =>
            prev.map((session) =>
              session.id === message.sessionId
                ? {
                    ...session,
                    activeMode: message.mode,
                    updatedAt: Date.now()
                  }
                : session
            )
          );
          return;
        }
        case "composerPrefill": {
          const text = message.text.trim();
          if (!text) {
            return;
          }

          setActiveSessionId(message.sessionId);
          setComposerPrefill((prev) => ({
            nonce: (prev?.nonce ?? 0) + 1,
            text,
            append: message.append ?? true
          }));
          return;
        }
        case "fileSearchResults": {
          if (message.query !== mentionSearchQueryRef.current) {
            return;
          }

          setMentionSearchResults(message.suggestions || []);
          return;
        }
        case "info": {
          setBanner({ kind: "info", text: message.message });
          return;
        }
        case "error": {
          setBanner({ kind: "error", text: message.message });
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener("message", onMessage);
    postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, []);

  useEffect(() => {
    vscode.setState({
      activeSessionId,
      sessionCount: sessions.length
    });
  }, [activeSessionId, sessions.length]);

  useEffect(() => {
    // Use a timeout to avoid synchronous setState warning and cascading renders
    const timer = setTimeout(() => {
      setMentionSearchResults([]);
    }, 0);
    return () => clearTimeout(timer);
  }, [activeSession?.id]);

  const sendPrompt = (prompt: string) => {
    if (!activeSession?.id) {
      return;
    }

    postMessage({
      type: "sendPrompt",
      sessionId: activeSession.id,
      prompt
    });
  };

  const retryLast = () => {
    if (!activeSession?.id) {
      return;
    }

    postMessage({
      type: "retryLast",
      sessionId: activeSession.id
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const rect = el.querySelector(".chat-panel")?.getBoundingClientRect();
    if (!rect) return;
    
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    el.style.setProperty("--mouse-x", `${x}px`);
    el.style.setProperty("--mouse-y", `${y}px`);
    el.style.setProperty("--orb-opacity", "0.65");
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const rect = el.querySelector(".chat-panel")?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    el.style.setProperty("--mouse-x", `${x + (x > rect.width / 2 ? 100 : -100)}px`);
    el.style.setProperty("--mouse-y", `${y + (y > rect.height / 2 ? 100 : -100)}px`);
    el.style.setProperty("--orb-opacity", "0");
  };

  return (
    <div className="app-shell" onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSession?.id || ""}
        onCreate={() => postMessage({ type: "createSession" })}
        onClear={() => postMessage({ type: "clearSessions" })}
        onSelect={(sessionId) => {
          setActiveSessionId(sessionId);
          postMessage({ type: "switchSession", sessionId });
        }}
      />

      <section className="chat-panel">
        <div className="chat-panel-bg" />
        <div className="gemini-orb" />
        
        {banner && <div className={`banner ${banner.kind}`}>{banner.text}</div>}

        <ChatTimeline messages={activeSession?.messages || []} onRetry={retryLast} />

        <Composer
          sessionId={activeSession?.id}
          running={running}
          mode={(activeSession?.activeMode || "plan") as ChatMode}
          modelId={activeSession?.defaultModelId || "auto"}
          modelLabel={activeSession?.defaultModelId || "Auto: Gemini CLI default"}
          modelOptions={availableModels}
          slashCommands={slashCommands}
          commandDescriptors={commandDescriptors}
          mentionCandidates={mentionCandidates}
          onSearchFiles={(query) => {
            const normalized = query.trim().toLowerCase();
            mentionSearchQueryRef.current = normalized;

            if (normalized.length < 2) {
              setMentionSearchResults([]);
              return;
            }

            postMessage({ type: "searchFiles", query: normalized });
          }}
          attachments={activeSession?.attachments || []}
          onSubmit={sendPrompt}
          onStop={() => postMessage({ type: "stopGeneration" })}
          onAttach={() => postMessage({ type: "attachFile" })}
          onSetMode={(mode) =>
            activeSession?.id &&
            postMessage({
              type: "toggleMode",
              sessionId: activeSession.id,
              mode
            })
          }
          onSetModel={(modelId) =>
            activeSession?.id &&
            postMessage({
              type: "setModel",
              sessionId: activeSession.id,
              modelId
            })
          }
          onAttachFiles={(files) =>
            activeSession?.id &&
            postMessage({
              type: "attachFiles",
              sessionId: activeSession.id,
              files
            })
          }
          onRemoveAttachment={(attachmentId) =>
            activeSession?.id &&
            postMessage({
              type: "removeAttachment",
              sessionId: activeSession.id,
              attachmentId
            })
          }
          prefill={composerPrefill}
        />
      </section>
    </div>
  );
}
