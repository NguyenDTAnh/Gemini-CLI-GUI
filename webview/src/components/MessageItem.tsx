import { Sparkle, User, Cpu } from "lucide-react";
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

export function MessageItem({ message, onRetry }: MessageItemProps) {
  const isAssistant = message.role === "assistant";

  // Tách nội dung thành các phần text, diff và subagent
  const parts = useMemo(() => {
    const content = message.content || "";
    if (!content && message.status === "streaming") {
      return [{ type: "loading", content: "" }];
    }

    const regex = /(?=diff --git|--- [ai]\/|\[Subagent:|<subagent )/g;
    const segments = content.split(regex);
    
    return segments.filter(s => s.trim()).map(s => {
      if (s.startsWith("diff --git") || s.startsWith("---")) {
        return { type: "diff", content: s.trim() };
      }
      if (s.startsWith("[Subagent:") || s.startsWith("<subagent")) {
        return { type: "subagent", content: s.trim() };
      }
      return { type: "text", content: s.trim() };
    });
  }, [message.content, message.status]);

  const diffParts = useMemo(() => parts.filter(p => p.type === "diff").map(p => p.content), [parts]);

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
              ) : part.type === "subagent" ? (
                <div className="subagent-status">
                  <span className="subagent-icon">
                    <Cpu size={14} />
                  </span>
                  <span>{part.content.replace(/[\[\]]/g, '')}</span>
                </div>
              ) : (
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm, remarkEmoji]} 
                  rehypePlugins={[rehypeRaw]}
                  components={{
                    code({ node, inline, className, children, ...props }: any) {
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
