import { LucideIcon } from "lucide-react";
import { clsx } from "clsx";

interface Props {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color?: "blue" | "green" | "red" | "amber" | "purple";
}

const colors = {
  blue:   "bg-blue-50 text-blue-600",
  green:  "bg-green-50 text-green-600",
  red:    "bg-red-50 text-red-600",
  amber:  "bg-amber-50 text-amber-600",
  purple: "bg-purple-50 text-purple-600",
};

export function StatsCard({ label, value, icon: Icon, color = "blue" }: Props) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={clsx("w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0", colors[color])}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 truncate">{label}</p>
        <p className="text-lg font-semibold text-gray-900 tabular-nums">{value}</p>
      </div>
    </div>
  );
}
