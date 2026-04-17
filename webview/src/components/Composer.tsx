import { DragEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { Paperclip, SendHorizonal, Square } from "lucide-react";
import { ChatMode, DroppedFilePayload } from "../types";

interface ComposerProps {
  sessionId?: string;
  running: boolean;
  mode: ChatMode;
  modelId: string;
  modelOptions: string[];
  slashCommands: string[];
  mentionCandidates: string[];
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

export function Composer({
  sessionId,
  running,
  mode,
  modelId,
  modelOptions,
  slashCommands,
  mentionCandidates,
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
      <div className="composer-toolbar">
        <div className="mode-toggle" role="group" aria-label="Chat mode">
          <button
            type="button"
            className={`mode-btn ${mode === "plan" ? "active" : ""}`}
            onClick={() => onSetMode("plan")}
          >
            Plan
          </button>
          <button
            type="button"
            className={`mode-btn ${mode === "edit" ? "active" : ""}`}
            onClick={() => onSetMode("edit")}
          >
            Edit
          </button>
        </div>

        <label className="model-select-wrap" aria-label="Model">
          <span>Model</span>
          <select value={modelId} onChange={(event) => onSetModel(event.target.value)}>
            {resolvedModelOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>

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
        <button type="button" className="ghost-btn" onClick={onAttach} title="Attach file">
          <Paperclip size={18} />
        </button>

        {!running && (
          <button type="submit" className="primary-btn" title="Send message">
            <SendHorizonal size={18} />
          </button>
        )}

        {running && (
          <button type="button" className="danger-btn" onClick={onStop} title="Stop generation">
            <Square size={18} />
          </button>
        )}
      </div>
    </form>
  );
}
