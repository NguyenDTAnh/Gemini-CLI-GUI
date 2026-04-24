import { useMemo, useState } from "react";
import { parseDiff, Diff, Hunk } from "react-diff-view";
import { ChevronDown, ChevronRight, FileCode } from "lucide-react";
import "react-diff-view/style/index.css";

interface DiffBlockProps {
  diffText: string;
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
export function DiffBlock({ diffText }: DiffBlockProps) {
  const fileStats = useMemo<FileStats[]>(() => {
    try {
      const files = parseDiff(diffText);
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
    } catch {
      return [];
    }
  }, [diffText]);

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

  return (
    <div className={`diff-block ${isExpanded ? "expanded" : ""}`}>
      <button
        className="diff-block-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="diff-block-chevron">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <FileCode size={11} className="diff-block-file-icon" />
        <span className="diff-block-label">
          Edit{" "}
          <span className="diff-block-path" title={file.path}>
            {file.path.split("/").pop()}
          </span>
          <span className="diff-block-arrow">→</span>
          <span className="diff-block-type">{typeLabel}</span>
          <span className="diff-block-stats">
            (<span className="add">+{file.additions}</span>,{" "}
            <span className="del">-{file.deletions}</span>)
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
