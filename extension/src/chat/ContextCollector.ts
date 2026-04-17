import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { Attachment } from "../types";

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

      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(attachment.fsPath));
        const text = Buffer.from(bytes).toString("utf8");
        const remaining = Math.max(0, maxChars - used);
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
}
