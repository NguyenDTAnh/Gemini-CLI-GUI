import { Cpu, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

interface ModelThinkingProps {
  content: string;
}

export function ModelThinking({ content }: ModelThinkingProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  if (!content.trim()) return null;

  return (
    <div className={`thought-block ${isExpanded ? 'expanded' : ''}`}>
      <div className="thought-header" onClick={() => setIsExpanded(!isExpanded)}>
        <span className="thought-icon">
          <Cpu size={14} />
        </span>
        <span className="thought-header-text">Model Thinking...</span>
        <span className="thought-chevron">
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </div>
      <div className="thought-content-wrapper">
        <div className="thought-content">
          {content}
        </div>
      </div>
    </div>
  );
}
