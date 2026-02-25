import { clsx } from "clsx";
import type { JobStatus } from "@/lib/types";

const config: Record<JobStatus, { label: string; classes: string; dot: string }> = {
  pending:   { label: "Pending",   classes: "bg-gray-100 text-gray-600",   dot: "bg-gray-400" },
  queued:    { label: "Queued",    classes: "bg-blue-50 text-blue-700",    dot: "bg-blue-500" },
  running:   { label: "Running",   classes: "bg-amber-50 text-amber-700",  dot: "bg-amber-500 animate-pulse" },
  completed: { label: "Completed", classes: "bg-green-50 text-green-700",  dot: "bg-green-500" },
  failed:    { label: "Failed",    classes: "bg-red-50 text-red-700",      dot: "bg-red-500" },
  cancelled: { label: "Cancelled", classes: "bg-gray-100 text-gray-500",   dot: "bg-gray-400" },
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const { label, classes, dot } = config[status] ?? config.pending;
  return (
    <span className={clsx("badge", classes)}>
      <span className={clsx("w-1.5 h-1.5 rounded-full inline-block", dot)} />
      {label}
    </span>
  );
}
