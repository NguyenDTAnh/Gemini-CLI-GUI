import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { ChatSession } from "../types";

interface StoredState {
  version: number;
  activeSessionId: string;
  sessions: ChatSession[];
}

const STORAGE_KEY = "geminiCliChat.sessions.v1";
const STORAGE_VERSION = 1;

export class ChatSessionStore {
  private state: StoredState;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.state = this.readState();
    this.state.sessions = this.state.sessions.map((session) => this.ensureDefaultAgent(session));
    this.state.sessions = this.state.sessions.map((session) => this.ensureDefaultMode(session));

    if (this.state.sessions.length === 0) {
      const initial = this.newSession("General");
      this.state.sessions = [initial];
      this.state.activeSessionId = initial.id;
    }
  }

  getSessions(): ChatSession[] {
    return this.state.sessions;
  }

  getActiveSessionId(): string {
    return this.state.activeSessionId;
  }

  getActiveSession(): ChatSession | undefined {
    return this.getSession(this.state.activeSessionId);
  }

  getSession(sessionId: string): ChatSession | undefined {
    return this.state.sessions.find((session) => session.id === sessionId);
  }

  async createSession(title = "New Session"): Promise<ChatSession> {
    const session = this.newSession(title);
    this.state.sessions = [session, ...this.state.sessions];
    this.state.activeSessionId = session.id;
    await this.persist();
    console.log("ChatSessionStore: createSession", {
      sessionId: session.id,
      title: session.title,
      activeSessionId: this.state.activeSessionId,
      sessionCount: this.state.sessions.length
    });
    return session;
  }

  async setActiveSession(sessionId: string): Promise<void> {
    const target = this.getSession(sessionId);
    if (!target) {
      return;
    }

    this.state.activeSessionId = target.id;
    await this.persist();
  }

  async upsertSession(nextSession: ChatSession): Promise<void> {
    const index = this.state.sessions.findIndex((session) => session.id === nextSession.id);
    if (index === -1) {
      this.state.sessions = [nextSession, ...this.state.sessions];
    } else {
      this.state.sessions[index] = nextSession;
    }

    if (!this.state.activeSessionId) {
      this.state.activeSessionId = nextSession.id;
    }

    await this.persist();
  }

  async removeAttachment(sessionId: string, attachmentId: string): Promise<ChatSession | undefined> {
    const session = this.getSession(sessionId);
    if (!session) {
      return undefined;
    }

    session.attachments = session.attachments.filter((item) => item.id !== attachmentId);
    session.updatedAt = Date.now();
    await this.upsertSession(session);
    return session;
  }

  async clearAll(): Promise<ChatSession> {
    const fresh = this.newSession("General");
    this.state.sessions = [fresh];
    this.state.activeSessionId = fresh.id;
    await this.persist();
    console.log("ChatSessionStore: clearAll", {
      activeSessionId: this.state.activeSessionId,
      sessionCount: this.state.sessions.length
    });
    return fresh;
  }

  async deleteSession(sessionId: string): Promise<ChatSession | undefined> {
    this.state.sessions = this.state.sessions.filter(s => s.id !== sessionId);
    
    if (this.state.sessions.length === 0) {
      const fresh = this.newSession("General");
      this.state.sessions = [fresh];
      this.state.activeSessionId = fresh.id;
    } else if (this.state.activeSessionId === sessionId) {
      this.state.activeSessionId = this.state.sessions[0].id;
    }
    
    await this.persist();
    return this.getSession(this.state.activeSessionId);
  }

  private newSession(title: string): ChatSession {
    const now = Date.now();
    return {
      id: randomUUID(),
      title,
      createdAt: now,
      updatedAt: now,
      attachments: [],
      messages: [],
      activeMode: "edit",
      defaultAgentId: "generalist"
    };
  }

  private ensureDefaultAgent(session: ChatSession): ChatSession {
    if (session.defaultAgentId && session.defaultAgentId.trim()) {
      return session;
    }

    return {
      ...session,
      defaultAgentId: "generalist"
    };
  }

  private ensureDefaultMode(session: ChatSession): ChatSession {
    if (session.activeMode) {
      return session;
    }

    return {
      ...session,
      activeMode: "edit"
    };
  }

  private readState(): StoredState {
    const fallback: StoredState = {
      version: STORAGE_VERSION,
      activeSessionId: "",
      sessions: []
    };

    const saved = this.context.workspaceState.get<StoredState>(STORAGE_KEY);
    if (!saved || saved.version !== STORAGE_VERSION || !Array.isArray(saved.sessions)) {
      return fallback;
    }

    return saved;
  }

  private async persist(): Promise<void> {
    await this.context.workspaceState.update(STORAGE_KEY, this.state);
  }
}
