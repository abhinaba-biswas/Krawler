"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Globe, Loader2, XCircle, Layers } from "lucide-react";
import { CrawlForm } from "@/components/CrawlForm";
import { HistoryTable } from "@/components/HistoryTable";
import { StatsCard } from "@/components/StatsCard";
import { useCrawlSubmit } from "@/hooks/useCrawl";
import { api } from "@/lib/api";
import type { CrawlJob } from "@/lib/types";

export default function Dashboard() {
  const router = useRouter();
  const { submit, loading } = useCrawlSubmit();

  const {
    data: jobs = [],
    refetch,
  } = useQuery<CrawlJob[]>({
    queryKey: ["jobs"],
    queryFn: () => api.jobs(20),
    refetchInterval: 5000,
  });

  const handleSubmit = async (req: Parameters<typeof submit>[0]) => {
    const job = await submit(req);
    if (job) router.push(`/crawl/${job.id}`);
  };

  // Aggregate stats
  const totalCrawled = jobs.reduce((acc, j) => acc + (j.stats.urls_crawled ?? 0), 0);
  const completedCount = jobs.filter((j) => j.status === "completed").length;
  const failedCount = jobs.filter((j) => j.status === "failed").length;
  const runningCount = jobs.filter((j) => j.status === "running").length;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Krawler Dashboard</h1>
        <p className="text-gray-500 mt-1 text-sm">
          Distributed web crawling &amp; data extraction — web pages and iOS App Store
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatsCard label="Total URLs crawled" value={totalCrawled.toLocaleString()} icon={Globe} color="blue" />
        <StatsCard label="Completed jobs"      value={completedCount}               icon={CheckCircle2} color="green" />
        <StatsCard label="Failed jobs"         value={failedCount}                  icon={XCircle} color="red" />
        <StatsCard label="Running now"         value={runningCount}                 icon={Loader2} color="amber" />
      </div>

      {/* Crawl form */}
      <div className="card p-6">
        <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Layers className="w-4 h-4 text-brand-600" />
          New Crawl Job
        </h2>
        <CrawlForm onSubmit={handleSubmit} loading={loading} />
      </div>

      {/* Recent jobs */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">Recent Jobs</h2>
          <button
            onClick={() => refetch()}
            className="text-xs text-brand-600 hover:underline"
          >
            Refresh
          </button>
        </div>
        <HistoryTable jobs={jobs.slice(0, 10)} onRefresh={refetch} />
      </div>
    </div>
  );
}
