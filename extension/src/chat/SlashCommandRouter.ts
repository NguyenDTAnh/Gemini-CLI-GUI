export interface SlashRouteResult {
  rawPrompt: string;
  transformedPrompt: string;
  command?: string;
  valid: boolean;
}

const COMMAND_HINTS: Record<string, string> = {
  explain: "Explain the provided code and reasoning with concise actionable steps.",
  fix: "Identify issues and provide a concrete patch-level fix.",
  summarize: "Summarize the key technical points and decisions.",
  tests: "Propose practical tests for this code including edge cases."
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

    const hint = COMMAND_HINTS[command];
    if (!hint) {
      return {
        rawPrompt: prompt,
        transformedPrompt: body || prompt,
        command,
        valid: false
      };
    }

    const transformedPrompt = [
      `Command: /${command}`,
      `Instruction: ${hint}`,
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
      valid: true
    };
  }

  getSupportedCommands(): string[] {
    return Object.keys(COMMAND_HINTS).map((name) => `/${name}`);
  }
}
