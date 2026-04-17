import { randomBytes } from "node:crypto";
import * as vscode from "vscode";

function nonce(): string {
  return randomBytes(16).toString("base64");
}

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptNonce = nonce();
  const cacheBuster = Date.now().toString();
  const scriptUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "assets", "index.js"))
    .with({ query: `v=${cacheBuster}` });
  const styleUri = webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "assets", "index.css"))
    .with({ query: `v=${cacheBuster}` });

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}'; font-src ${webview.cspSource};" />`,
    "  <title>Gemini CLI Chat</title>",
    `  <link rel="stylesheet" href="${styleUri}" />`,
    "</head>",
    "<body>",
    '  <div id="root"></div>',
    `  <script nonce="${scriptNonce}" src="${scriptUri}"></script>`,
    "</body>",
    "</html>"
  ].join("\n");
}
