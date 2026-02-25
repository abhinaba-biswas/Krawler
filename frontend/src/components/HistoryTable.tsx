"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ExternalLink, StopCircle } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import type { CrawlJob } from "@/lib/types";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

interface Props {
  jobs: CrawlJob[];
  onRefresh: () => void;
}

export function HistoryTable({ jobs, onRefresh }: Props) {
  const handleCancel = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await api.cancel(id);
      toast.success("Job cancelled");
      onRefresh();
    } catch {
      toast.error("Failed to cancel job");
    }
  };

  if (!jobs.length) {
    return (
      <div className="card p-12 text-center text-gray-400">
        <p className="text-lg font-medium">No crawl jobs yet</p>
        <p className="text-sm mt-1">Submit your first crawl from the dashboard</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600 w-8">#</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">URL</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Mode</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Crawled</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Started</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 w-24">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {jobs.map((job, i) => (
              <tr key={job.id} className="hover:bg-gray-50 transition-colors group">
                <td className="px-4 py-3 text-gray-400 font-mono text-xs">{i + 1}</td>
                <td className="px-4 py-3 max-w-xs">
                  <Link
                    href={`/crawl/${job.id}`}
                    className="text-brand-600 hover:underline font-medium truncate block"
                    title={job.url}
                  >
                    {job.url}
                  </Link>
                  <span className="text-xs text-gray-400 font-mono">
                    {job.id.slice(0, 8)}…
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="badge bg-gray-100 text-gray-600">
                    {job.mode === "ios_app" ? "iOS" : "Web"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={job.status} />
                </td>
                <td className="px-4 py-3 tabular-nums text-gray-700">
                  {job.stats.urls_crawled ?? 0}
                  {job.stats.urls_failed ? (
                    <span className="text-red-500 ml-1">
                      ({job.stats.urls_failed} failed)
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/crawl/${job.id}`}
                      className="text-brand-600 hover:text-brand-800 transition-colors"
                      title="View results"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Link>
                    {["queued", "running"].includes(job.status) && (
                      <button
                        onClick={(e) => handleCancel(job.id, e)}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        title="Cancel"
                      >
                        <StopCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
