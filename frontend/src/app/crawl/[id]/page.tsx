"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, CheckCircle2, Clock, Download, Globe, Loader2,
  RefreshCw, StopCircle, XCircle
} from "lucide-react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { StatusBadge } from "@/components/StatusBadge";
import { StatsCard } from "@/components/StatsCard";
import { ResultViewer } from "@/components/ResultViewer";
import { api } from "@/lib/api";
import type { CrawlResultItem, CrawlResultsResponse } from "@/lib/types";
import toast from "react-hot-toast";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export default function CrawlDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<CrawlResultItem | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const PAGE_SIZE = 20;

  const { data, refetch, isFetching } = useQuery<CrawlResultsResponse>({
    queryKey: ["crawl-results", id, page],
    queryFn: () => api.results(id, PAGE_SIZE, page * PAGE_SIZE),
    refetchInterval: (query) =>
      query.state.data && TERMINAL.has(query.state.data.job.status) ? false : 3000,
  });

  const job = data?.job;
  const results = data?.results ?? [];
  const total = data?.total ?? 0;

  // Auto-select first result
  useEffect(() => {
    if (results.length && !selected) setSelected(results[0]);
  }, [results]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCancel = async () => {
    if (!job) return;
    try {
      await api.cancel(id);
      toast.success("Job cancelled");
      refetch();
    } catch {
      toast.error("Could not cancel job");
    }
  };

  const handleExport = async (fmt: "csv" | "xlsx" | "numbers") => {
    setDownloading(fmt);
    try {
      const base = process.env.NEXT_PUBLIC_API_URL ?? "";
      const key = process.env.NEXT_PUBLIC_API_KEY ?? "";
      const url = `${base}/api/export/${id}?format=${fmt}`;
      const res = await fetch(url, {
        headers: key ? { "X-API-Key": key } : {},
      });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `crawl_${id.slice(0, 8)}.${fmt}`;
      a.click();
      URL.revokeObjectURL(href);
      toast.success(`Downloaded as .${fmt}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally {
      setDownloading(null);
    }
  };

  if (!job) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    );
  }

  const isTerminal = TERMINAL.has(job.status);

  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2"
          >
            <ArrowLeft className="w-4 h-4" /> Dashboard
          </Link>
          <h1 className="text-lg font-semibold text-gray-900 truncate">{job.url}</h1>
          <div className="flex items-center gap-3 mt-1">
            <StatusBadge status={job.status} />
            <span className="text-xs text-gray-400">
              {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
            </span>
            <span className="text-xs font-mono text-gray-400">{job.id.slice(0, 8)}…</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => refetch()} className="btn-secondary text-sm" disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {!isTerminal && (
            <button onClick={handleCancel} className="btn-danger text-sm">
              <StopCircle className="w-4 h-4" />
              Cancel
            </button>
          )}
          {/* Export buttons – shown when job is completed */}
          {job.status === "completed" && (
            <div className="flex items-center gap-1.5 border-l border-gray-200 pl-3 ml-1">
              {(["xlsx", "csv", "numbers"] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => handleExport(fmt)}
                  disabled={downloading !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all
                    bg-white border-gray-200 text-gray-700 hover:bg-brand-50 hover:border-brand-400 hover:text-brand-700
                    active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={`Download as .${fmt}`}
                >
                  {downloading === fmt
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Download className="w-3.5 h-3.5" />
                  }
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatsCard label="URLs crawled" value={job.stats.urls_crawled ?? 0} icon={Globe} color="blue" />
        <StatsCard label="URLs queued" value={job.stats.urls_queued ?? 0} icon={Clock} color="purple" />
        <StatsCard label="URLs failed" value={job.stats.urls_failed ?? 0} icon={XCircle} color="red" />
        <StatsCard label="Duration"
          value={job.stats.duration_s ? `${job.stats.duration_s}s` : isTerminal ? "—" : "Running…"}
          icon={CheckCircle2} color="green"
        />
      </div>

      {/* Error banner */}
      {job.error && (
        <div className="card p-4 border-red-200 bg-red-50 text-red-700 text-sm">
          <strong>Error:</strong> {job.error}
        </div>
      )}

      {/* Results split view */}
      {results.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* URL list */}
          <div className="card overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-200 text-xs font-medium text-gray-500">
              {total} pages crawled
            </div>
            <ul className="divide-y divide-gray-100 max-h-[600px] overflow-auto">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => setSelected(r)}
                    className={`w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors ${selected?.id === r.id ? "bg-brand-50 border-l-2 border-brand-600" : ""
                      }`}
                  >
                    <p className="text-xs font-medium text-gray-900 truncate">
                      {r.title || r.url}
                    </p>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{r.url}</p>
                    {r.error && (
                      <p className="text-xs text-red-500 mt-0.5 truncate">{r.error}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            {/* Pagination */}
            {total > PAGE_SIZE && (
              <div className="border-t border-gray-200 px-3 py-2 flex items-center justify-between">
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  className="text-xs text-brand-600 hover:underline disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="text-xs text-gray-400">
                  {page + 1} / {Math.ceil(total / PAGE_SIZE)}
                </span>
                <button
                  disabled={(page + 1) * PAGE_SIZE >= total}
                  onClick={() => setPage((p) => p + 1)}
                  className="text-xs text-brand-600 hover:underline disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>

          {/* Detail panel */}
          <div>
            {selected ? (
              <ResultViewer result={selected} />
            ) : (
              <div className="card p-8 text-center text-gray-400 text-sm">
                Select a page to view its content
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card p-12 text-center text-gray-400">
          {isTerminal ? (
            <p>No results were captured for this job.</p>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
              <p className="text-sm">Crawling in progress…</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
