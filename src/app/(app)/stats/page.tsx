"use client";

import { useStats } from "@/lib/hooks/use-stats";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Globe, Building2, Star, Bookmark, CalendarCheck, CheckCircle2, Heart } from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  AreaChart, Area,
} from "recharts";

const VISIT_STATUS_CONFIG = [
  { key: "want_to_go", label: "Want to Go", color: "#F59E0B", icon: Bookmark },
  { key: "booked", label: "Booked", color: "#3B82F6", icon: CalendarCheck },
  { key: "visited", label: "Visited", color: "#22C55E", icon: CheckCircle2 },
  { key: "favorite", label: "Favorite", color: "#EF4444", icon: Heart },
];

export default function StatsPage() {
  const { data: stats, isLoading } = useStats();

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-8 w-32" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        <Skeleton className="h-48 rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const { hero, visitStatus, byCategory, topCities, monthlyTrend, ratingDistribution } = stats;
  const visitedCount = (visitStatus.visited || 0) + (visitStatus.favorite || 0);
  const visitPct = hero.total > 0 ? Math.round((visitedCount / hero.total) * 100) : 0;

  return (
    <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold">Stats</h1>

      {/* Hero Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <HeroCard icon={MapPin} label="Places" value={hero.total} />
        <HeroCard icon={Globe} label="Countries" value={hero.countries} />
        <HeroCard icon={Building2} label="Cities" value={hero.cities} />
        <HeroCard icon={Star} label="Avg Rating" value={hero.avgRating || "—"} />
      </div>

      {/* Visit Progress */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Visit Progress</h3>
          <span className="text-xs text-muted-foreground">
            {visitedCount} / {hero.total} visited ({visitPct}%)
          </span>
        </div>
        <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${visitPct}%` }}
          />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {VISIT_STATUS_CONFIG.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.key} className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0" style={{ color: s.color }} />
                <div>
                  <p className="text-lg font-bold leading-none">{visitStatus[s.key] || 0}</p>
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Category Pie */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">By Category</h3>
          {byCategory.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">No data yet</p>
          ) : (
            <div className="flex items-center gap-4">
              <div className="w-40 h-40 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={byCategory}
                      dataKey="count"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={60}
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      {byCategory.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: "8px",
                        fontSize: "12px",
                        border: "1px solid var(--border)",
                        background: "var(--background, #fff)",
                        color: "var(--foreground, #000)",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1 overflow-y-auto max-h-40">
                {byCategory.map((cat) => (
                  <div key={cat.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="truncate flex-1">{cat.name}</span>
                    <span className="font-medium shrink-0">{cat.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* Top Cities */}
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Top Cities</h3>
          {topCities.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topCities} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis dataKey="city" type="category" width={80} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <Tooltip
                  contentStyle={{
                    borderRadius: "8px",
                    fontSize: "12px",
                    border: "1px solid var(--border)",
                    background: "var(--background, #fff)",
                    color: "var(--foreground, #000)",
                  }}
                />
                <Bar dataKey="count" fill="#059669" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Monthly Trend */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Monthly Trend</h3>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={monthlyTrend} margin={{ left: -20, right: 8, top: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
            <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" allowDecimals={false} />
            <Tooltip
              contentStyle={{
                borderRadius: "8px",
                fontSize: "12px",
                border: "1px solid var(--border)",
                background: "var(--background, #fff)",
                color: "var(--foreground, #000)",
              }}
            />
            <Area type="monotone" dataKey="count" stroke="#059669" fill="#059669" fillOpacity={0.15} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* Rating Distribution */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Rating Distribution</h3>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={ratingDistribution} margin={{ left: -20, right: 8, top: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="rating" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" tickFormatter={(v) => `${v}★`} />
            <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" allowDecimals={false} />
            <Tooltip
              contentStyle={{
                borderRadius: "8px",
                fontSize: "12px",
                border: "1px solid var(--border)",
                background: "var(--background, #fff)",
                color: "var(--foreground, #000)",
              }}
            />
            <Bar dataKey="count" fill="#F97316" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

function HeroCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number | string }) {
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className="h-10 w-10 rounded-lg bg-emerald-50 dark:bg-emerald-950 flex items-center justify-center shrink-0">
        <Icon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
      </div>
      <div>
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
      </div>
    </Card>
  );
}
