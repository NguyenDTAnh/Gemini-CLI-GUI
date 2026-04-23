import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkEmoji from "remark-emoji";

interface ModelThinkingProps {
  content: string;
}

export function ModelThinking({ content }: ModelThinkingProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  
  if (!content.trim()) return null;

  return (
    <div className={`thought-block ${isExpanded ? 'expanded' : ''}`}>
      <div className="thought-header" onClick={() => setIsExpanded(!isExpanded)}>
        <span className="thought-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 3C12 3 13.5 10.5 21 12C13.5 13.5 12 21 12 21C12 21 10.5 13.5 3 12C10.5 10.5 12 3 12 3Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style={{ opacity: 0.4, filter: 'blur(0.5px)' }}></path>
            <path d="M12 3C12 3 13.5 10.5 21 12C13.5 13.5 12 21 12 21C12 21 10.5 13.5 3 12C10.5 10.5 12 3 12 3Z" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
            <circle cx="12" cy="12" r="1" fill="currentColor"></circle>
          </svg>
        </span>
        <span className="thought-header-text shiny-text">Gemini is thinking...</span>
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
