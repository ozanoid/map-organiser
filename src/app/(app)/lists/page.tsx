"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useLists, useCreateList } from "@/lib/hooks/use-lists";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { List, Plus, MapPin, Loader2 } from "lucide-react";
import { toast } from "sonner";

function ListsContent() {
  const { data: lists = [], isLoading } = useLists();
  const createList = useCreateList();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;

    createList.mutate(
      { name: newName.trim() },
      {
        onSuccess: () => {
          toast.success("List created");
          setNewName("");
          setDialogOpen(false);
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Lists</h1>
        <Button
          size="sm"
          className="cursor-pointer"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="h-4 w-4 mr-1" />
          New List
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : lists.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <List className="h-12 w-12 text-gray-300 mb-4" />
          <p className="text-gray-500 text-sm">
            No lists yet. Create a list to organize your places.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {lists.map((list) => (
            <Link key={list.id} href={`/lists/${list.id}`}>
              <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-start gap-3">
                  <div
                    className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: list.color + "20" }}
                  >
                    <List
                      className="h-5 w-5"
                      style={{ color: list.color }}
                    />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-medium text-sm truncate">
                      {list.name}
                    </h3>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <MapPin className="h-3 w-3" />
                      {list.place_count || 0} place{list.place_count !== 1 ? "s" : ""}
                    </p>
                    {list.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                        {list.description}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Create list dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New List</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <Input
              placeholder="List name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
            <Button
              type="submit"
              className="w-full cursor-pointer"
              disabled={!newName.trim() || createList.isPending}
            >
              {createList.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Create List
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ListsPage() {
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-8 w-32" /></div>}>
      <ListsContent />
    </Suspense>
  );
}
