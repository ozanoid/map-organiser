"use client";

import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAssistantStore } from "@/lib/stores/assistant-store";

/**
 * The assistant's replies: Markdown with links (Google Maps, the app's own
 * plans, lists and places), lists and emphasis. Raw HTML in a reply is
 * shown as text, never rendered. Links into the app stay in the app; any
 * other link opens in a new tab. A link into the app closes the panel, so
 * the page it opens isn't hidden behind it. Images are never loaded: a reply can carry
 * text from a web page, and an image URL would send whatever it holds to
 * that server the moment the reply showed — an image is a link instead.
 */

/** The path of a link into the app, or null. Resolved the way the browser
 *  would ("/\host" and "//host" are other sites). */
function appPath(href: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(href, window.location.origin);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

const components: Components = {
  a({ href, children }) {
    if (!href) return <span>{children}</span>;
    const internal = appPath(href);
    const className = "font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400";
    return internal ? (
      <Link href={internal} className={className} onClick={() => useAssistantStore.getState().setOpen(false)}>
        {children}
      </Link>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    const href = typeof src === "string" ? src : "";
    if (!/^https?:\/\//i.test(href)) return alt ? <span>{alt}</span> : null;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400">
        {alt || "Image"}
      </a>
    );
  },
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  // `start`: a list the model numbers from 3 ("3. gün…") reads 3, not 1.
  ol: ({ children, start }) => (
    <ol start={start} className="my-2 list-decimal space-y-1 pl-5">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  h1: ({ children }) => <p className="my-2 font-semibold">{children}</p>,
  h2: ({ children }) => <p className="my-2 font-semibold">{children}</p>,
  h3: ({ children }) => <p className="my-2 font-semibold">{children}</p>,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{children}</code>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b px-2 py-1 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b px-2 py-1 align-top">{children}</td>,
};

export function AssistantMarkdown({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
}
