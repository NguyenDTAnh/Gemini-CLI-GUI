import * as React from "react";
import { GeminiLogo } from "./GeminiLogo";
import { ChatMessage } from "../types";
import { MessageItem } from "./MessageItem";

interface ChatTimelineProps {
  messages: ChatMessage[];
  onRetry: () => void;
}

export function ChatTimeline({ messages, onRetry }: ChatTimelineProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const lastMessageCount = React.useRef(messages.length);

  React.useEffect(() => {
    if (containerRef.current) {
      const container = containerRef.current;
      
      // Kiểm tra xem người dùng có đang ở gần đáy không (ngưỡng 150px)
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
      const isNewMessage = messages.length > lastMessageCount.current;
      
      // Chỉ tự động cuộn nếu:
      // 1. Có tin nhắn mới hoàn toàn (vừa gửi xong)
      // 2. Hoặc đang ở gần đáy (đang theo dõi response mới nhất)
      if (isNewMessage || isNearBottom) {
        const scrollTimer = setTimeout(() => {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: messages.length <= 1 ? "auto" : "smooth"
          });
        }, 100);
        lastMessageCount.current = messages.length;
        return () => clearTimeout(scrollTimer);
      }
      
      lastMessageCount.current = messages.length;
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "8px" }}>
          <GeminiLogo size={24} />
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
