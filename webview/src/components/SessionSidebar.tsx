import { PlusCircle } from "lucide-react";
import { ChatSession } from "../types";

interface SessionSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  onCreate: () => void;
  onSelect: (sessionId: string) => void;
}

export function SessionSidebar({ sessions, activeSessionId, onCreate, onSelect }: SessionSidebarProps) {
  return (
    <aside className="session-sidebar">
      <div className="sidebar-head">
        <h2>Sessions</h2>
        <button className="ghost-btn" onClick={onCreate} title="New session">
          <PlusCircle size={20} />
        </button>
      </div>

      <div className="session-list">
        {sessions.map((session) => {
          const selected = session.id === activeSessionId;
          return (
            <button
              key={session.id}
              className={`session-item ${selected ? "selected" : ""}`}
              onClick={() => onSelect(session.id)}
              title={session.title}
            >
              <span className="session-title">{session.title || "Untitled"}</span>
              <span className="session-meta">{new Date(session.updatedAt).toLocaleTimeString()}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
