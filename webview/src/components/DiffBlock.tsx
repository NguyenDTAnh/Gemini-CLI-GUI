import { useMemo, useState } from "react";
import { parseDiff, Diff, Hunk } from "react-diff-view";
import { createTwoFilesPatch } from "diff";
import { Check, X } from "lucide-react";
import "react-diff-view/style/index.css";
import "./DiffBlockOverrides.css";

interface FileDiffData {
  path: string;
  oldText: string;
  newText: string;
}

interface DiffBlockProps {
  diffText: string;
  fileDiffData?: FileDiffData;
}

interface FileStats {
  path: string;
  type: string;
  additions: number;
  deletions: number;
  hunks: any[];
}

/**
 * DiffBlock - Collapsible inline diff viewer
 * Render mỗi file thay đổi thành 1 block riêng, collapse/expand giống thought-block
 * Hỗ trợ multiple files trong cùng 1 diff text
 */
export function DiffBlock({ diffText, fileDiffData }: DiffBlockProps) {
  const resolvedDiff = useMemo(() => {
    if (fileDiffData?.path) {
      try {
        const name = fileDiffData.path.split("/").pop() || fileDiffData.path;
        const rawPatch = createTwoFilesPatch(
          `a/${name}`, `b/${name}`,
          fileDiffData.oldText, fileDiffData.newText,
          "", "", { context: 3 }
        );
        // react-diff-view parseDiff yêu cầu header `diff --git` và không hiểu dòng `===`
        // Strip dòng `===` và prepend git header để parseDiff hoạt động đúng
        const cleaned = rawPatch
          .split("\n")
          .filter(line => !/^={3,}$/.test(line.trim()))
          .join("\n");
        return `diff --git a/${name} b/${name}\n${cleaned}`;
      } catch (e) {
        console.error("Failed to create diff patch:", e);
        return "";
      }
    }
    return diffText;
  }, [diffText, fileDiffData]);

  const fileStats = useMemo<FileStats[]>(() => {
    if (!resolvedDiff) return [];
    try {
      const files = parseDiff(resolvedDiff);
      return files.map((file) => {
        let additions = 0;
        let deletions = 0;
        file.hunks.forEach((hunk: any) => {
          hunk.changes.forEach((change: any) => {
            if (change.type === "insert") additions++;
            if (change.type === "delete") deletions++;
          });
        });
        return {
          path: file.newPath || file.oldPath || "unknown",
          type: file.type,
          additions,
          deletions,
          hunks: file.hunks,
        };
      });
    } catch (e) {
      console.error("Failed to parse diff:", e);
      return [];
    }
  }, [resolvedDiff]);

  if (fileStats.length === 0) return null;

  return (
    <div className="diff-block-group">
      {fileStats.map((file, idx) => (
        <DiffFileBlock key={`${file.path}-${idx}`} file={file} />
      ))}
    </div>
  );
}

/** Block đơn cho 1 file diff — collapsible với animation slide */
function DiffFileBlock({ file }: { file: FileStats }) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Map diff type sang label hiển thị
  const typeLabel = file.type === "delete" ? "Deleted" : file.type === "add" ? "Created" : "Accepted";
  const statusIcon = file.type === "delete" ? (
    <X size={14} style={{ color: "var(--danger)" }} />
  ) : file.type === "add" ? (
    <Check size={14} style={{ color: "var(--ok)" }} />
  ) : (
    <Check size={14} style={{ color: "var(--ok)" }} />
  );

  return (
    <div className={`diff-block ${isExpanded ? "expanded" : ""}`}>
      <button
        className="diff-block-summary progress-status"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <span className="progress-icon diff-block-status-icon">
          {statusIcon}
        </span>
        <span className="diff-block-summary-text progress-text">
          <span className="diff-block-summary-main shiny-text">
            <span className="diff-block-summary-action">Edit</span>
            <span className="diff-block-path" title={file.path}>
              {file.path.split("/").pop()}
            </span>
            <span className="diff-block-arrow">→</span>
            <span className="diff-block-type">{typeLabel}</span>
          </span>
          <span className="diff-block-stats">
            <span className="diff-block-stat add">+{file.additions}</span>
            <span className="diff-block-stat del">-{file.deletions}</span>
          </span>
        </span>
      </button>

      <div className="diff-block-content-wrapper">
        <div className="diff-block-content">
          <div className="diff-container">
            <Diff
              viewType="unified"
              diffType={file.type as any}
              hunks={file.hunks}
            >
              {(hunks) =>
                hunks.map((hunk) => (
                  <Hunk key={hunk.content} hunk={hunk} />
                ))
              }
            </Diff>
          </div>
        </div>
      </div>
    </div>
  );
}
