import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders markdown with GitHub-flavoured extensions. Links open outside the app. */
export function Markdown({ children, components, localLinks }: { children: string; components?: Components; localLinks?: boolean }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />, ...components }}
        urlTransform={localLinks ? (url) => /^(?:file:\/\/|[a-z]:[\\/])/i.test(url) ? url : defaultUrlTransform(url) : undefined}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
