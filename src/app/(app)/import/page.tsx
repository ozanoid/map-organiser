"use client";

import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Upload, FileJson, Check, Loader2, AlertCircle, CheckCircle2, X as XIcon } from "lucide-react";
import { toast } from "sonner";

interface ProgressItem {
  name: string;
  status: "enriched" | "imported" | "skipped";
  reason?: string;
}

interface ImportResult {
  imported: number;
  failed: number;
  enriched: number;
  total: number;
  skipped: { name: string; url: string | null; reason: string }[];
  importedPlaceIds: string[];
}

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; items: ProgressItem[] } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [reviewsEnriching, setReviewsEnriching] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);

  const handleFile = useCallback((f: File) => {
    if (!f.name.endsWith(".json") && !f.name.endsWith(".geojson") && !f.name.endsWith(".csv")) {
      toast.error("Please upload a .json, .geojson, or .csv file");
      return;
    }
    setFile(f);
    setResult(null);
    setProgress(null);
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  }

  async function handleImport() {
    if (!file) return;
    setImporting(true);
    setResult(null);
    setProgress(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/places/import", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          toast.error(data.error || "Import failed");
        } catch {
          toast.error("Import failed");
        }
        return;
      }

      // Read NDJSON stream
      const reader = res.body?.getReader();
      if (!reader) {
        toast.error("Stream not available");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      const progressItems: ProgressItem[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);

            if (msg.type === "start") {
              setProgress({ current: 0, total: msg.total, items: [] });
            } else if (msg.type === "progress") {
              const item: ProgressItem = {
                name: msg.name,
                status: msg.status,
                reason: msg.reason,
              };
              progressItems.push(item);
              setProgress({
                current: msg.current,
                total: msg.total,
                items: progressItems.slice(-4), // Show last 4
              });
            } else if (msg.type === "done") {
              setResult(msg as ImportResult);
              queryClient.invalidateQueries({ queryKey: ["places"] });
              toast.success(`Imported ${msg.imported} places!`);

              // Fire background review enrichment
              if (msg.importedPlaceIds?.length > 0) {
                enrichReviewsInBackground(msg.importedPlaceIds);
              }
            }
          } catch {}
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error("Import failed. Please try again.");
      }
    } finally {
      setImporting(false);
      abortRef.current = null;
    }
  }

  async function enrichReviewsInBackground(placeIds: string[]) {
    setReviewsEnriching(true);
    try {
      await fetch("/api/places/bulk-enrich-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeIds }),
      });
      queryClient.invalidateQueries({ queryKey: ["places"] });
    } catch {}
    setReviewsEnriching(false);
  }

  const pct = progress ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="p-4 lg:p-6 max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Import Places</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Import your saved places from Google Takeout
        </p>
      </div>

      {/* Instructions */}
      <Card className="p-4 text-sm space-y-2">
        <h3 className="font-medium">How to export from Google:</h3>
        <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
          <li>Go to takeout.google.com</li>
          <li>Deselect all, then select only &quot;Saved&quot; (Maps)</li>
          <li>Export as GeoJSON or CSV</li>
          <li>Download the file</li>
          <li>Upload the .json or .csv file below</li>
        </ol>
      </Card>

      {/* Upload area */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragActive
            ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950"
            : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        {file ? (
          <div className="space-y-3">
            <FileJson className="h-10 w-10 text-emerald-600 mx-auto" />
            <p className="text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {(file.size / 1024).toFixed(1)} KB
            </p>
            <div className="flex gap-2 justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setFile(null); setResult(null); setProgress(null); }}
                className="cursor-pointer"
                disabled={importing}
              >
                Change file
              </Button>
              <Button
                size="sm"
                onClick={handleImport}
                disabled={importing}
                className="cursor-pointer"
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Upload className="h-4 w-4 mr-1" />
                )}
                Import
              </Button>
            </div>
          </div>
        ) : (
          <label className="cursor-pointer block">
            <Upload className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-500">
              Drag & drop your GeoJSON or CSV file here
            </p>
            <p className="text-xs text-gray-400 mt-1">
              or click to browse
            </p>
            <input
              type="file"
              className="hidden"
              accept=".json,.geojson,.csv"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </label>
        )}
      </div>

      {/* Streaming progress */}
      {importing && progress && (
        <Card className="p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                Importing... {progress.current} / {progress.total}
              </span>
              <span className="text-muted-foreground text-xs">{pct}%</span>
            </div>

            {/* Progress bar */}
            <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>

            {/* Recent items */}
            <div className="space-y-1">
              {progress.items.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {item.status === "enriched" ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                  ) : item.status === "imported" ? (
                    <Check className="h-3 w-3 text-blue-500 shrink-0" />
                  ) : (
                    <XIcon className="h-3 w-3 text-red-400 shrink-0" />
                  )}
                  <span className="truncate">{item.name}</span>
                  {item.reason && (
                    <span className="text-muted-foreground shrink-0">— {item.reason}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Result */}
      {result && !importing && (
        <Card className="p-4">
          <div className="flex items-center gap-3">
            {result.failed === 0 ? (
              <Check className="h-8 w-8 text-emerald-600" />
            ) : (
              <AlertCircle className="h-8 w-8 text-orange-500" />
            )}
            <div>
              <p className="font-medium text-sm">Import complete</p>
              <p className="text-xs text-muted-foreground">
                {result.imported} imported, {result.enriched} enriched
                {result.failed > 0 ? `, ${result.failed} skipped` : ""}
                {" "}out of {result.total} places
              </p>
            </div>
          </div>

          {reviewsEnriching && (
            <div className="mt-3 flex items-center gap-2 text-xs text-emerald-600">
              <Loader2 className="h-3 w-3 animate-spin" />
              Enriching reviews in background...
            </div>
          )}

          {/* Skipped places */}
          {result.skipped && result.skipped.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Skipped places:
              </p>
              <div className="space-y-1.5">
                {result.skipped.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-900 rounded-md px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted-foreground ml-2">
                        ({s.reason})
                      </span>
                    </div>
                    {s.url && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline shrink-0 ml-2"
                      >
                        Maps
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
