import * as React from "react";
import { FileCode, FileSearch, FileText, Image as ImageIcon, Paperclip, SendHorizonal, Sparkles, Terminal, X } from "lucide-react";
import { Agent, Attachment, ChatMode, DroppedFilePayload, SlashCommandDescriptor } from "../types";
import { AgentSelector } from "./AgentSelector";
import { ModelSelector } from "./ModelSelector";
import { ContentEditableInput, ContentEditableInputHandle, SuggestionItem } from "./ContentEditableInput";
import { collectDroppedFiles, parseDroppedPathPayloads, toDroppedPayload } from "../dragDropUtils";

interface ComposerProps {
  sessionId?: string;
  running: boolean;
  mode: ChatMode;
  modelId: string;
  modelLabel: string;
  modelOptions: string[];
  agentId: string;
  agentOptions: Agent[];
  slashCommands: string[];
  commandDescriptors?: SlashCommandDescriptor[];
  mentionCandidates: { name: string; fsPath: string }[];
  attachments: Attachment[];
  onSubmit: (prompt: string) => void;
  onStop: () => void;
  onAttach: () => void;
  onSetMode: (mode: ChatMode) => void;
  onSetAgent: (agentId: string) => void;
  onSetModel: (modelId: string) => void;
  onAttachFiles: (files: DroppedFilePayload[]) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSearchFiles: (query: string) => void;
  prefill?: {
    nonce: number;
    text: string;
    append: boolean;
    contextChip?: { display: string; content: string; languageId: string };
    contextChips?: Array<{ display: string; content?: string; languageId?: string; type: 'mention' | 'snippet'; id?: string }>;
  } | null;
}

const StopIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="8" width="8" height="8" rx="1.5" fill="url(#primary-gradient)">
      <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
    </rect>
    <circle cx="12" cy="12" r="10" stroke="url(#primary-gradient)" strokeWidth="2" strokeDasharray="20 40" strokeLinecap="round" opacity="0.8">
      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1.5s" repeatCount="indefinite" />
    </circle>
  </svg>
);

function getSlashIcon(category?: string) {
  const props = { size: 14, stroke: "url(#primary-gradient)" };
  switch (category) {
    case "analysis":
      return <FileSearch {...props} />;
    case "editing":
      return <FileCode {...props} />;
    case "debug":
      return <Terminal {...props} />;
    default:
      return <Sparkles {...props} />;
  }
}

const SharedGradients = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }}>
    <defs>
      <linearGradient id="primary-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="var(--gradient-start, #0078d4)" />
        <stop offset="100%" stopColor="var(--gradient-end, #00bcf2)" />
      </linearGradient>
    </defs>
  </svg>
);

function getFileIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const props = { size: 14, stroke: "url(#primary-gradient)" };
  switch (ext) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "vue":
    case "svelte":
    case "html":
    case "css":
    case "scss":
    case "less":
      return <FileCode {...props} />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
      return <ImageIcon {...props} />;
    case "md":
    case "txt":
    case "json":
    case "yml":
    case "yaml":
      return <FileText {...props} />;
    default:
      return <FileText {...props} />;
  }
}

