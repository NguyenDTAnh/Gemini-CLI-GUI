# Gemini CLI Chat Extension

Interactive chat UI in VS Code powered by local Gemini CLI.

## Features (v1)

- Realtime streaming response
- Stop generation
- Retry last prompt
- Workspace session persistence
- File attachments
- Slash commands: /explain, /fix, /summarize, /tests

## Features (phase 2)

- Model switch directly in composer
- Plan/Edit mode toggle in composer
- Clear all sessions from session dropdown
- Drag and drop files into composer to attach quickly
- Drag and drop image files (encoded inline) into composer
- @mention attached files in prompts
- Custom slash workflows from settings
- Keyboard shortcut to insert selected editor context

## Configuration

- geminiCliChat.cliPath
- geminiCliChat.defaultArgs (supports {{prompt}} placeholder)
- geminiCliChat.availableModels
- geminiCliChat.customSlashCommands
- geminiCliChat.maxContextChars
- geminiCliChat.maxAttachedFiles
- geminiCliChat.maxDroppedFileBytes
- geminiCliChat.requestTimeoutMs
- geminiCliChat.responseLanguage
