"use client";

import { useState } from "react";
import { useCreateCategory } from "@/lib/hooks/use-categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

const PRESET_COLORS = [
  "#EF4444", "#F97316", "#F59E0B", "#22C55E", "#06B6D4",
  "#3B82F6", "#6366F1", "#8B5CF6", "#EC4899", "#14B8A6",
  "#A855F7", "#6B7280",
];

interface InlineCategoryCreatorProps {
  onCreated?: (categoryId: string) => void;
}

export function InlineCategoryCreator({ onCreated }: InlineCategoryCreatorProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#059669");
  const createCategory = useCreateCategory();

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    createCategory.mutate(
      { name: name.trim(), color },
      {
        onSuccess: (cat) => {
          toast.success(`Category "${cat.name}" created`);
          onCreated?.(cat.id);
          setName("");
          setColor("#059669");
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex items-center h-8 px-2 text-xs cursor-pointer text-emerald-600 hover:text-emerald-700 rounded-md hover:bg-accent"
      >
        <Plus className="h-3.5 w-3.5 mr-0.5" />
        New
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <form onSubmit={handleCreate} className="space-y-3">
          <Input
            placeholder="Category name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">Color</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="h-6 w-6 rounded-full cursor-pointer transition-transform"
                  style={{
                    backgroundColor: c,
                    outline: color === c ? "2px solid currentColor" : "none",
                    outlineOffset: "2px",
                  }}
                />
              ))}
            </div>
          </div>
          <Button
            type="submit"
            size="sm"
            className="w-full h-8 cursor-pointer"
            disabled={!name.trim() || createCategory.isPending}
          >
            {createCategory.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : null}
            Create
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
