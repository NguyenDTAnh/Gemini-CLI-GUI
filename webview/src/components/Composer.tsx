import * as React from "react";
import { FileCode, FileSearch, FileText, Image as ImageIcon, Paperclip, SendHorizonal, Sparkles, Terminal, X } from "lucide-react";
import { Attachment, ChatMode, DroppedFilePayload, SlashCommandDescriptor } from "../types";
import { ModelSelector } from "./ModelSelector";
import { ContentEditableInput, SuggestionItem } from "./ContentEditableInput";

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

interface WebkitDataTransferItem {
  webkitGetAsEntry?: () => any;
  getAsFile: () => File | null;
}

interface ComposerProps {
  sessionId?: string;
  running: boolean;
  mode: ChatMode;
  modelId: string;
  modelLabel: string;
  modelOptions: string[];
  slashCommands: string[];
  commandDescriptors?: SlashCommandDescriptor[];
  mentionCandidates: { name: string; fsPath: string }[];
  attachments: Attachment[];
  onSubmit: (prompt: string) => void;
  onStop: () => void;
  onAttach: () => void;
  onSetMode: (mode: ChatMode) => void;
  onSetModel: (modelId: string) => void;
  onAttachFiles: (files: DroppedFilePayload[]) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSearchFiles: (query: string) => void;
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
  slashCommands,
  commandDescriptors,
  mentionCandidates,
  attachments,
  onSubmit,
  onStop,
  onAttach,
  onSetMode,
  onSetModel,
  onAttachFiles,
  onRemoveAttachment,
  onSearchFiles,
  prefill
}: ComposerProps) {
  const [dragging, setDragging] = React.useState(false);

  const resolvedModelOptions = React.useMemo(() => {
    const list = [...modelOptions, modelId].filter((item) => Boolean(item.trim()));
    return [...new Set(list)];
  }, [modelOptions, modelId]);

  const sortedOptions = React.useMemo(() => {
    const core = ["auto", "manual"];
    const others = resolvedModelOptions.filter((o) => !core.includes(o));
    return [...core, ...others];
  }, [resolvedModelOptions]);

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

  const handleDrop = async (event: React.DragEvent<HTMLFormElement>) => {
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

    const dedupedPayloads: DroppedFilePayload[] = [];
    const seenPaths = new Set<string>();

    for (const p of payloads) {
      const key = p.fsPath || p.uri || p.name;
      if (!seenPaths.has(key)) {
        seenPaths.add(key);
        dedupedPayloads.push(p);
      }
    }

    try {
      onAttachFiles(dedupedPayloads);
    } catch {
    }
  };

  const toggleMode = () => {
    onSetMode(mode === "plan" ? "edit" : "plan");
  };

  return (
    <form
      className={`composer ${dragging ? "dragging" : ""}`}
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
      <SharedGradients />
      {attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map((attachment) => (
            <span key={attachment.id} className="composer-attachment-chip">
              {attachment.name}
              <button
                type="button"
                className="chip-remove"
                onClick={() => onRemoveAttachment(attachment.id)}
              >
                <X size={12} stroke="url(#primary-gradient)" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="composer-input-wrapper">
        <ContentEditableInput
          placeholder="Drop files/images, use @filename or /workflow"
          slashCommands={slashMentionData}
          mentionCandidates={fileMentionData}
          onSearchFiles={onSearchFiles}
          onSubmit={submit}
          renderSlashSuggestion={renderSlashSuggestion}
          renderFileSuggestion={renderFileSuggestion}
          prefill={prefill?.text}
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

          <ModelSelector
            modelId={modelId}
            modelOptions={sortedOptions}
            onSelect={onSetModel}
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