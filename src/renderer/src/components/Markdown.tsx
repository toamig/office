import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders markdown with GitHub-flavoured extensions. Links open outside the app. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
