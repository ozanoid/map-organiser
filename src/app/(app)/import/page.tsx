"use client";

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Upload, FileJson, Check, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; failed: number; total: number } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const queryClient = useQueryClient();

  const handleFile = useCallback((f: File) => {
    if (!f.name.endsWith(".json") && !f.name.endsWith(".geojson")) {
      toast.error("Please upload a .json or .geojson file");
      return;
    }
    setFile(f);
    setResult(null);
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  }

  async function handleImport() {
    if (!file) return;
    setImporting(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/places/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Import failed");
        return;
      }

      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["places"] });
      toast.success(`Imported ${data.imported} places!`);
    } catch {
      toast.error("Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  }

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
          <li>Choose GeoJSON format</li>
          <li>Export and download the file</li>
          <li>Upload the .json file below</li>
        </ol>
      </Card>

      {/* Upload area */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragActive
            ? "border-emerald-400 bg-emerald-50"
            : "border-gray-200 hover:border-gray-300"
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
                onClick={() => { setFile(null); setResult(null); }}
                className="cursor-pointer"
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
            <Upload className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">
              Drag & drop your GeoJSON file here
            </p>
            <p className="text-xs text-gray-400 mt-1">
              or click to browse
            </p>
            <input
              type="file"
              className="hidden"
              accept=".json,.geojson"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </label>
        )}
      </div>

      {/* Result */}
      {result && (
        <Card className="p-4">
          <div className="flex items-center gap-3">
            {result.failed === 0 ? (
              <Check className="h-8 w-8 text-emerald-600" />
            ) : (
              <AlertCircle className="h-8 w-8 text-orange-500" />
            )}
            <div>
              <p className="font-medium text-sm">
                Import complete
              </p>
              <p className="text-xs text-muted-foreground">
                {result.imported} imported
                {result.failed > 0 && `, ${result.failed} failed`}
                {" "}out of {result.total} places
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
