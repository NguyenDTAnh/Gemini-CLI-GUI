import { Bot } from "lucide-react";

import { useEffect, useRef, useState } from "react";

interface AgentSelectorProps {
  agentId: string;
  agentOptions: string[];
  onSelect: (agentId: string) => void;
}

function getAgentMeta(id: string): { label: string; hint: string } {
  switch (id) {
    case "codebase_investigator":
      return { label: "Codebase Investigator", hint: "Phân tích codebase sâu" };
    case "cli_help":
      return { label: "CLI Help", hint: "Tra cứu Gemini CLI" };
    case "generalist":
      return { label: "Generalist", hint: "Tác vụ đa năng" };
    default:
      return { label: id, hint: "Agent tùy chỉnh" };
  }
}

export function AgentSelector({ agentId, agentOptions, onSelect }: AgentSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const resolvedOptions = [...new Set(agentOptions.map((item) => item.trim()).filter((item) => Boolean(item)))];
  const resolvedAgentId = resolvedOptions.includes(agentId) ? agentId : (resolvedOptions[0] || "");
  const currentMeta = resolvedAgentId ? getAgentMeta(resolvedAgentId) : { label: "Agent", hint: "No agent configured" };
  const disabled = resolvedOptions.length === 0;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const toggleDropdown = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) {
      return;
    }

    setIsOpen(!isOpen);
  };

  return (
    <div className="model-selector-container" ref={dropdownRef}>
      <button
        type="button"
        className={`agent-selector-trigger ${isOpen ? "active" : ""}`}
        onClick={toggleDropdown}
        title={disabled ? "No agent configured" : `Current agent: ${currentMeta.label} (Shortcut: Cmd/Ctrl+Shift+A)`}
        aria-label="Cycle and select agent"
        disabled={disabled}
      >
        <Bot size={14} stroke="url(#primary-gradient)" />
      </button>

      {isOpen && (
        <div className="model-dropdown">
          <div className="dropdown-scroll-list">
            {resolvedOptions.map((option) => {
              const meta = getAgentMeta(option);
              const selected = option === resolvedAgentId;

              return (
                <button
                  key={option}
                  type="button"
                  className={`model-item ${selected ? "selected" : ""}`}
                  onClick={() => {
                    onSelect(option);
                    setIsOpen(false);
                  }}
                >
                  <div className="model-item-info">
                    <span className="model-item-name">{meta.label}</span>
                    <span className="model-tag">{meta.hint}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
