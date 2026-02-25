"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { CrawlJob, CrawlRequest, StatusResponse } from "@/lib/types";

const POLL_INTERVAL_MS = 2500;
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function useCrawlSubmit() {
  const [job, setJob] = useState<CrawlJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (req: CrawlRequest) => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.crawl(req);
      setJob(result);
      return result;
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? "Failed to submit crawl";
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  return { submit, job, loading, error };
}

export function useCrawlStatus(jobId: string | null) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [polling, setPolling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    if (!jobId) return;
    try {
      const s = await api.status(jobId);
      setStatus(s);
      if (TERMINAL_STATUSES.has(s.status)) {
        setPolling(false);
      }
    } catch {
      // Silently ignore transient errors during polling
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    setPolling(true);
    poll();

    const schedule = () => {
      timerRef.current = setTimeout(async () => {
        await poll();
        if (!TERMINAL_STATUSES.has(status?.status ?? "")) {
          schedule();
        } else {
          setPolling(false);
        }
      }, POLL_INTERVAL_MS);
    };

    schedule();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const isTerminal = TERMINAL_STATUSES.has(status?.status ?? "");

  return { status, polling: polling && !isTerminal, isTerminal };
}
