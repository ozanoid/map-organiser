"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PlansTab } from "@/components/plans/plans-tab";
import { useLists, useCreateList } from "@/lib/hooks/use-lists";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { List, Plus, MapPin, Loader2, Compass } from "lucide-react";
import { toast } from "sonner";

function ListsContent() {
  const { data: lists = [], isLoading: listsLoading } = useLists();
  const createList = useCreateList();
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [newListName, setNewListName] = useState("");

  // The open tab lives in the URL: coming back from a plan lands on Plans,
  // and a refresh keeps the tab.
  const router = useRouter();
  const tab = useSearchParams().get("tab") === "plans" ? "plans" : "lists";

  function handleCreateList(e: React.FormEvent) {
    e.preventDefault();
    if (!newListName.trim()) return;
    createList.mutate(
      { name: newListName.trim() },
      {
        onSuccess: () => {
          toast.success("List created");
          setNewListName("");
          setListDialogOpen(false);
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Lists & Plans</h1>
      </div>

      <Tabs
        value={tab}
        onValueChange={(next) =>
          router.replace(next === "plans" ? "/lists?tab=plans" : "/lists", { scroll: false })
        }
      >
        <TabsList>
          <TabsTrigger value="lists" className="cursor-pointer shrink-0">
            <List className="h-4 w-4 mr-1.5" />
            My Lists
          </TabsTrigger>
          <TabsTrigger value="plans" className="cursor-pointer shrink-0">
            <Compass className="h-4 w-4 mr-1.5" />
            Plans
          </TabsTrigger>
        </TabsList>

        {/* ===== MY LISTS TAB ===== */}
        <TabsContent value="lists" className="mt-4">
          <div className="flex justify-end mb-4">
            <Button size="sm" className="cursor-pointer" onClick={() => setListDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              New List
            </Button>
          </div>

          {listsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
          ) : lists.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <List className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-4" />
              <p className="text-gray-500 text-sm">
                No lists yet. Create a list to organize your places.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {lists.map((list) => (
                <Link key={list.id} href={`/lists/${list.id}`} prefetch={false}>
                  <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer">
                    <div className="flex items-start gap-3">
                      <div
                        className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: list.color + "20" }}
                      >
                        <List className="h-5 w-5" style={{ color: list.color }} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-medium text-sm truncate">{list.name}</h3>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3 w-3" />
                          {list.place_count || 0} place{list.place_count !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ===== PLANS TAB ===== */}
        <TabsContent value="plans" className="mt-4">
          <PlansTab />
        </TabsContent>
      </Tabs>

      {/* Create list dialog */}
      <Dialog open={listDialogOpen} onOpenChange={setListDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New List</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateList} className="space-y-4">
            <Input
              placeholder="List name"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              autoFocus
            />
            <Button type="submit" className="w-full cursor-pointer" disabled={!newListName.trim() || createList.isPending}>
              {createList.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
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
