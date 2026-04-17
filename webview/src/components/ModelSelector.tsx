import { ChevronDown, Cpu, Sparkles } from "lucide-react";
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
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getModelLabel = (id: string) => {
    if (id === "auto") return "Auto (Default)";
    if (id === "manual") return "Manual Model ID...";
    // Clean up IDs for display (e.g. gemini-2.0-flash -> Gemini 2.0 Flash)
    return id.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  return (
    <div className="model-selector-container" ref={dropdownRef}>
      <button 
        type="button"
        className={`model-selector-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title={`Current model: ${getModelLabel(modelId)}`}
      >
        <Sparkles size={14} className="model-icon" />
        <span className="current-model-name">{getModelLabel(modelId)}</span>
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
                  <span className="model-item-name">{getModelLabel(option)}</span>
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
