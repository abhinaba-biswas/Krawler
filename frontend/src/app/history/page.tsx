"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Search } from "lucide-react";
import { HistoryTable } from "@/components/HistoryTable";
import { api } from "@/lib/api";
import type { CrawlJob, JobStatus } from "@/lib/types";

const STATUS_OPTIONS: { value: JobStatus | "all"; label: string }[] = [
  { value: "all",       label: "All" },
  { value: "running",   label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed",    label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

export default function HistoryPage() {
  const [filter, setFilter] = useState<JobStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const { data: jobs = [], refetch, isFetching } = useQuery<CrawlJob[]>({
    queryKey: ["jobs-history", page],
    queryFn: () => api.jobs(PAGE_SIZE, page * PAGE_SIZE),
    refetchInterval: 10_000,
  });

  const filtered = jobs.filter((j) => {
    if (filter !== "all" && j.status !== filter) return false;
    if (search && !j.url.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Crawl History</h1>
          <p className="text-sm text-gray-500 mt-1">{jobs.length} jobs total</p>
        </div>
        <button
          onClick={() => refetch()}
          className="btn-secondary text-sm"
          disabled={isFetching}
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Status filter */}
        <div className="flex gap-1">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                filter === opt.value
                  ? "bg-brand-600 text-white border-brand-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-brand-400"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by URL…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-8 py-1.5 text-sm w-56"
          />
        </div>
      </div>

      <HistoryTable jobs={filtered} onRefresh={refetch} />

      {/* Pagination */}
      {jobs.length >= PAGE_SIZE && (
        <div className="flex justify-center gap-3">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="btn-secondary text-sm"
          >
            Previous
          </button>
          <span className="flex items-center text-sm text-gray-500">Page {page + 1}</span>
          <button
            disabled={jobs.length < PAGE_SIZE}
            onClick={() => setPage((p) => p + 1)}
            className="btn-secondary text-sm"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
