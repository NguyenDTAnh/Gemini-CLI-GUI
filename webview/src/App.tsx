import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Composer } from "./components/Composer";
import { ChatTimeline } from "./components/ChatTimeline";
import { SessionSidebar } from "./components/SessionSidebar";
import {
  Agent,
  ChatMode,
  ChatSession,
  DroppedFilePayload,
  ExtensionToWebviewMessage,
  SlashCommandDescriptor,
  WebviewToExtensionMessage
} from "./types";
import { collectDroppedFiles, parseDroppedPathPayloads, toDroppedPayload } from "./dragDropUtils";
import { vscode } from "./vscode";

const DEFAULT_SLASH_COMMANDS = ["/explain", "/fix", "/summarize", "/tests"];
const DEFAULT_AGENT_OPTIONS: Agent[] = [
  { id: "codebase_investigator", label: "Investigator", description: "Phân tích codebase sâu" },
  { id: "cli_help", label: "CLI Helper", description: "Tra cứu Gemini CLI" },
  { id: "generalist", label: "Generalist", description: "Tác vụ đa năng" }
];
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

function getDefaultAgentMeta(id: string): Agent {
  switch (id) {
    case "codebase_investigator":
      return { id, label: "Investigator", description: "Phân tích codebase sâu" };
    case "cli_help":
      return { id, label: "CLI Helper", description: "Tra cứu Gemini CLI" };
    case "generalist":
      return { id, label: "Generalist", description: "Tác vụ đa năng" };
    default:
      return { id, label: id || "Agent", description: "Agent tùy chỉnh" };
  }
}

