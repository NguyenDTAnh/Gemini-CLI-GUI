import { Sparkle, User } from "lucide-react";
import { ChatMessage } from "../types";

interface MessageItemProps {
  message: ChatMessage;
  onRetry?: () => void;
}

export function MessageItem({ message, onRetry }: MessageItemProps) {
  const isAssistant = message.role === "assistant";
  const bubbleClass = `message-bubble ${message.role}`;

  return (
    <article className={`message-row ${message.role}`}>
      <div className="avatar-box">
        {isAssistant ? (
          <Sparkle size={12} fill="currentColor" />
        ) : (
          <User size={12} fill="currentColor" />
        )}
      </div>
      <div className="message-content">
        <header className="message-head">
          <span className="message-role">
            {isAssistant ? (
              <>
                {message.model || "Gemini"}
              </>
            ) : (
              "You"
            )}
          </span>
        </header>
        <pre className={bubbleClass}>{message.content || "..."}</pre>
        {message.status && message.status !== "complete" && (
          <small className={`message-status ${message.status}`}>{message.status}</small>
        )}
      </div>
    </article>
  );
}
