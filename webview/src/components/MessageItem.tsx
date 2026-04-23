import { User, Cpu, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { GeminiLogo } from "./GeminiLogo";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkEmoji from "remark-emoji";
import rehypeRaw from "rehype-raw";
import { useMemo, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { ChatMessage } from "../types";
import { DiffViewer } from "./DiffViewer";
import { DiffStats } from "./DiffStats";
import { PermissionRequest } from "./PermissionRequest";
import { ModelThinking } from "./ModelThinking";

interface MessageItemProps {
  message: ChatMessage;
  onRetry?: () => void;
}

function ToolCallBlock({ content, status }: { content: string, status?: string }) {
  const isGenericAction = content.toLowerCase() === 'action';
  const displayText = isGenericAction ? 'Executing task...' : `Executing: ${content}`;
  const isComplete = status === 'complete';
  
  return (
    <div className={`progress-status ${isComplete ? 'completed' : ''}`}>
      <span className="progress-icon">
        <Loader2 size={12} className={isComplete ? '' : 'spin-icon'} />
      </span>
      <span className="progress-text">
        {displayText}
      </span>
    </div>
  );
}

export function MessageItem({ message }: MessageItemProps) {
  const isAssistant = message.role === "assistant";

  const parts = useMemo(() => {
    const content = message.content || "";
    const segments: { type: "text" | "diff" | "progress" | "loading" | "permission" | "thought" | "call"; content: string; data?: any }[] = [];

    if (content) {
      if (isAssistant) {
        // Regex để tách các phần: diff, subagent, progress, thought, tool calls và PermissionRequest (dùng tag linh hoạt)
        const regex = /(?=diff --git|--- [ai]\/|\[Subagent:|<subagent |> thought|<thought>|<think>|> call:|\[Tool:|\s*<permission_request>)/g;
        const splitSegments = content.split(regex);
        
        splitSegments.filter(s => s.trim()).forEach(s => {
          const trimmed = s.trim();
          if (trimmed.startsWith("<permission_request>")) {
            try {
              const startTag = "<permission_request>";
              const endTag = "</permission_request>";
              const startIndex = trimmed.indexOf(startTag);
              const endIndex = trimmed.indexOf(endTag);
              
              if (endIndex !== -1) {
                const jsonPart = trimmed.substring(startIndex + startTag.length, endIndex);
                const data = JSON.parse(jsonPart);
                segments.push({ type: "permission", content: "", data });
                
                const extra = trimmed.substring(endIndex + endTag.length);
                if (extra.trim()) {
                  segments.push({ type: "text", content: extra });
                }
              } else {
                // Nếu chưa thấy tag đóng, có thể đang streaming (không render JSON thô)
                if (message.status === "streaming") {
                   // Để trống hoặc hiện placeholder nhẹ nhàng
                } else {
                   segments.push({ type: "text", content: s });
                }
              }
            } catch (e) {
              console.error("Failed to parse permission request segment", e);
              segments.push({ type: "text", content: s });
            }
          } else if (s.startsWith("diff --git") || s.startsWith("---")) {
            segments.push({ type: "diff", content: s.trim() });
          } else if (s.startsWith("> thought") || s.startsWith("<thought>") || s.startsWith("<think>")) {
            let thoughtContent = s.trim();
            if (thoughtContent.startsWith("<thought>")) {
              thoughtContent = thoughtContent.replace("<thought>", "").replace("</thought>", "");
            } else if (thoughtContent.startsWith("<think>")) {
              thoughtContent = thoughtContent.replace("<think>", "").replace("</think>", "");
            } else {
              thoughtContent = thoughtContent.replace("> thought", "");
            }
            segments.push({ type: "thought", content: thoughtContent.trim() });
          } else if (s.startsWith("> call:") || s.startsWith("[Tool:")) {
            const lines = s.trim().split('\n');
            const firstLine = lines[0].trim();
            const callContent = firstLine.startsWith("> call:") 
              ? firstLine.replace("> call:", "").trim() 
              : firstLine.replace("[Tool:", "").replace("]", "").trim();
            
            segments.push({ type: "call", content: callContent });
            
            const rest = lines.slice(1).join('\n');
            if (rest.trim()) {
              segments.push({ type: "text", content: rest });
            }
          } else if (s.startsWith("[Subagent:") || s.startsWith("<subagent")) {
            const lines = s.trim().split('\n');
            segments.push({ type: "progress", content: lines[0].trim() });
            
            const rest = lines.slice(1).join('\n');
            if (rest.trim()) {
              segments.push({ type: "text", content: rest });
            }
          } else {
            segments.push({ type: "text", content: s });
          }
        });
      } else {
        // ... (phần cũ cho role user)
        const regex = /(?=diff --git|--- [ai]\/)/g;
        const splitSegments = content.split(regex);
        splitSegments.filter(s => s).forEach(s => {
          if (s.startsWith("diff --git") || s.startsWith("---")) {
            segments.push({ type: "diff", content: s.trim() });
          } else {
            segments.push({ type: "text", content: s });
          }
        });
      }
    }
    // ...

    if (message.status === "streaming") {
      segments.push({ type: "loading", content: "" });
    }

    return segments;
  }, [message.content, message.status, isAssistant]);

  const diffParts = useMemo(() => parts.filter(p => p.type === "diff").map(p => p.content), [parts]);

  return (
    <article className={`message-row ${message.role}`}>
      <div className="message-content">
        <header className="message-head">
          <div className="avatar-box">
            {isAssistant ? (
              <GeminiLogo size={14} />
            ) : (
              <User size={12} fill="currentColor" />
            )}
          </div>
          <span className="message-role">
            {isAssistant ? <>{message.model || "Gemini"}</> : "You"}
          </span>
        </header>
        
        <div className="bubble-stack">
          {parts.map((part, idx) => {
            const isProgressHidden = (part.type === "progress" || part.type === "call") && message.status === "complete";
            if (isProgressHidden) return null;

            return (
              <div key={idx} className={`message-bubble ${message.role} ${part.type}`}>
                {part.type === "permission" ? (
                  <PermissionRequest {...part.data} />
                ) : part.type === "loading" ? (
                  <div className="gemini-loader">
                    <div className="shimmer-line" style={{ width: '90%' }}></div>
                    <div className="shimmer-line" style={{ width: '70%' }}></div>
                    <div className="shimmer-line" style={{ width: '40%' }}></div>
                  </div>
                ) : part.type === "diff" ? (
                  <DiffViewer diffText={part.content} />
                ) : part.type === "thought" ? (
                  <ModelThinking content={part.content} />
                ) : part.type === "call" ? (
                  <ToolCallBlock content={part.content} status={message.status} />
                ) : part.type === "progress" ? (
                  <div className="progress-status">
                    <span className="progress-icon">
                      <Loader2 size={14} className="spin-icon" />
                    </span>
                    <span className="progress-text">
                      {part.content.startsWith("> call:") ? (
                        <>
                          <span style={{ opacity: 0.6, marginRight: '4px' }}>Tool:</span>
                          {part.content.replace("> call:", "").trim()}
                        </>
                      ) : part.content.startsWith("[Tool:") ? (
                        <>
                          <span style={{ opacity: 0.6, marginRight: '4px' }}>MCP:</span>
                          {part.content.replace(/[\[\]]/g, '').replace("Tool:", "").trim()}
                        </>
                      ) : (
                        part.content.split('\n')[0].replace(/[\][>]/g, '').trim()
                      )}
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
                            customStyle={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
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
                    {part.content
                      // Biến @[display](id) thành chip HTML
                      .replace(/@\[([^\]]+)\]\(([^)]+)\)/g, '<span class="mention-chip" data-id="$2">@$1</span>')
                      // Biến /command thành chip HTML
                      .replace(/(^|\s)(\/\w+)/g, '$1<span class="mention-chip">$2</span>')
                      // Biến khối Selected context thành Snippet Chip gọn gàng
                      .replace(/## Selected context: ([^\n]+)\n```(\w+)\n([\s\S]*?)\n```/g, (match, title) => {
                        return `<div class="mention-chip snippet-chip" title="Snippet context">${title}</div>`;
                      })
                    }
                  </ReactMarkdown>
                )}
              </div>
            );
          })}
          {isAssistant && diffParts.length > 0 && <DiffStats diffTexts={diffParts} />}
        </div>

        {message.status && message.status !== "complete" && message.status !== "streaming" && (
          <small className={`message-status ${message.status}`}>{message.status}</small>
        )}
      </div>
    </article>
  );
}

