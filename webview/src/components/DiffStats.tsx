import { useMemo, useState } from "react";
import { parseDiff } from "react-diff-view";
import { ChevronDown, ChevronRight, FileCode } from "lucide-react";

interface DiffStatsProps {
  diffTexts: string[];
}

export function DiffStats({ diffTexts }: DiffStatsProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const stats = useMemo(() => {
    const allFiles: any[] = [];
    diffTexts.forEach(text => {
      const files = parseDiff(text);
      files.forEach(file => {
        let additions = 0;
        let deletions = 0;
        file.hunks.forEach((hunk: any) => {
          hunk.changes.forEach((change: any) => {
            if (change.type === 'add') additions++;
            if (change.type === 'delete') deletions++;
          });
        });
        allFiles.push({
          path: file.newPath || file.oldPath,
          type: file.type,
          additions,
          deletions
        });
      });
    });
    return allFiles;
  }, [diffTexts]);

  if (stats.length === 0) return null;

  const totalAdditions = stats.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = stats.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="diff-stats-wrapper">
      <button 
        className="diff-stats-summary" 
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>Modified files: {stats.length}</span>
        <span className="diff-totals">
          <span className="add">+{totalAdditions}</span>
          <span className="del">-{totalDeletions}</span>
        </span>
      </button>

      {isExpanded && (
        <div className="diff-stats-details">
          {stats.map((file, idx) => (
            <div key={idx} className="diff-stats-file-item">
              <FileCode size={12} className="file-icon" />
              <span className="file-path">{file.path}</span>
              <div className="file-changes">
                {file.additions > 0 && <span className="add">+{file.additions}</span>}
                {file.deletions > 0 && <span className="del">-{file.deletions}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
