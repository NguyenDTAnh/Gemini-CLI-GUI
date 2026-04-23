import React, { useState } from "react";
import { Check, X, Terminal } from "lucide-react";
import { vscode } from "../vscode";

interface PermissionRequestProps {
  requestId: string;
  message: string;
  options: Array<{ label: string; value: string }>;
}

export function PermissionRequest({ requestId, message, options }: PermissionRequestProps) {
  const [responded, setResponded] = useState(false);
  const [selectedValue, setSelectedValue] = useState<string | null>(null);

  const handleResponse = (value: string) => {
    if (responded) return;
    
    setResponded(true);
    setSelectedValue(value);
    
    vscode.postMessage({
      type: "permissionResponse",
      requestId,
      value,
    });
  };

  const isPrimary = (option: { label: string; value: string }) => {
    const label = option.label.toLowerCase();
    return label.includes('allow') || 
           label.includes('yes') || 
           label.includes('accept') || 
           label.includes('select') ||
           label.includes('chấp nhận') ||
           label.includes('đồng ý');
  };

  // Logic nhận diện command: Nếu title chứa các lệnh phổ biến hoặc có vẻ là đường dẫn/lệnh
  const isCommand = message.includes('run_shell_command') || 
                    message.includes('execute') || 
                    /^[a-z_]+: /.test(message);

  const renderMessage = () => {
    if (responded) {
      return (
        <div className="permission-confirmed">
          <span className="bullet">●</span> Bạn đã chọn: {options.find(o => o.value === selectedValue)?.label}
        </div>
      );
    }

    if (isCommand) {
      const parts = message.split(': ');
      const title = parts[0];
      const command = parts.slice(1).join(': ');

      return (
        <div className="command-request">
          <div className="command-title">
            <Terminal size={12} className="command-icon" />
            <span>{title}</span>
          </div>
          {command && <code className="command-code">{command}</code>}
        </div>
      );
    }

    return message;
  };

  return (
    <div className={`permission-request-container ${responded ? 'responded' : ''}`}>
      <div className="permission-message">
        {renderMessage()}
      </div>
      {!responded && (
        <div className="permission-actions">
          {options.map((option) => (
            <button
              key={option.value}
              className={`permission-btn ${isPrimary(option) ? 'primary' : 'secondary'}`}
              onClick={() => handleResponse(option.value)}
            >
              {isPrimary(option) ? <Check size={12} /> : <X size={12} />}
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
