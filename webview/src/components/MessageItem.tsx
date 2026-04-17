import { RotateCcw, MoreHorizontal } from "lucide-react";
import { ChatMessage } from "../types";

interface MessageItemProps {
  message: ChatMessage;
  onRetry?: () => void;
}

export function MessageItem({ message, onRetry }: MessageItemProps) {
  const bubbleClass = `message-bubble ${message.role}`;

  return (
    <article className="message-row">
      <header className="message-head">
        <span className="message-role">
          {message.role === "assistant" ? (
            <>
              {message.model || "Gemini"}
              <button className="icon-btn-mini" title="Settings">
                <MoreHorizontal size={12} />
              </button>
            </>
          ) : message.role}
        </span>
        {message.role === "assistant" && onRetry && (
          <button className="icon-btn" onClick={onRetry} title="Regenerate">
            <RotateCcw size={16} />
          </button>
        )}
      </header>
      <pre className={bubbleClass}>{message.content || "..."}</pre>
      {message.status && message.status !== "complete" && (
        <small className={`message-status ${message.status}`}>{message.status}</small>
      )}
    </article>
  );
}
