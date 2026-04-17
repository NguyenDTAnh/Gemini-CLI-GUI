import { DragEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { Paperclip, SendHorizonal, Square } from "lucide-react";
import { Attachment, ChatMode, DroppedFilePayload } from "../types";
import { ModelSelector } from "./ModelSelector";

interface WebkitFileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

interface WebkitFileSystemFileEntry extends WebkitFileSystemEntry {
  file: (successCallback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void;
}

interface WebkitFileSystemDirectoryEntry extends WebkitFileSystemEntry {
  createReader: () => {
    readEntries: (
      successCallback: (entries: WebkitFileSystemEntry[]) => void,
      errorCallback?: (error: DOMException) => void
    ) => void;
  };
}

interface WebkitDataTransferItem extends DataTransferItem {
  webkitGetAsEntry?: () => WebkitFileSystemEntry | null;
}

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

async function readFileEntry(entry: WebkitFileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(
      (file) => resolve(file),
      () => resolve(null)
    );
  });
}

async function readDirectoryEntries(entry: WebkitFileSystemDirectoryEntry): Promise<WebkitFileSystemEntry[]> {
  const reader = entry.createReader();
  const all: WebkitFileSystemEntry[] = [];

  // Chromium directory readers return entries in chunks.
  while (true) {
    const chunk = await new Promise<WebkitFileSystemEntry[]>((resolve) => {
      reader.readEntries(
        (entries) => resolve(entries),
        () => resolve([])
      );
    });

    if (chunk.length === 0) {
      break;
    }

    all.push(...chunk);
  }

  return all;
}

async function entryToFiles(entry: WebkitFileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    const file = await readFileEntry(entry as WebkitFileSystemFileEntry);
    return file ? [file] : [];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const children = await readDirectoryEntries(entry as WebkitFileSystemDirectoryEntry);
  const nested = await Promise.all(children.map((child) => entryToFiles(child)));
  return nested.flat();
}

async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const initial = Array.from(dataTransfer.files || []);
  if (initial.length > 0) {
    return initial;
  }

  const items = Array.from(dataTransfer.items || []) as WebkitDataTransferItem[];
  const directFiles = items
    .map((item) => item.getAsFile())
    .filter((item): item is File => Boolean(item));

  const entryRoots = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is WebkitFileSystemEntry => Boolean(entry));

  if (entryRoots.length === 0) {
    return directFiles;
  }

  const nestedFiles = (await Promise.all(entryRoots.map((entry) => entryToFiles(entry)))).flat();
  const deduped = new Map<string, File>();

  for (const file of [...directFiles, ...nestedFiles]) {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (!deduped.has(key)) {
      deduped.set(key, file);
    }
  }

  return [...deduped.values()];
}

function getNameFromUri(value: string): string {
  try {
    const parsed = new URL(value);
    const path = decodeURIComponent(parsed.pathname || "");
    return path.split("/").filter(Boolean).pop() || value;
  } catch {
    const normalized = value.replace(/^file:\/\//, "");
    return normalized.split("/").filter(Boolean).pop() || value;
  }
}

function parseDroppedPathPayloads(dataTransfer: DataTransfer): DroppedFilePayload[] {
  const uriListRaw = dataTransfer.getData("text/uri-list") || "";
  const plainRaw = dataTransfer.getData("text/plain") || "";
  const lines = `${uriListRaw}\n${plainRaw}`
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter((item) => item && !item.startsWith("#"));

  const payloads: DroppedFilePayload[] = [];
  for (const line of lines) {
    if (line.startsWith("file://")) {
      payloads.push({ name: getNameFromUri(line), uri: line });
      continue;
    }

    if (line.startsWith("/")) {
      payloads.push({ name: line.split("/").pop() || line, fsPath: line });
    }
  }

  return payloads;
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

    const files = await collectDroppedFiles(event.dataTransfer);
    const filePayloads = files.length > 0
      ? await Promise.all(files.map((file) => toDroppedPayload(file)))
      : [];
    const uriPayloads = parseDroppedPathPayloads(event.dataTransfer);
    const payloads = [...filePayloads, ...uriPayloads];

    if (payloads.length === 0) {
      return;
    }

    try {
      onAttachFiles(payloads);

      const mentions = payloads
        .map((item) => item.name?.trim())
        .filter((item): item is string => Boolean(item))
        .map((name) => `@${name}`)
        .join(" ");
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
