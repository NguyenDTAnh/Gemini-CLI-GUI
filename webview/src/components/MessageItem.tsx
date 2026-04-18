import { Sparkle, User, Cpu, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkEmoji from "remark-emoji";
import rehypeRaw from "rehype-raw";
import { useMemo } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { ChatMessage } from "../types";
import { DiffViewer } from "./DiffViewer";
import { DiffStats } from "./DiffStats";

interface MessageItemProps {
  message: ChatMessage;
  onRetry?: () => void;
}

export function MessageItem({ message }: MessageItemProps) {
  const isAssistant = message.role === "assistant";

  const parts = useMemo(() => {
    const content = message.content || "";
    const segments: { type: "text" | "diff" | "progress" | "loading"; content: string }[] = [];

    if (content) {
      // Nhận diện diff, subagent, thought, tool calls
      const regex = /(?=diff --git|--- [ai]\/|\[Subagent:|<subagent |> thought|> call:|\[Tool:)/g;
      const splitSegments = content.split(regex);

      splitSegments.filter(s => s.trim()).forEach(s => {
        if (s.startsWith("diff --git") || s.startsWith("---")) {
          segments.push({ type: "diff", content: s.trim() });
        } else if (s.startsWith("[Subagent:") || s.startsWith("<subagent") || s.startsWith("> thought") || s.startsWith("> call:") || s.startsWith("[Tool:")) {
          segments.push({ type: "progress", content: s.trim() });
        } else {
          segments.push({ type: "text", content: s.trim() });
        }
      });
    }

    // Luôn thêm loading part ở cuối nếu đang streaming
    if (message.status === "streaming") {
      segments.push({ type: "loading", content: "" });
    }

    return segments;
  }, [message.content, message.status]);

  const diffParts = useMemo(() => parts.filter(p => p.type === "diff").map(p => p.content), [parts]);

  return (
    <article className={`message-row ${message.role}`}>
      <div className="message-content">
        <header className="message-head">
          <div className="avatar-box">
            {isAssistant ? (
              <Sparkle size={12} fill="currentColor" />
            ) : (
              <User size={12} fill="currentColor" />
            )}
          </div>
          <span className="message-role">
            {isAssistant ? <>{message.model || "Gemini"}</> : "You"}
          </span>
        </header>
        
        <div className="bubble-stack">
          {parts.map((part, idx) => (
            <div key={idx} className={`message-bubble ${message.role} ${part.type}`}>
              {part.type === "loading" ? (
                <div className="gemini-loader">
                  <div className="shimmer-line" style={{ width: '90%' }}></div>
                  <div className="shimmer-line" style={{ width: '70%' }}></div>
                  <div className="shimmer-line" style={{ width: '40%' }}></div>
                </div>
              ) : part.type === "diff" ? (
                <DiffViewer diffText={part.content} />
              ) : part.type === "progress" ? (
                <div className="progress-status">
                  <span className="progress-icon">
                    {part.content.startsWith("> thought") ? <Cpu size={14} /> : <Loader2 size={14} className="spin-icon" />}
                  </span>
                  <span className="progress-text">
                    {part.content.startsWith("> thought") ? "Thinking..." 
                      : part.content.startsWith("> call:") ? "Executing tool..."
                      : part.content.split('\n')[0].replace(/[[]>]/g, '').trim()}
                  </span>
                </div>
              ) : (
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm, remarkEmoji]} 
                  rehypePlugins={[rehypeRaw]}
                  components={{
                    code({ inline, className, children, ...props }: any) {
                      const match = /language-(\w+)/.exec(className || '');
                      return !inline && match ? (
                        <SyntaxHighlighter
                          style={vscDarkPlus as any}
                          language={match[1]}
                          PreTag="div"
                          className="syntax-highlighter"
                          {...props}
                        >
                          {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                      ) : (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    }
                  }}
                >
                  {part.content}
                </ReactMarkdown>
              )}
            </div>
          ))}
          {isAssistant && diffParts.length > 0 && <DiffStats diffTexts={diffParts} />}
        </div>

        {message.status && message.status !== "complete" && message.status !== "streaming" && (
          <small className={`message-status ${message.status}`}>{message.status}</small>
        )}
      </div>
    </article>
  );
}
