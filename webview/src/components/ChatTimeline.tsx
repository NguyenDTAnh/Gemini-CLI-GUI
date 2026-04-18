import { useEffect, useRef } from "react";
import { ChatMessage } from "../types";
import { MessageItem } from "./MessageItem";

interface ChatTimelineProps {
  messages: ChatMessage[];
  onRetry: () => void;
}

export function ChatTimeline({ messages, onRetry }: ChatTimelineProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <h3>Gemini CLI Chat</h3>
        <p>Start with a prompt or a slash command like /explain, /fix, /summarize.</p>
      </div>
    );
  }

  return (
    <div className="timeline">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} onRetry={message.role === "assistant" ? onRetry : undefined} />
      ))}
      <div ref={bottomRef} style={{ height: 1, width: "100%" }} />
    </div>
  );
}