export function Composer({
  sessionId,
  running,
  mode,
  modelId,
  modelOptions,
  agentId,
  agentOptions,
  slashCommands,
  commandDescriptors,
  mentionCandidates,
  attachments,
  onSubmit,
  onStop,
  onAttach,
  onSetMode,
  onSetAgent,
  onSetModel,
  onAttachFiles,
  onRemoveAttachment,
  onSearchFiles,
  prefill
}: ComposerProps) {
  const [activeDropdown, setActiveDropdown] = React.useState<"agent" | "model" | null>(null);
  const inputRef = React.useRef<ContentEditableInputHandle>(null);

  React.useEffect(() => {
    const handleClickOutside = () => setActiveDropdown(null);
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const toggleDropdown = (name: "agent" | "model") => {
    setActiveDropdown((prev) => (prev === name ? null : name));
  };

  const resolvedModelOptions = React.useMemo(() => {
    const list = [...modelOptions, modelId].filter((item) => Boolean(item.trim()));
    return [...new Set(list)];
  }, [modelOptions, modelId]);

  const sortedOptions = React.useMemo(() => {
    const core = ["auto", "manual"];
    const others = resolvedModelOptions.filter((o) => !core.includes(o));
    return [...core, ...others];
  }, [resolvedModelOptions]);

  const resolvedAgentOptions = React.useMemo(() => {
    return agentOptions.filter((item): item is Agent => Boolean(item?.id && item?.label));
  }, [agentOptions, agentId]);

  const slashMentionData = React.useMemo(() => {
    return slashCommands.map((cmd) => ({ id: cmd, display: cmd }));
  }, [slashCommands]);

  const fileMentionData = React.useMemo(() => {
    return mentionCandidates.map((item) => ({
      id: item.fsPath,
      display: item.name,
      fsPath: item.fsPath
    }));
  }, [mentionCandidates]);

  const submit = (text: string) => {
    const prompt = text.trim();
    if (!prompt) {
      return;
    }
    onSubmit(prompt);
  };

  const handleRemoveAttachment = (id: string) => {
    const attachment = attachments.find(a => a.id === id);
    onRemoveAttachment(id);
    if (attachment) {
      // Try to remove by any identifier that might have been used for the chip
      inputRef.current?.removeChip(attachment.id);
      inputRef.current?.removeChip(attachment.fsPath);
      inputRef.current?.removeChip(attachment.name);
    } else {
      // Fallback: just try the ID
      inputRef.current?.removeChip(id);
    }
  };

  const handleChipDeleted = (idOrName: string) => {
    // Try to find by ID, path, or name
    const attachment = attachments.find(a => 
      a.id === idOrName || 
      a.fsPath === idOrName || 
      a.name === idOrName
    );
    if (attachment) {
      onRemoveAttachment(attachment.id);
    }
  };

  const renderSlashSuggestion = (
    item: SuggestionItem,
    focused: boolean
  ) => {
    const descriptor = commandDescriptors?.find((d) => `/${d.name}` === item.id);
    return (
      <div className={`suggestion-item ${focused ? "active" : ""}`} style={{ padding: "4px" }}>
        <div className="suggestion-row">
          <div className="suggestion-icon">{getSlashIcon(descriptor?.category)}</div>
          <div className="suggestion-name">{item.display}</div>
        </div>
        {descriptor && <div className="suggestion-hint">{descriptor.hint}</div>}
      </div>
    );
  };

  const renderFileSuggestion = (
    item: SuggestionItem,
    focused: boolean
  ) => {
    return (
      <div className={`suggestion-item ${focused ? "active" : ""}`} style={{ padding: "6px" }}>
        <div className="suggestion-row" style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }}>
          <div className="suggestion-icon" style={{ flexShrink: 0 }}>{getFileIcon(item.display)}</div>
          <div className="suggestion-name" style={{ flexShrink: 0, fontWeight: 600 }}>{item.display}</div>
          <div className="suggestion-path" style={{ 
            fontSize: '10px', 
            opacity: 0.4, 
            overflow: 'hidden', 
            textOverflow: 'ellipsis', 
            whiteSpace: 'nowrap',
            flex: 1,
            textAlign: 'right'
          }}>{item.fsPath}</div>
        </div>
      </div>
    );
  };

  const toggleMode = () => {
    onSetMode(mode === "plan" ? "edit" : "plan");
  };

  return (
    <form
      className="composer"
    >
      <SharedGradients />
      {attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map((attachment) => (
            <span key={attachment.id} className="composer-attachment-pill">
              <span className="pill-icon">
                {attachment.isImage ? <ImageIcon size={12} stroke="url(#primary-gradient)" /> : <FileText size={12} stroke="url(#primary-gradient)" />}
              </span>
              <span className="pill-text">{attachment.name}</span>
              <button
                type="button"
                className="pill-remove"
                onClick={() => handleRemoveAttachment(attachment.id)}
              >
                <X size={12} stroke="url(#primary-gradient)" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="composer-input-wrapper">
        <ContentEditableInput
          ref={inputRef}
          placeholder="Drop files/images, use @filename or /workflow"
          slashCommands={slashMentionData}
          mentionCandidates={fileMentionData}
          onSearchFiles={onSearchFiles}
          onSubmit={submit}
          onChipDeleted={handleChipDeleted}
          renderSlashSuggestion={renderSlashSuggestion}
          renderFileSuggestion={renderFileSuggestion}
          prefill={prefill || undefined}
        />
      </div>


      <div className="composer-actions">
        <div className="action-left-group">
          <button type="button" className="ghost-btn" onClick={onAttach} title="Attach file">
            <Paperclip size={14} stroke="url(#primary-gradient)" />
          </button>

          <button
            type="button"
            className={`mode-toggle-btn ${mode}`}
            onClick={toggleMode}
            title={`Switch to ${mode === "plan" ? "Edit" : "Plan"} mode`}
          >
            {mode === "plan" ? "Plan" : "Edit"}
          </button>

          <AgentSelector
            agentId={agentId}
            agentOptions={resolvedAgentOptions}
            onSelect={onSetAgent}
            isOpen={activeDropdown === "agent"}
            onToggle={() => toggleDropdown("agent")}
          />

          <ModelSelector
            modelId={modelId}
            modelOptions={sortedOptions}
            onSelect={onSetModel}
            isOpen={activeDropdown === "model"}
            onToggle={() => toggleDropdown("model")}
          />
        </div>

        <div className="action-right-group">
          {!running && (
            <button type="button" className="primary-btn" title="Send message" onClick={() => {
               // The content editable input handles Enter to submit directly
            }}>
              <SendHorizonal size={16} stroke="url(#primary-gradient)" />
            </button>
          )}

          {running && (
            <button type="button" className="danger-btn" onClick={onStop} title="Stop generation">
              <StopIcon size={16} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}