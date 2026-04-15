"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useLists, useCreateList } from "@/lib/hooks/use-lists";
import { useTrips, useCreateTrip, useDeleteTrip } from "@/lib/hooks/use-trips";
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
import { List, Plus, MapPin, Loader2, Compass, Calendar, Trash2 } from "lucide-react";
import { toast } from "sonner";

function ListsContent() {
  const { data: lists = [], isLoading: listsLoading } = useLists();
  const { data: trips = [], isLoading: tripsLoading } = useTrips();
  const createList = useCreateList();
  const createTrip = useCreateTrip();
  const deleteTrip = useDeleteTrip();
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [tripDialogOpen, setTripDialogOpen] = useState(false);
  const [newListName, setNewListName] = useState("");

  // Trip creation form
  const [tripName, setTripName] = useState("");
  const [tripStart, setTripStart] = useState("");
  const [tripEnd, setTripEnd] = useState("");
  const [tripSource, setTripSource] = useState<"empty" | "list">("empty");
  const [tripListId, setTripListId] = useState("");

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

  function handleCreateTrip(e: React.FormEvent) {
    e.preventDefault();
    if (!tripName.trim() || !tripStart || !tripEnd) return;
    createTrip.mutate(
      {
        name: tripName.trim(),
        start_date: tripStart,
        end_date: tripEnd,
        list_id: tripSource === "list" && tripListId ? tripListId : undefined,
      },
      {
        onSuccess: () => {
          toast.success("Trip created");
          setTripName("");
          setTripStart("");
          setTripEnd("");
          setTripSource("empty");
          setTripListId("");
          setTripDialogOpen(false);
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  function handleDeleteTrip(id: string, name: string) {
    if (!confirm(`Delete trip "${name}"?`)) return;
    deleteTrip.mutate(id, {
      onSuccess: () => toast.success("Trip deleted"),
    });
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Lists & Trips</h1>
      </div>

      <Tabs defaultValue="lists">
        <TabsList>
          <TabsTrigger value="lists" className="cursor-pointer shrink-0">
            <List className="h-4 w-4 mr-1.5" />
            My Lists
          </TabsTrigger>
          <TabsTrigger value="trips" className="cursor-pointer shrink-0">
            <Compass className="h-4 w-4 mr-1.5" />
            My Trips
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

        {/* ===== MY TRIPS TAB ===== */}
        <TabsContent value="trips" className="mt-4">
          <div className="flex justify-end mb-4">
            <Button size="sm" className="cursor-pointer" onClick={() => setTripDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Plan Trip
            </Button>
          </div>

          {tripsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-lg" />
              ))}
            </div>
          ) : trips.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Compass className="h-12 w-12 text-gray-300 dark:text-gray-600 mb-4" />
              <p className="text-gray-500 text-sm">
                No trips yet. Plan your first trip.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {trips.map((trip) => (
                <div key={trip.id} className="relative group">
                  <Link href={`/trips/${trip.id}`} prefetch={false}>
                    <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer">
                      <div className="flex items-start gap-3">
                        <div className="h-10 w-10 rounded-lg bg-emerald-50 dark:bg-emerald-950 flex items-center justify-center shrink-0">
                          <Compass className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-medium text-sm truncate">{trip.name}</h3>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Calendar className="h-3 w-3" />
                            {trip.day_count} day{trip.day_count !== 1 ? "s" : ""}
                            <span className="mx-0.5">·</span>
                            <MapPin className="h-3 w-3" />
                            {trip.place_count || 0} place{trip.place_count !== 1 ? "s" : ""}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {new Date(trip.start_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                            {" — "}
                            {new Date(trip.end_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          </p>
                        </div>
                      </div>
                    </Card>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 cursor-pointer text-red-500 hover:text-red-600"
                    onClick={(e) => { e.preventDefault(); handleDeleteTrip(trip.id, trip.name); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
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

      {/* Create trip dialog */}
      <Dialog open={tripDialogOpen} onOpenChange={setTripDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Plan a Trip</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateTrip} className="space-y-4">
            <Input
              placeholder="Trip name (e.g. London April 2026)"
              value={tripName}
              onChange={(e) => setTripName(e.target.value)}
              autoFocus
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Start date</label>
                <Input type="date" value={tripStart} onChange={(e) => setTripStart(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">End date</label>
                <Input type="date" value={tripEnd} onChange={(e) => setTripEnd(e.target.value)} />
              </div>
            </div>

            {tripStart && tripEnd && new Date(tripEnd) >= new Date(tripStart) && (
              <p className="text-xs text-muted-foreground">
                {Math.round((new Date(tripEnd).getTime() - new Date(tripStart).getTime()) / 86400000) + 1} days
              </p>
            )}

            {/* Place source */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Add places from</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="source"
                    checked={tripSource === "empty"}
                    onChange={() => setTripSource("empty")}
                    className="accent-emerald-600"
                  />
                  <span className="text-sm">Start empty (add later)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="source"
                    checked={tripSource === "list"}
                    onChange={() => setTripSource("list")}
                    className="accent-emerald-600"
                  />
                  <span className="text-sm">From an existing list</span>
                </label>
              </div>

              {tripSource === "list" && (
                <div className="mt-2 relative">
                  <select
                    value={tripListId}
                    onChange={(e) => setTripListId(e.target.value)}
                    className="w-full h-9 px-3 pr-8 text-sm border border-input rounded-md bg-background cursor-pointer appearance-none"
                  >
                    <option value="">Select a list...</option>
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.place_count || 0} places)
                      </option>
                    ))}
                  </select>
                  <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </div>
              )}
            </div>

            <Button
              type="submit"
              className="w-full cursor-pointer"
              disabled={!tripName.trim() || !tripStart || !tripEnd || createTrip.isPending || (tripSource === "list" && !tripListId)}
            >
              {createTrip.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Create Trip
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
