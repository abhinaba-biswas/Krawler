"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SyntaxHighlighter } from "react-syntax-highlighter";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { ExternalLink, FileText, Code, Link as LinkIcon } from "lucide-react";
import { clsx } from "clsx";
import type { CrawlResultItem } from "@/lib/types";

interface Props {
  result: CrawlResultItem;
}

type Tab = "markdown" | "json" | "links" | "metadata";

export function ResultViewer({ result }: Props) {
  const [tab, setTab] = useState<Tab>("markdown");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "markdown", label: "Content",  icon: <FileText className="w-3.5 h-3.5" /> },
    { id: "json",     label: "JSON",     icon: <Code className="w-3.5 h-3.5" /> },
    { id: "links",    label: `Links (${result.links?.length ?? 0})`, icon: <LinkIcon className="w-3.5 h-3.5" /> },
    { id: "metadata", label: "Metadata", icon: <Code className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm text-gray-900 truncate">
            {result.title || result.url}
          </p>
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brand-600 hover:underline flex items-center gap-1 mt-0.5"
          >
            {result.url}
            <ExternalLink className="w-3 h-3 flex-shrink-0" />
          </a>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {result.status_code && (
            <span
              className={clsx(
                "badge text-xs",
                result.status_code < 300
                  ? "bg-green-50 text-green-700"
                  : result.status_code < 400
                  ? "bg-amber-50 text-amber-700"
                  : "bg-red-50 text-red-700"
              )}
            >
              {result.status_code}
            </span>
          )}
          <span className="badge bg-gray-100 text-gray-500 text-xs">
            depth {result.depth}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 px-4 gap-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "flex items-center gap-1.5 py-2.5 text-xs font-medium border-b-2 transition-colors",
              tab === t.id
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-4 max-h-[600px] overflow-auto">
        {tab === "markdown" && (
          <div className="prose prose-sm max-w-none">
            {result.content_markdown ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {result.content_markdown}
              </ReactMarkdown>
            ) : (
              <p className="text-gray-400 text-sm italic">No content extracted</p>
            )}
          </div>
        )}

        {tab === "json" && (
          <SyntaxHighlighter
            language="json"
            style={atomOneDark}
            customStyle={{ borderRadius: "0.5rem", fontSize: "0.75rem" }}
          >
            {JSON.stringify(
              {
                id: result.id,
                url: result.url,
                title: result.title,
                metadata: result.metadata,
                structured_data: result.structured_data,
                status_code: result.status_code,
                depth: result.depth,
                timestamp: result.timestamp,
              },
              null,
              2
            )}
          </SyntaxHighlighter>
        )}

        {tab === "links" && (
          <ul className="space-y-1">
            {result.links?.length ? (
              result.links.map((link) => (
                <li key={link}>
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brand-600 hover:underline break-all flex items-start gap-1"
                  >
                    <ExternalLink className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    {link}
                  </a>
                </li>
              ))
            ) : (
              <p className="text-gray-400 text-sm italic">No links found</p>
            )}
          </ul>
        )}

        {tab === "metadata" && (
          <SyntaxHighlighter
            language="json"
            style={atomOneDark}
            customStyle={{ borderRadius: "0.5rem", fontSize: "0.75rem" }}
          >
            {JSON.stringify(result.metadata ?? {}, null, 2)}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  );
}
