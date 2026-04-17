import { Plus, ChevronDown, MessageSquare } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { ChatSession } from "../types";

interface SessionSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  onCreate: () => void;
  onSelect: (sessionId: string) => void;
}

export function SessionSidebar({ sessions, activeSessionId, onCreate, onSelect }: SessionSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="session-selector" ref={dropdownRef}>
      <button className="current-session-btn" onClick={() => setIsOpen(!isOpen)}>
        <MessageSquare size={14} className="session-icon" />
        <span className="current-session-title">
          {activeSession?.title || "New Session"}
        </span>
        <ChevronDown size={14} className={`chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="session-dropdown">
          <div className="dropdown-header">
            <span>Recent Sessions</span>
            <button className="new-session-mini-btn" onClick={() => { onCreate(); setIsOpen(false); }}>
              <Plus size={14} />
            </button>
          </div>
          <div className="session-scroll-list">
            {sessions.map((session) => {
              const isSelected = session.id === activeSessionId;
              return (
                <button
                  key={session.id}
                  className={`dropdown-item ${isSelected ? "selected" : ""}`}
                  onClick={() => { onSelect(session.id); setIsOpen(false); }}
                >
                  <span className="item-title">{session.title || "Untitled"}</span>
                  <span className="item-meta">{new Date(session.updatedAt).toLocaleTimeString()}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
