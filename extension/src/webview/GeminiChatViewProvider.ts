import * as vscode from "vscode";
import { GeminiChatController } from "../chat/GeminiChatController";
import { getWebviewHtml } from "./WebviewHtml";

export class GeminiChatViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: GeminiChatController
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")]
    };

    webviewView.webview.html = getWebviewHtml(webviewView.webview, this.extensionUri);
    this.controller.bindWebview(webviewView.webview);
  }
}
