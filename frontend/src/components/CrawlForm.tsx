"use client";

import { useState } from "react";
import { Loader2, Play, Smartphone, Globe } from "lucide-react";
import toast from "react-hot-toast";
import type { CrawlMode, CrawlRequest, OutputFormat } from "@/lib/types";

interface Props {
  onSubmit: (req: CrawlRequest) => Promise<unknown>;
  loading: boolean;
}

const defaultReq: CrawlRequest = {
  url: "",
  depth: 3,
  mode: "web",
  render_js: false,
  output: "markdown",
  restrict_domain: true,
  respect_robots: true,
  screenshot: false,
  concurrency: 5,
  rate_limit_rps: 1,
};

export function CrawlForm({ onSubmit, loading }: Props) {
  const [req, setReq] = useState<CrawlRequest>(defaultReq);
  const [advanced, setAdvanced] = useState(false);

  const set = <K extends keyof CrawlRequest>(k: K, v: CrawlRequest[K]) =>
    setReq((prev) => ({ ...prev, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!req.url) return toast.error("Please enter a URL");
    try {
      await onSubmit(req);
      toast.success("Crawl job submitted!");
    } catch {
      // Error handled in hook
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Mode toggle */}
      <div className="flex gap-2">
        {(["web", "ios_app"] as CrawlMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => set("mode", m)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              req.mode === m
                ? "bg-brand-600 text-white border-brand-600"
                : "bg-white text-gray-600 border-gray-300 hover:border-brand-400"
            }`}
          >
            {m === "web" ? <Globe className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
            {m === "web" ? "Web Crawler" : "iOS App Store"}
          </button>
        ))}
      </div>

      {/* URL input */}
      <div>
        <label className="label">
          {req.mode === "web" ? "Seed URL" : "App Store URL"}
        </label>
        <input
          type="url"
          className="input"
          placeholder={
            req.mode === "web"
              ? "https://example.com"
              : "https://apps.apple.com/us/app/name/id123456789"
          }
          value={req.url}
          onChange={(e) => set("url", e.target.value)}
          required
        />
      </div>

      {/* Core options */}
      {req.mode === "web" && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <label className="label">Depth</label>
            <input
              type="number"
              min={0}
              max={10}
              className="input"
              value={req.depth}
              onChange={(e) => set("depth", +e.target.value)}
            />
          </div>
          <div>
            <label className="label">Output</label>
            <select
              className="input"
              value={req.output}
              onChange={(e) => set("output", e.target.value as OutputFormat)}
            >
              <option value="markdown">Markdown</option>
              <option value="html">HTML</option>
              <option value="json">JSON</option>
            </select>
          </div>
          <div>
            <label className="label">Concurrency</label>
            <input
              type="number"
              min={1}
              max={20}
              className="input"
              value={req.concurrency}
              onChange={(e) => set("concurrency", +e.target.value)}
            />
          </div>
          <div>
            <label className="label">Rate (req/s)</label>
            <input
              type="number"
              min={0.1}
              max={10}
              step={0.1}
              className="input"
              value={req.rate_limit_rps}
              onChange={(e) => set("rate_limit_rps", +e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Toggles */}
      {req.mode === "web" && (
        <div className="flex flex-wrap gap-4">
          {[
            { key: "render_js", label: "Render JS (Playwright)" },
            { key: "restrict_domain", label: "Restrict domain" },
            { key: "respect_robots", label: "Respect robots.txt" },
            { key: "screenshot", label: "Capture screenshots" },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4 rounded accent-brand-600"
                checked={req[key as keyof CrawlRequest] as boolean}
                onChange={(e) =>
                  set(key as keyof CrawlRequest, e.target.checked as never)
                }
              />
              <span className="text-sm text-gray-700">{label}</span>
            </label>
          ))}
        </div>
      )}

      {/* Advanced */}
      {req.mode === "web" && (
        <>
          <button
            type="button"
            className="text-xs text-brand-600 hover:underline"
            onClick={() => setAdvanced((v) => !v)}
          >
            {advanced ? "Hide" : "Show"} advanced options
          </button>
          {advanced && (
            <div>
              <label className="label">Proxy URL (optional)</label>
              <input
                type="text"
                className="input"
                placeholder="http://user:pass@host:port"
                value={req.proxy_url ?? ""}
                onChange={(e) =>
                  set("proxy_url", e.target.value || undefined)
                }
              />
            </div>
          )}
        </>
      )}

      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Play className="w-4 h-4" />
        )}
        {loading ? "Submitting…" : "Start Crawl"}
      </button>
    </form>
  );
}
