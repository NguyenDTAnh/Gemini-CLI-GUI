import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkEmoji from "remark-emoji";

interface ModelThinkingProps {
  content: string;
  isStreaming?: boolean;
}

export function ModelThinking({ content, isStreaming }: ModelThinkingProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  
  if (!content.trim()) return null;

  return (
    <div className={`thought-block ${isExpanded ? 'expanded' : ''}`}>
      <div className="thought-header" onClick={() => setIsExpanded(!isExpanded)}>
        <span className="thought-icon">
          <span className="bullet">●</span>
        </span>
        <span className="thought-header-text shiny-text">
          {isStreaming ? "Gemini is processing..." : "Thought process"}
        </span>
      </div>
      <div className="thought-content-wrapper">
        <div className="thought-content">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkEmoji]}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
