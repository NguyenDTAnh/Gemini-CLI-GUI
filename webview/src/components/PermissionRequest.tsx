import React from "react";
import { Check, X } from "lucide-react";
import { vscode } from "../vscode";

interface PermissionRequestProps {
  requestId: string;
  message: string;
  options: Array<{ label: string; value: string }>;
}

export function PermissionRequest({ requestId, message, options }: PermissionRequestProps) {
  const handleResponse = (value: string) => {
    vscode.postMessage({
      type: "permissionResponse",
      requestId,
      value,
    });
  };

  return (
    <div className="permission-request-container">
      <p className="permission-message">{message}</p>
      <div className="permission-actions">
        {options.map((option) => (
          <button
            key={option.value}
            className={`permission-btn ${option.value === 'accept' ? 'primary' : 'secondary'}`}
            onClick={() => handleResponse(option.value)}
          >
            {option.value === 'accept' ? <Check size={14} /> : <X size={14} />}
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
