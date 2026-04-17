# Gemini CLI Chat Extension

Interactive chat UI in VS Code powered by local Gemini CLI.

## Features (v1)

- Realtime streaming response
- Stop generation
- Retry last prompt
- Workspace session persistence
- File attachments
- Slash commands: /explain, /fix, /summarize, /tests

## Configuration

- geminiCliChat.cliPath
- geminiCliChat.defaultArgs (supports {{prompt}} placeholder)
- geminiCliChat.maxContextChars
- geminiCliChat.maxAttachedFiles
- geminiCliChat.requestTimeoutMs
- geminiCliChat.responseLanguage
