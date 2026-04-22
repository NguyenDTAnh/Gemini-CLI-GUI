import { useEffect, useRef, useState } from "react";
import { Agent } from "../types";

interface AgentSelectorProps {
  agentId: string;
  agentOptions: Agent[];
  onSelect: (agentId: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function AgentSelector({ agentId, agentOptions, onSelect, isOpen, onToggle }: AgentSelectorProps) {
  const resolvedAgent = agentOptions.find((a) => a.id === agentId) || agentOptions[0];
  const disabled = agentOptions.length === 0;

  return (
    <div className="model-selector-container">
      <button
        type="button"
        className={`agent-selector-trigger ${isOpen ? "active" : ""}`}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        title={disabled ? "No agent configured" : `Current agent: ${resolvedAgent?.label} (Shortcut: Cmd/Ctrl+Shift+A)`}
        aria-label="Cycle and select agent"
        disabled={disabled}
      >
        <span className="agent-trigger-label">{resolvedAgent?.label || "Select Agent"}</span>
      </button>

      {isOpen && (
        <div className="agent-dropdown">
          <div className="dropdown-scroll-list">
            {agentOptions.map((option) => {
              const selected = option.id === resolvedAgent?.id;

              return (
                <button
                  key={option.id}
                  type="button"
                  className={`model-item ${selected ? "selected" : ""}`}
                  title={option.description ? `${option.label}: ${option.description}` : option.label}
                  onClick={() => {
                    onSelect(option.id);
                    onToggle();
                  }}
                >
                  <div className="model-item-info">
                    <span className="model-item-name">{option.label}</span>
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
