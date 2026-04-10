"use client";

import { useState } from "react";
import { useCreateList } from "@/lib/hooks/use-lists";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface InlineListCreatorProps {
  onCreated?: (listId: string) => void;
}

export function InlineListCreator({ onCreated }: InlineListCreatorProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const createList = useCreateList();

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    createList.mutate(
      { name: name.trim() },
      {
        onSuccess: (list) => {
          toast.success(`List "${list.name}" created`);
          onCreated?.(list.id);
          setName("");
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
      <PopoverContent className="w-56 p-3" align="start">
        <form onSubmit={handleCreate} className="space-y-3">
          <Input
            placeholder="List name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
          <Button
            type="submit"
            size="sm"
            className="w-full h-8 cursor-pointer"
            disabled={!name.trim() || createList.isPending}
          >
            {createList.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : null}
            Create
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
