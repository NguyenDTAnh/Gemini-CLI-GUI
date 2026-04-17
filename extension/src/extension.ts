import * as vscode from "vscode";
import { GeminiChatController } from "./chat/GeminiChatController";
import { ChatSessionStore } from "./state/ChatSessionStore";
import { GeminiChatViewProvider } from "./webview/GeminiChatViewProvider";

let controller: GeminiChatController | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const store = new ChatSessionStore(context);
  controller = new GeminiChatController(context, store);

  const provider = new GeminiChatViewProvider(context.extensionUri, controller);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("geminiCliChat.views.main", provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("geminiCliChat.openChat", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.geminiCliChat");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("geminiCliChat.newSession", async () => {
      await controller?.createSession();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("geminiCliChat.stopGeneration", async () => {
      await controller?.stopActiveRequest();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("geminiCliChat.attachActiveFile", async () => {
      await controller?.attachFromActiveEditor();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("geminiCliChat.clearSessions", async () => {
      const choice = await vscode.window.showWarningMessage(
        "Clear all Gemini Chat sessions in this workspace?",
        { modal: true },
        "Clear"
      );

      if (choice === "Clear") {
        await controller?.clearSessions();
      }
    })
  );
}

export function deactivate(): void {
  controller?.dispose();
}
