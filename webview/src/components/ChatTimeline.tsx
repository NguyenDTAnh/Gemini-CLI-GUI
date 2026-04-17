import { ChatMessage } from "../types";
import { MessageItem } from "./MessageItem";

interface ChatTimelineProps {
  messages: ChatMessage[];
  onRetry: () => void;
}

export function ChatTimeline({ messages, onRetry }: ChatTimelineProps) {
  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <h3>Gemini CLI Chat</h3>
        <p>Bat dau bang mot prompt hoac slash command nhu /explain, /fix, /summarize.</p>
      </div>
    );
  }

  return (
    <div className="timeline">
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} onRetry={message.role === "assistant" ? onRetry : undefined} />
      ))}
    </div>
  );
}
