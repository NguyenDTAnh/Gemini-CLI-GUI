import { DroppedFilePayload } from "./types";

export interface WebkitFileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

export interface WebkitFileSystemFileEntry extends WebkitFileSystemEntry {
  file: (successCallback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void;
}

export interface WebkitFileSystemDirectoryEntry extends WebkitFileSystemEntry {
  createReader: () => {
    readEntries: (
      successCallback: (entries: WebkitFileSystemEntry[]) => void,
      errorCallback?: (error: DOMException) => void
    ) => void;
  };
}

export interface WebkitDataTransferItem {
  webkitGetAsEntry?: () => any;
  getAsFile: () => File | null;
}

export async function toDroppedPayload(file: File): Promise<DroppedFilePayload> {
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

export async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
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

export function parseDroppedPathPayloads(dataTransfer: DataTransfer): DroppedFilePayload[] {
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
