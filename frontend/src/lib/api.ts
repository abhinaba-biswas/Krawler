import axios from "axios";
import type {
  CrawlJob,
  CrawlRequest,
  CrawlResultsResponse,
  StatusResponse,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

const client = axios.create({
  baseURL: BASE,
  headers: { "Content-Type": "application/json" },
});

// Attach API key if configured
client.interceptors.request.use((cfg) => {
  const key = process.env.NEXT_PUBLIC_API_KEY;
  if (key) cfg.headers["X-API-Key"] = key;
  return cfg;
});

export const api = {
  // Submit a new crawl job
  async crawl(req: CrawlRequest): Promise<CrawlJob> {
    const { data } = await client.post<CrawlJob>("/api/crawl", req);
    return data;
  },

  // Poll job status
  async status(id: string): Promise<StatusResponse> {
    const { data } = await client.get<StatusResponse>(`/api/status/${id}`);
    return data;
  },

  // Get results
  async results(
    id: string,
    limit = 100,
    offset = 0
  ): Promise<CrawlResultsResponse> {
    const { data } = await client.get<CrawlResultsResponse>(
      `/api/result/${id}`,
      { params: { limit, offset } }
    );
    return data;
  },

  // List all jobs
  async jobs(limit = 50, offset = 0): Promise<CrawlJob[]> {
    const { data } = await client.get<CrawlJob[]>("/api/jobs", {
      params: { limit, offset },
    });
    return data;
  },

  // Cancel a job
  async cancel(id: string): Promise<void> {
    await client.post(`/api/cancel/${id}`);
  },

  // Build a download URL for the export endpoint (does not fire a request itself)
  exportUrl(id: string, format: "csv" | "xlsx" | "numbers"): string {
    const base = process.env.NEXT_PUBLIC_API_URL ?? "";
    const key = process.env.NEXT_PUBLIC_API_KEY ?? "";
    const params = new URLSearchParams({ format });
    if (key) params.set("x_api_key", key);
    return `${base}/api/export/${id}?${params.toString()}`;
  },

  // Health check
  async health(): Promise<{ status: string; checks: Record<string, string> }> {
    const { data } = await client.get("/health");
    return data;
  },
};
