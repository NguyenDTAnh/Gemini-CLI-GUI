import { ChatMode } from "../types";

export interface SlashRouteResult {
  rawPrompt: string;
  transformedPrompt: string;
  command?: string;
  commandMeta?: SlashCommandDefinition;
  matchedArgs?: string[];
  valid: boolean;
}

export interface SlashCommandDefinition {
  name: string;
  hint: string;
  category: "analysis" | "generation" | "editing" | "debug";
  mode?: ChatMode;
  requiresAttachment?: boolean;
}

const COMMAND_REGISTRY: Record<string, SlashCommandDefinition> = {
  explain: {
    name: "explain",
    hint: "Explain the provided code and reasoning with concise actionable steps.",
    category: "analysis"
  },
  fix: {
    name: "fix",
    hint: "Identify issues and provide a concrete patch-level fix.",
    category: "editing",
    mode: "edit"
  },
  summarize: {
    name: "summarize",
    hint: "Summarize the key technical points and decisions.",
    category: "analysis"
  },
  tests: {
    name: "tests",
    hint: "Propose practical tests for this code including edge cases.",
    category: "debug"
  }
};

export class SlashCommandRouter {
  parse(prompt: string): SlashRouteResult {
    const trimmed = prompt.trim();
    if (!trimmed.startsWith("/")) {
      return {
        rawPrompt: prompt,
        transformedPrompt: prompt,
        valid: true
      };
    }

    const [head, ...rest] = trimmed.split(/\s+/);
    const command = head.slice(1).toLowerCase();
    const body = rest.join(" ").trim();

    const definition = COMMAND_REGISTRY[command];
    if (!definition) {
      return {
        rawPrompt: prompt,
        transformedPrompt: body || prompt,
        command,
        matchedArgs: body ? body.split(/\s+/) : [],
        valid: false
      };
    }

    const transformedPrompt = [
      `Command: /${command}`,
      `Instruction: ${definition.hint}`,
      "",
      "User input:",
      body
    ]
      .join("\n")
      .trim();

    return {
      rawPrompt: prompt,
      transformedPrompt,
      command,
      commandMeta: definition,
      matchedArgs: body ? body.split(/\s+/) : [],
      valid: true
    };
  }

  getSupportedCommands(): string[] {
    return Object.keys(COMMAND_REGISTRY).map((name) => `/${name}`);
  }

  getCommandRegistry(): Readonly<Record<string, SlashCommandDefinition>> {
    return COMMAND_REGISTRY;
  }
}
