import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { Attachment, DroppedFilePayload } from "../types";

export class ContextCollector {
  async pickAttachments(maxFiles: number): Promise<Attachment[]> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFolders: false,
      canSelectFiles: true,
      title: "Attach files to Gemini chat"
    });

    if (!uris || uris.length === 0) {
      return [];
    }

    return uris.slice(0, maxFiles).map((uri) => this.toAttachment(uri));
  }

  async attachFromActiveEditor(): Promise<Attachment | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }

    return this.toAttachment(editor.document.uri, editor.document.languageId);
  }

  fromDroppedFiles(files: DroppedFilePayload[]): Attachment[] {
    const attachments: Attachment[] = [];

    for (const file of files) {
      const fsPath = file.fsPath ?? this.fsPathFromUri(file.uri);
      if (!fsPath && !file.contentBase64) {
        continue;
      }

      const syntheticPath = `__inline__/${randomUUID()}-${file.name || "dropped-file"}`;
      const resolvedPath = fsPath ?? syntheticPath;
      const uri = file.uri ?? (fsPath ? vscode.Uri.file(fsPath).toString() : `inline://${encodeURIComponent(file.name || "dropped-file")}`);
      attachments.push({
        id: randomUUID(),
        name: file.name || resolvedPath.split("/").pop() || "untitled",
        fsPath: resolvedPath,
        uri,
        mimeType: file.mimeType,
        size: file.size,
        isImage: Boolean(file.mimeType?.startsWith("image/")),
        contentBase64: file.contentBase64
      });
    }

    return attachments;
  }

  async buildContext(attachments: Attachment[], maxChars: number): Promise<string> {
    if (attachments.length === 0) {
      return "";
    }

    const blocks: string[] = [];
    let used = 0;

    for (const attachment of attachments) {
      if (used >= maxChars) {
        break;
      }

      const remaining = Math.max(0, maxChars - used);
      if (attachment.contentBase64) {
        const inlineBlock = this.buildInlineBlock(attachment, remaining);
        if (!inlineBlock) {
          continue;
        }

        blocks.push(inlineBlock);
        used += inlineBlock.length;
        continue;
      }

      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(attachment.fsPath));
        const text = Buffer.from(bytes).toString("utf8");
        const clipped = text.slice(0, remaining);

        if (!clipped) {
          continue;
        }

        blocks.push([
          `## FILE: ${attachment.name}`,
          `PATH: ${attachment.fsPath}`,
          "```",
          clipped,
          "```"
        ].join("\n"));

        used += clipped.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        blocks.push(`## FILE: ${attachment.name}\n[unreadable: ${message}]`);
      }
    }

    return blocks.join("\n\n");
  }

  private toAttachment(uri: vscode.Uri, language?: string): Attachment {
    return {
      id: randomUUID(),
      name: uri.path.split("/").pop() || "untitled",
      fsPath: uri.fsPath,
      uri: uri.toString(),
      language
    };
  }

  private buildInlineBlock(attachment: Attachment, maxChars: number): string {
    if (maxChars <= 0 || !attachment.contentBase64) {
      return "";
    }

    if (attachment.isImage || attachment.mimeType?.startsWith("image/")) {
      const clipped = attachment.contentBase64.slice(0, Math.max(0, maxChars - 120));
      if (!clipped) {
        return "";
      }

      return [
        `## IMAGE: ${attachment.name}`,
        `MIME: ${attachment.mimeType || "image/unknown"}`,
        "```base64",
        clipped,
        "```"
      ].join("\n");
    }

    let decoded = "";
    try {
      decoded = Buffer.from(attachment.contentBase64, "base64").toString("utf8");
    } catch {
      return "";
    }

    const clipped = decoded.slice(0, Math.max(0, maxChars - 80));
    if (!clipped) {
      return "";
    }

    return [
      `## FILE: ${attachment.name}`,
      `PATH: ${attachment.fsPath}`,
      "```",
      clipped,
      "```"
    ].join("\n");
  }

  private fsPathFromUri(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }

    try {
      return vscode.Uri.parse(value).fsPath;
    } catch {
      return undefined;
    }
  }
}
