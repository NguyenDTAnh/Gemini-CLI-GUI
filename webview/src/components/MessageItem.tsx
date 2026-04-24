import { User, Loader2, Check, X } from "lucide-react";
import { GeminiLogo } from "./GeminiLogo";
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
import { PermissionRequest } from "./PermissionRequest";
import { ModelThinking } from "./ModelThinking";

interface MessageItemProps {
  message: ChatMessage;
  onRetry?: () => void;
}

export function MessageItem({ message }: MessageItemProps) {
  const isAssistant = message.role === "assistant";

  const parts = useMemo(() => {
    const content = message.content || "";
    type Segment = { type: "text" | "diff" | "progress" | "loading" | "permission" | "thought" | "call"; content: string; data?: any; callStatus?: "pending" | "success" | "error" };
    const segments: Segment[] = [];

    if (content) {
      if (isAssistant) {
        // Regex chỉ cắt ở đầu các khối đặc biệt để đảm bảo tính ổn định khi streaming
        const regex = /(?=diff --git|--- [ai]\/|\[Subagent:|<subagent |<thought>|<think>|> call:|\[Tool:|\s*<permission_request>|<div class="permission-confirmed">)/g;
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
          } else if (trimmed.startsWith("diff --git") || trimmed.startsWith("---")) {
            segments.push({ type: "diff", content: s.trim() });
          } else if (trimmed.startsWith("<thought>") || trimmed.startsWith("<think>")) {
            let thoughtPart = trimmed;
            let remainingPart = "";
            
            // Tìm thẻ đóng để tách nội dung thực sự ra khỏi block suy nghĩ
            const thoughtEndTags = ["</thought>", "</think>"];
            let foundEndTag = false;
            
            for (const tag of thoughtEndTags) {
              const idx = trimmed.indexOf(tag);
              if (idx !== -1) {
                thoughtPart = trimmed.substring(0, idx + tag.length);
                remainingPart = trimmed.substring(idx + tag.length);
                foundEndTag = true;
                break;
              }
            }

            // Nếu không tìm thấy thẻ đóng, hoặc bên trong thought có chứa permission_request (AI lỗi)
            // ta cần cắt nó ra để không bị render nhầm vào trong ModelThinking
            const permissionStartIdx = thoughtPart.indexOf("<permission_request>");
            const confirmedStartIdx = thoughtPart.indexOf('<div class="permission-confirmed">');
            
            let splitIdx = -1;
            if (permissionStartIdx !== -1 && confirmedStartIdx !== -1) {
                splitIdx = Math.min(permissionStartIdx, confirmedStartIdx);
            } else if (permissionStartIdx !== -1) {
                splitIdx = permissionStartIdx;
            } else if (confirmedStartIdx !== -1) {
                splitIdx = confirmedStartIdx;
            }

            if (splitIdx !== -1) {
                // Nếu tìm thấy tag bên trong, ta cắt thoughtPart tại đó
                remainingPart = thoughtPart.substring(splitIdx) + remainingPart;
                thoughtPart = thoughtPart.substring(0, splitIdx);
            } else if (!foundEndTag && message.status !== "streaming") {
               const nextBlockIdx = trimmed.slice(1).search(/diff --git|--- [ai]\/|\[Subagent:|<subagent |> call:|\[Tool:|<permission_request>|<div class="permission-confirmed">/);
               if (nextBlockIdx !== -1) {
                  thoughtPart = trimmed.substring(0, nextBlockIdx + 1);
                  remainingPart = trimmed.substring(nextBlockIdx + 1);
               }
            }
            
            // Làm sạch nội dung thinking (bỏ tag)
            let thoughtContent = thoughtPart;
            if (thoughtContent.startsWith("<thought>")) {
              thoughtContent = thoughtContent.replace("<thought>", "").replace("</thought>", "");
            } else if (thoughtContent.startsWith("<think>")) {
              thoughtContent = thoughtContent.replace("<think>", "").replace("</think>", "");
            }
            
            segments.push({ type: "thought", content: thoughtContent.trim() });
            
            // Nếu có phần nội dung sau thẻ đóng, đẩy nó vào segment text bình thường
            if (remainingPart.trim()) {
              segments.push({ type: "text", content: remainingPart });
            }
          } else if (trimmed.startsWith("> call:") || trimmed.startsWith("[Tool:")) {
            const lines = s.trim().split('\n');
            const firstLine = lines[0].trim();
            let callContent = firstLine.startsWith("> call:")
              ? firstLine.replace("> call:", "").trim()
              : firstLine.replace("[Tool:", "").replace("]", "").trim();

            let callStatus: Segment["callStatus"] = "pending";
            const statusMatch = callContent.match(/\s+-\s+(Done|completed|Failed|error|Cancelled|cancelled)$/i);
            if (statusMatch) {
              const statusRaw = statusMatch[1].toLowerCase();
              if (statusRaw === "done" || statusRaw === "completed") {
                callStatus = "success";
              } else if (statusRaw === "failed" || statusRaw === "error" || statusRaw === "cancelled") {
                callStatus = "error";
              }
              callContent = callContent.substring(0, statusMatch.index).trim();
            }

            // Nếu message bị cancelled thì tất cả call đều là error
            if (message.status === "cancelled") {
              callStatus = "error";
            }

            // Merge với call segment liền trước đó nếu cùng tool name
            const last = segments[segments.length - 1];
            if (last && last.type === "call") {
              // Cập nhật status và content của last (giữ lại 1 bubble duy nhất)
              last.content = callContent;
              last.callStatus = callStatus;
            } else {
              segments.push({ type: "call", content: callContent, callStatus });
            }

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
              <GeminiLogo size={16} />
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
            // Ẩn progress/call bubbles khi message bị cancelled (dọn dẹp UI)
            const isHidden = (part.type === "progress" || part.type === "call") && (message.status === "cancelled" || message.status === "error");
            if (isHidden) return null;

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
                ) : (part.type === "call" || part.type === "progress") ? (
                  <div className="progress-status">
                    <span className="progress-icon">
                      {part.type === "call" && part.callStatus === "success" ? (
                        <Check size={14} style={{ color: '#22c55e' }} />
                      ) : part.type === "call" && part.callStatus === "error" ? (
                        <X size={14} style={{ color: '#ef4444' }} />
                      ) : (
                        <Loader2 size={14} className="spin-icon" />
                      )}
                    </span>
                    <span className="progress-text shiny-text">
                      {part.type === "call" ? (
                        (() => {
                          const rawName = part.content;
                          if (rawName.toLowerCase() === 'action' || rawName.toLowerCase() === 'task') {
                            return part.callStatus === "success" ? "Done" : part.callStatus === "error" ? "Failed" : "Processing...";
                          }
                          if (rawName.includes(':')) {
                            const pieces = rawName.split(':');
                            return pieces.slice(1).join(':').trim();
                          }
                          return rawName;
                        })()
                      ) : (
                        part.content.split('\n')[0].replace(/[\][>]/g, '').trim() || "Processing..."
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

