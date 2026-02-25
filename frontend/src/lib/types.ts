export type CrawlMode = "web" | "ios_app";
export type OutputFormat = "markdown" | "html" | "json";
export type JobStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface CrawlRequest {
  url: string;
  depth: number;
  mode: CrawlMode;
  render_js: boolean;
  output: OutputFormat;
  restrict_domain: boolean;
  respect_robots: boolean;
  screenshot: boolean;
  concurrency: number;
  rate_limit_rps: number;
  proxy_url?: string;
}

export interface CrawlJobStats {
  urls_queued: number;
  urls_crawled: number;
  urls_failed: number;
  duration_s?: number;
}

export interface CrawlJob {
  id: string;
  url: string;
  mode: CrawlMode;
  depth: number;
  render_js: boolean;
  output_format: OutputFormat;
  status: JobStatus;
  stats: CrawlJobStats;
  error?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface PageMetadata {
  description?: string;
  og_title?: string;
  og_description?: string;
  og_image?: string;
  og_type?: string;
  canonical?: string;
  keywords?: string;
  author?: string;
  [key: string]: unknown;
}

export interface CrawlResultItem {
  id: string;
  job_id: string;
  url: string;
  source_type: string;
  title?: string;
  content_markdown?: string;
  content_html?: string;
  metadata?: PageMetadata;
  links?: string[];
  structured_data?: Record<string, unknown>;
  status_code?: number;
  depth: number;
  error?: string;
  screenshot_key?: string;
  timestamp: string;
}

export interface CrawlResultsResponse {
  job: CrawlJob;
  results: CrawlResultItem[];
  total: number;
}

export interface StatusResponse {
  id: string;
  status: JobStatus;
  stats: CrawlJobStats;
  error?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}
