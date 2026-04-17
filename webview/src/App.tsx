import { useEffect, useMemo, useState } from "react";
import { Composer } from "./components/Composer";
import { ChatTimeline } from "./components/ChatTimeline";
import { SessionSidebar } from "./components/SessionSidebar";
import { ChatSession, ExtensionToWebviewMessage, WebviewToExtensionMessage } from "./types";
import { vscode } from "./vscode";

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

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || sessions[0],
    [sessions, activeSessionId]
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionToWebviewMessage>) => {
      const message = event.data;

      switch (message.type) {
        case "bootstrapped": {
          setSessions(message.payload.sessions);
          setActiveSessionId(message.payload.activeSessionId);
          return;
        }
        case "sessionsCleared": {
          setSessions(message.payload.sessions);
          setActiveSessionId(message.payload.activeSessionId);
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

  return (
    <div className="app-shell">
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSession?.id || ""}
        onCreate={() => postMessage({ type: "createSession" })}
        onSelect={(sessionId) => {
          setActiveSessionId(sessionId);
          postMessage({ type: "switchSession", sessionId });
        }}
      />

      <section className="chat-panel">
        {banner && <div className={`banner ${banner.kind}`}>{banner.text}</div>}

        <div className="attachment-strip">
          {(activeSession?.attachments || []).map((attachment) => (
            <span key={attachment.id} className="attachment-chip">
              {attachment.name}
              <button
                className="chip-remove"
                onClick={() =>
                  postMessage({
                    type: "removeAttachment",
                    sessionId: activeSession.id,
                    attachmentId: attachment.id
                  })
                }
              >
                x
              </button>
            </span>
          ))}
        </div>

        <ChatTimeline messages={activeSession?.messages || []} onRetry={retryLast} />

        <Composer
          running={running}
          onSubmit={sendPrompt}
          onStop={() => postMessage({ type: "stopGeneration" })}
          onAttach={() => postMessage({ type: "attachFile" })}
        />
      </section>
    </div>
  );
}
