import { ChevronDown } from "lucide-react";

import { useState, useRef, useEffect } from "react";

interface ModelSelectorProps {
  modelId: string;
  modelOptions: string[];
  onSelect: (modelId: string) => void;
}

export function ModelSelector({ modelId, modelOptions, onSelect }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const getModelLabel = (id: string) => {
    if (id === "auto") return "Auto (Default)";
    if (id === "gemini-3.1-pro-preview") return "Gemini 3.1 Pro";
    if (id === "gemini-3-flash-preview") return "Gemini 3 Flash";
    if (id === "gemini-3.1-flash-lite-preview") return "Gemini 3.1 Flash Lite";
    if (id === "gemini-2.5-pro") return "Gemini 2.5 Pro";
    if (id === "gemini-2.5-flash") return "Gemini 2.5 Flash";
    if (id === "gemini-2.5-flash-lite") return "Gemini 2.5 Flash Lite";
    if (id === "manual") return "Manual Model ID...";
    
    return id;
  };

  const currentLabel = modelId === "manual" ? "Select Model ID" : getModelLabel(modelId);

  const toggleDropdown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  return (
    <div className="model-selector-container" ref={dropdownRef}>
      <button 
        type="button"
        className={`model-selector-trigger ${isOpen ? 'active' : ''}`}
        onClick={toggleDropdown}
        title={`Current model: ${getModelLabel(modelId)}`}
      >
        <span className="current-model-name">{currentLabel}</span>
        <ChevronDown size={14} className={`chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="model-dropdown">
          <div className="dropdown-scroll-list">
            {modelOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={`model-item ${option === modelId ? "selected" : ""}`}
                onClick={() => {
                  onSelect(option);
                  setIsOpen(false);
                }}
              >
                <div className="model-item-info">
                  <span className="model-item-name">
                    {option === "manual" ? "Enter Model ID manually..." : getModelLabel(option)}
                  </span>
                  {option === "auto" && <span className="model-tag">Recommended</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
