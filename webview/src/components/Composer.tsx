import { FormEvent, useMemo, useState } from "react";
import { Paperclip, SendHorizonal, Square } from "lucide-react";

interface ComposerProps {
  running: boolean;
  onSubmit: (prompt: string) => void;
  onStop: () => void;
  onAttach: () => void;
}

const COMMANDS = ["/explain", "/fix", "/summarize", "/tests"];

export function Composer({ running, onSubmit, onStop, onAttach }: ComposerProps) {
  const [value, setValue] = useState("");

  const slashSuggestions = useMemo(() => {
    if (!value.startsWith("/")) {
      return [];
    }

    return COMMANDS.filter((item) => item.startsWith(value.toLowerCase()));
  }, [value]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const prompt = value.trim();
    if (!prompt) {
      return;
    }

    onSubmit(prompt);
    setValue("");
  };

  return (
    <form className="composer" onSubmit={submit}>
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Describe what to build"
        rows={4}
      />

      {slashSuggestions.length > 0 && (
        <div className="slash-suggestions">
          {slashSuggestions.map((item) => (
            <button
              key={item}
              type="button"
              className="chip-btn"
              onClick={() => setValue(`${item} `)}
            >
              {item}
            </button>
          ))}
        </div>
      )}

      <div className="composer-actions">
        <button type="button" className="ghost-btn" onClick={onAttach} title="Attach file">
          <Paperclip size={18} />
        </button>

        {!running && (
          <button type="submit" className="primary-btn" title="Send message">
            <SendHorizonal size={18} />
          </button>
        )}

        {running && (
          <button type="button" className="danger-btn" onClick={onStop} title="Stop generation">
            <Square size={18} />
          </button>
        )}
      </div>
    </form>
  );
}
