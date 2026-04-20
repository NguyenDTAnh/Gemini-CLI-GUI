import * as React from "react";
import { Sparkle } from "lucide-react";
import { ChatMessage } from "../types";
import { MessageItem } from "./MessageItem";

interface ChatTimelineProps {
  messages: ChatMessage[];
  onRetry: () => void;
}

export function ChatTimeline({ messages, onRetry }: ChatTimelineProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (containerRef.current) {
      const container = containerRef.current;
      // Dùng requestAnimationFrame hoặc setTimeout để đợi layout ổn định
      const scrollTimer = setTimeout(() => {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: messages.length <= 1 ? "auto" : "smooth"
        });
      }, 100);
      return () => clearTimeout(scrollTimer);
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "8px" }}>
          <Sparkle className="session-icon" size={20} />
          <h3>Gemini CLI Chat</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="timeline" ref={containerRef}>
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} onRetry={message.role === "assistant" ? onRetry : undefined} />
      ))}
    </div>
  );
}
