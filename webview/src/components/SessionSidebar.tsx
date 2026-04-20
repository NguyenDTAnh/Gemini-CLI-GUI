import { Plus, ChevronDown, Trash2, Bug } from "lucide-react";
import { GeminiLogo } from "./GeminiLogo";
import { useState, useRef, useEffect } from "react";
import { ChatSession } from "../types";

interface SessionSidebarProps {
  sessions: ChatSession[];
  activeSessionId: string;
  debugMode: boolean;
  onCreate: () => void;
  onSelect: (sessionId: string) => void;
  onClear: () => void;
  onToggleDebug: () => void;
}

export function SessionSidebar({
  sessions,
  activeSessionId,
  debugMode,
  onCreate,
  onSelect,
  onClear,
  onToggleDebug
}: SessionSidebarProps) {
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
        <GeminiLogo size={16} />
        <span className="current-session-title">
          {activeSession?.title || "New Session"}
        </span>
        <ChevronDown size={14} className={`chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="session-dropdown">
          <div className="dropdown-header">
            <span>Recent Sessions</span>
            <div className="dropdown-actions">
              <button className="new-session-mini-btn" onClick={() => { onCreate(); setIsOpen(false); }} title="New session">
                <Plus size={14} />
              </button>
              <button
                className={`debug-session-mini-btn ${debugMode ? "active" : ""}`}
                onClick={onToggleDebug}
                title={debugMode ? "Disable debug mode" : "Enable debug mode"}
              >
                <Bug size={14} />
              </button>
              <button className="clear-session-mini-btn" onClick={() => { onClear(); setIsOpen(false); }} title="Clear all sessions">
                <Trash2 size={14} />
              </button>
            </div>
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