function normalizeAgents(value: unknown, fallback: Agent[]): Agent[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value
    .map((item) => {
      if (typeof item === "string") {
        const id = item.trim();
        return id ? getDefaultAgentMeta(id) : null;
      }

      if (!item || typeof item !== "object") {
        return null;
      }

      const candidate = item as Partial<Agent>;
      const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
      const label = typeof candidate.label === "string" ? candidate.label.trim() : "";

      if (!id || !label) {
        return null;
      }

      return {
        id,
        label,
        description: typeof candidate.description === "string" && candidate.description.trim() ? candidate.description.trim() : undefined
      } satisfies Agent;
    })
    .filter((item): item is Agent => Boolean(item));

  return normalized.length > 0 ? normalized : fallback;
}

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
  const persistedState = vscode.getState<{ activeSessionId?: string }>();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>(persistedState?.activeSessionId || "");
  const [running, setRunning] = useState(false);
  const [banner, setBanner] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [availableAgents, setAvailableAgents] = useState<Agent[]>(DEFAULT_AGENT_OPTIONS);
  const [availableModels, setAvailableModels] = useState<string[]>(DEFAULT_MODEL_OPTIONS);
  const [slashCommands, setSlashCommands] = useState<string[]>(DEFAULT_SLASH_COMMANDS);
  const [commandDescriptors, setCommandDescriptors] = useState<SlashCommandDescriptor[]>([]);
  const [mentionSearchResults, setMentionSearchResults] = useState<string[]>([]);
  const mentionSearchQueryRef = useRef("");
  const [composerPrefill, setComposerPrefill] = useState<{
    nonce: number;
    text: string;
    append: boolean;
    contextChip?: { display: string; content: string; languageId: string };
    contextChips?: Array<{ display: string; content?: string; languageId?: string; type: 'mention' | 'snippet'; id?: string }>;
  } | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || sessions[0],
    [sessions, activeSessionId]
  );

  const [globalDragging, setGlobalDragging] = useState(false);
  const dragCounter = useRef(0);

  useEffect(() => {
    // Add global native event listeners to aggressively prevent VS Code's default behavior
    // which normally intercepts file drops from the Explorer to open them in an editor tab.
    const preventDefault = (e: DragEvent) => {
      e.preventDefault();
      if (e.type === 'dragover' && e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    window.addEventListener('dragover', preventDefault, false);
    window.addEventListener('drop', preventDefault, false);

    return () => {
      window.removeEventListener('dragover', preventDefault, false);
      window.removeEventListener('drop', preventDefault, false);
    };
  }, []);

  const handleGlobalDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setGlobalDragging(true);
    }
  };

  const handleGlobalDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setGlobalDragging(false);
    }
  };

  const handleGlobalDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleGlobalDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setGlobalDragging(false);
    dragCounter.current = 0;

    if (!activeSession?.id) return;

    const files = await collectDroppedFiles(e.dataTransfer);
    const filePayloads = files.length > 0
      ? await Promise.all(files.map((file) => toDroppedPayload(file)))
      : [];
    
    // Parse extra metadata/paths from dataTransfer, but filter out what we already got from files
    const uriPayloads = parseDroppedPathPayloads(e.dataTransfer);
    
    for (const fp of filePayloads) {
      if (!fp.fsPath) {
        const matchingUri = uriPayloads.find(up => up.name === fp.name);
        if (matchingUri) {
          fp.fsPath = matchingUri.fsPath;
          fp.uri = matchingUri.uri;
        }
      }
    }
    
    // Build a set of paths we already have from binary file analysis
    const existingPaths = new Set(filePayloads.map(p => p.fsPath).filter(Boolean));
    const existingNames = new Set(filePayloads.map(p => p.name).filter(Boolean));
    const filteredUriPayloads = uriPayloads.filter(p => !existingPaths.has(p.fsPath) && !existingNames.has(p.name));

    const payloads = [...filePayloads, ...filteredUriPayloads];

    if (payloads.length === 0) return;

    const dedupedPayloads: DroppedFilePayload[] = [];
    const seenPaths = new Set<string>();

    for (const p of payloads) {
      const key = p.fsPath || p.uri || p.name;
      if (!seenPaths.has(key)) {
        seenPaths.add(key);
        dedupedPayloads.push(p);
      }
    }

    postMessage({
      type: "attachFiles",
      sessionId: activeSession.id,
      files: dedupedPayloads
    });

    // Also insert them as "pretty" chips into the composer
    setComposerPrefill((prev) => ({
      nonce: (prev?.nonce ?? 0) + 1,
      text: "",
      append: true,
      contextChips: dedupedPayloads.map(p => ({
        display: p.name,
        type: 'mention',
        id: p.fsPath || p.uri || p.name
      }))
    }));
  };

  const mentionCandidates = useMemo(() => {
    /* Soft deleted: exclude attached files from mention suggestions
    const attached = (activeSession?.attachments || []).map((attachment) => ({
      name: attachment.name,
      fsPath: attachment.fsPath
    }));
    */
    const searched = mentionSearchResults.map((path) => ({
      name: path.split("/").pop() || path,
      fsPath: path
    }));

    // const all = [...searched, ...attached];
    const all = searched;
    const unique = new Map<string, { name: string; fsPath: string }>();
    for (const item of all) {
      if (!unique.has(item.fsPath)) {
        unique.set(item.fsPath, item);
      }
    }

    return Array.from(unique.values());
  }, [mentionSearchResults]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;

      switch (message.type) {
        case "bootstrapped": {
          setSessions(message.payload.sessions);
          setActiveSessionId(message.payload.activeSessionId);
          setAvailableAgents(normalizeAgents(message.payload.availableAgents, DEFAULT_AGENT_OPTIONS));
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
          if (message.activeSessionId) {
            setActiveSessionId(message.activeSessionId);
          }
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
          setActiveSessionId(message.sessionId);
          setComposerPrefill((prev) => ({
            nonce: (prev?.nonce ?? 0) + 1,
            text: message.text || "",
            append: message.append ?? true,
            contextChip: message.contextChip
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

  const cycleAgent = useCallback(() => {
    if (!activeSession?.id || availableAgents.length === 0) {
      return;
    }

    const currentAgentId = (activeSession.defaultAgentId || "").trim();
    const currentIndex = availableAgents.findIndex((item) => item.id === currentAgentId);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % availableAgents.length;
    const nextAgentId = availableAgents[nextIndex].id;

    postMessage({
      type: "setAgent",
      sessionId: activeSession.id,
      agentId: nextAgentId
    });
  }, [activeSession, availableAgents]);

  const cycleModel = useCallback(() => {
    const models = availableModels.filter((m) => m !== "manual");
    if (!activeSession?.id || models.length === 0) {
      return;
    }

    const currentModelId = (activeSession.defaultModelId || "auto").trim();
    const currentIndex = models.findIndex((m) => m === currentModelId);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % models.length;
    const nextModelId = models[nextIndex];

    postMessage({
      type: "setModel",
      sessionId: activeSession.id,
      modelId: nextModelId
    });
  }, [activeSession, availableModels]);

  useEffect(() => {
    const handleCycleAgentShortcut = (event: KeyboardEvent) => {
      const triggerCycle = (event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "KeyA";
      if (!triggerCycle) {
        return;
      }

      event.preventDefault();
      cycleAgent();
    };

    window.addEventListener("keydown", handleCycleAgentShortcut);
    return () => window.removeEventListener("keydown", handleCycleAgentShortcut);
  }, [cycleAgent]);

  useEffect(() => {
    const handleCycleModelShortcut = (event: KeyboardEvent) => {
      const triggerCycle = (event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "Period";
      if (!triggerCycle) {
        return;
      }

      event.preventDefault();
      cycleModel();
    };

    window.addEventListener("keydown", handleCycleModelShortcut);
    return () => window.removeEventListener("keydown", handleCycleModelShortcut);
  }, [cycleModel]);

  useEffect(() => {
    const handleToggleModeShortcut = (event: KeyboardEvent) => {
      if (!event.shiftKey || event.key !== "Tab" || event.metaKey || event.ctrlKey || !activeSession?.id) {
        return;
      }

      event.preventDefault();
      const nextMode = (activeSession.activeMode || "edit") === "plan" ? "edit" : "plan";
      postMessage({ type: "toggleMode", sessionId: activeSession.id, mode: nextMode });
    };

    window.addEventListener("keydown", handleToggleModeShortcut);
    return () => window.removeEventListener("keydown", handleToggleModeShortcut);
  }, [activeSession]);

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
    el.style.setProperty("--orb-opacity", "0.15");
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const rect = el.querySelector(".chat-panel")?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const dx = x - rect.width / 2;
    const dy = y - rect.height / 2;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const moveDistance = 500;

    el.style.setProperty("--mouse-x", `${x + (dx / distance) * moveDistance}px`);
    el.style.setProperty("--mouse-y", `${y + (dy / distance) * moveDistance}px`);
    el.style.setProperty("--orb-opacity", "0");
  };
  return (
    <div 
      className={`app-shell ${globalDragging ? "dragging" : ""}`} 
      onMouseMove={handleMouseMove} 
      onMouseLeave={handleMouseLeave}
      onDragEnter={handleGlobalDragEnter}
      onDragLeave={handleGlobalDragLeave}
      onDragOver={handleGlobalDragOver}
      onDrop={handleGlobalDrop}
    >
      {globalDragging && (
        <div className="global-drop-overlay">
          <div className="drop-overlay-content">
            <Sparkles size={48} stroke="url(#primary-gradient)" />
            <div className="drop-overlay-text">Drop anywhere to attach context</div>
          </div>
        </div>
      )}
      <svg style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
        <defs>
          <linearGradient id="primary-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#a8c7fa" />
            <stop offset="50%" stopColor="#c58af9" />
            <stop offset="100%" stopColor="#8ab4f8" />
          </linearGradient>
          <linearGradient id="gemini-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#a8c7fa" />
            <stop offset="50%" stopColor="#c58af9" />
            <stop offset="100%" stopColor="#8ab4f8" />
          </linearGradient>
        </defs>
      </svg>      <SessionSidebar
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
        
        {banner && banner.kind === "error" && <div className={`banner ${banner.kind}`}>{banner.text}</div>}

        <ChatTimeline messages={activeSession?.messages || []} onRetry={retryLast} />

        <Composer
          sessionId={activeSession?.id}
          running={running}
          mode={(activeSession?.activeMode || "edit") as ChatMode}
          modelId={activeSession?.defaultModelId || "auto"}
          modelLabel={activeSession?.defaultModelId || "Auto: Gemini CLI default"}
          modelOptions={availableModels}
          agentId={activeSession?.defaultAgentId || ""}
          agentOptions={availableAgents}
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
          onSetAgent={(agentId) =>
            activeSession?.id &&
            postMessage({
              type: "setAgent",
              sessionId: activeSession.id,
              agentId
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
