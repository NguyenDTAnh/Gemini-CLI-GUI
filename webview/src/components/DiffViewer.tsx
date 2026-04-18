import { parseDiff, Diff, Hunk } from "react-diff-view";
import "react-diff-view/style/index.css";

interface DiffViewerProps {
  diffText: string;
}

export function DiffViewer({ diffText }: DiffViewerProps) {
  const files = parseDiff(diffText);

  return (
    <div className="diff-container">
      {files.map((file, index) => (
        <div key={index} className="diff-file">
          <div className="diff-file-header">
            <span>{file.newPath}</span>
          </div>
          <Diff viewType={file.type === "add" ? "split" : "unified"} diffType={file.type as any} hunks={file.hunks}>
            {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
          </Diff>
        </div>
      ))}
    </div>
  );
}
