import { ChevronDown } from "lucide-react";

interface ModelSelectorProps {
  modelId: string;
  modelOptions: string[];
  onSelect: (modelId: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function ModelSelector({ modelId, modelOptions, onSelect, isOpen, onToggle }: ModelSelectorProps) {
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

  return (
    <div className="model-selector-container">
      <button 
        type="button"
        className={`model-selector-trigger ${isOpen ? 'active' : ''}`}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        title={`Current model: ${getModelLabel(modelId)}`}
      >
        <span className="current-model-name">{currentLabel}</span>
        <ChevronDown size={14} className={`chevron ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="model-dropdown">
          <div className="dropdown-scroll-list">
            {modelOptions.filter((option) => option !== "manual").map((option) => (
              <button
                key={option}
                type="button"
                className={`model-item ${option === modelId ? "selected" : ""}`}
                onClick={() => {
                  onSelect(option);
                  onToggle();
                }}
              >
                <div className="model-item-info">
                  <span className="model-item-name">
                    {getModelLabel(option)}
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
