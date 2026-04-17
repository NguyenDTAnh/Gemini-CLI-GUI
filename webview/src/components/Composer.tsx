import { DragEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { Paperclip, SendHorizonal, Square } from "lucide-react";
import { Attachment, ChatMode, DroppedFilePayload } from "../types";
import { ModelSelector } from "./ModelSelector";

interface ComposerProps {
  sessionId?: string;
  running: boolean;
  mode: ChatMode;
  modelId: string;
  modelLabel: string;
  modelOptions: string[];
  slashCommands: string[];
  mentionCandidates: string[];
  attachments: Attachment[];
  onSubmit: (prompt: string) => void;
  onStop: () => void;
  onAttach: () => void;
  onSetMode: (mode: ChatMode) => void;
  onSetModel: (modelId: string) => void;
  onAttachFiles: (files: DroppedFilePayload[]) => void;
  prefill?: {
    nonce: number;
    text: string;
    append: boolean;
  } | null;
}

async function toDroppedPayload(file: File): Promise<DroppedFilePayload> {
  const maybePath = (file as File & { path?: string }).path;
  const requiresInline = file.type.startsWith("image/") || !maybePath;
  let contentBase64: string | undefined;

  if (requiresInline) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Cannot read dropped file."));
      reader.readAsDataURL(file);
    });

    contentBase64 = dataUrl.includes(",") ? dataUrl.split(",", 2)[1] : dataUrl;
  }

  return {
    name: file.name,
    fsPath: maybePath,
    mimeType: file.type || undefined,
    size: file.size,
    contentBase64
  };
}

const StopIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="8" width="8" height="8" rx="1.5" fill="currentColor">
      <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
    </rect>
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="20 40" strokeLinecap="round" opacity="0.8">
      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1.5s" repeatCount="indefinite" />
    </circle>
  </svg>
);

export function Composer({
  sessionId,
  running,
  mode,
  modelId,
  modelLabel,
  modelOptions,
  slashCommands,
  mentionCandidates,
  attachments,
  onSubmit,
  onStop,
  onAttach,
  onSetMode,
  onSetModel,
  onAttachFiles,
  prefill
}: ComposerProps) {
  const [value, setValue] = useState("");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!prefill || !prefill.text.trim()) {
      return;
    }

    setValue((previous) => {
      if (!prefill.append || !previous.trim()) {
        return prefill.text;
      }

      return `${previous.trimEnd()}\n\n${prefill.text}`;
    });
  }, [prefill?.nonce]);

  const resolvedModelOptions = useMemo(() => {
    const list = [...modelOptions, modelId].filter((item) => Boolean(item.trim()));
    return [...new Set(list)];
  }, [modelOptions, modelId]);

  const sortedOptions = useMemo(() => {
    const core = ["auto", "manual"];
    const others = resolvedModelOptions.filter((o) => !core.includes(o));
    return [...core, ...others];
  }, [resolvedModelOptions]);

  const slashSuggestions = useMemo(() => {
    if (!value.trimStart().startsWith("/")) {
      return [];
    }

    const token = value.trimStart().toLowerCase();
    return slashCommands.filter((item) => item.startsWith(token));
  }, [slashCommands, value]);

  const mentionQuery = useMemo(() => {
    const match = value.match(/(?:^|\s)@([^\s@]*)$/);
    return match ? match[1].toLowerCase() : null;
  }, [value]);

  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) {
      return [];
    }

    return [...new Set(mentionCandidates)]
      .filter((item) => item.toLowerCase().includes(mentionQuery))
      .slice(0, 8);
  }, [mentionCandidates, mentionQuery]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const prompt = value.trim();
    if (!prompt) {
      return;
    }

    onSubmit(prompt);
    setValue("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(event as unknown as FormEvent);
    }
  };

  const handleDrop = async (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!sessionId) {
      return;
    }

    const files = Array.from(event.dataTransfer.files || []);
    if (files.length === 0) {
      return;
    }

    try {
      const payloads = await Promise.all(files.map((file) => toDroppedPayload(file)));
      onAttachFiles(payloads);

      const mentions = files.map((file) => `@${file.name}`).join(" ");
      if (mentions) {
        setValue((previous) => (previous.trim() ? `${previous.trimEnd()}\n${mentions}` : mentions));
      }
    } catch {
      // Ignore local file read failures and keep manual attach path available.
    }
  };

  const applyMention = (candidate: string) => {
    setValue((previous) => previous.replace(/@([^\s@]*)$/, `@${candidate} `));
  };

  const toggleMode = () => {
    onSetMode(mode === "plan" ? "edit" : "plan");
  };

  return (
    <form
      className={`composer ${dragging ? "dragging" : ""}`}
      onSubmit={submit}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (event.currentTarget.contains(event.relatedTarget as Node)) {
          return;
        }

        setDragging(false);
      }}
      onDrop={handleDrop}
    >
      {attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map((attachment) => (
            <span key={attachment.id} className="composer-attachment-chip">
              {attachment.name}
            </span>
          ))}
        </div>
      )}

      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Drop files/images, use @filename or /workflow"
        rows={1}
        style={{ minHeight: "24px" }}
      />

      {slashSuggestions.length > 0 && (
        <div className="slash-suggestions">
          {slashSuggestions.map((item) => (
            <button
              key={item}
              type="button"
              className="chip-btn"
              onClick={() => setValue(`${item} `)}
            >
              {item}
            </button>
          ))}
        </div>
      )}

      {mentionSuggestions.length > 0 && (
        <div className="mention-suggestions">
          {mentionSuggestions.map((item) => (
            <button
              key={item}
              type="button"
              className="chip-btn"
              onClick={() => applyMention(item)}
            >
              @{item}
            </button>
          ))}
        </div>
      )}

      <div className="composer-actions">
        <div className="action-left-group">
          <button
            type="button"
            className={`mode-toggle-btn ${mode}`}
            onClick={toggleMode}
            title={`Switch to ${mode === "plan" ? "Edit" : "Plan"} mode`}
          >
            {mode === "plan" ? "Plan" : "Edit"}
          </button>

          <button type="button" className="ghost-btn" onClick={onAttach} title="Attach file">
            <Paperclip size={14} />
          </button>

          <ModelSelector 
            modelId={modelId} 
            modelOptions={sortedOptions} 
            onSelect={onSetModel} 
          />
        </div>

        <div className="action-right-group">
          {!running && (
            <button type="submit" className="primary-btn" title="Send message">
              <SendHorizonal size={16} />
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
