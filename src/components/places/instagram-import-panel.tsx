"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bookmark, Check, ChevronLeft, CircleAlert, Loader2, MapPin, MapPinOff, Pencil, Search } from "lucide-react";
import { useInstagramImport, usePickInstagramPlace, useStartInstagramImport } from "@/lib/hooks/use-instagram-import";
import { fold } from "@/lib/instagram/normalize";
import type { InstagramImportItemView, InstagramJobError, InstagramJobPhase } from "@/lib/instagram/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Instagram mode of the Add Place dialog.
 *
 * Nothing waits for a confirmation: the server adds every venue it can pin on
 * evidence (tag "instagram", status "want to go", post link as the note) and
 * this panel reports what happened — progress while it works, then the added
 * places with a per-place Remove, places already saved, and venues it could
 * not pin with the reason. For those, "Pick branch" lists the places Google
 * returned for them (a chain's branches) and adds the one the user picks the
 * same way; "Search" hands the name to the map search, aimed at the post's
 * area. The job lives on the server, so closing the dialog or refreshing the
 * page loses nothing.
 */

type LatLng = { lat: number; lng: number };
type PlaceOption = InstagramImportItemView["options"][number];

interface InstagramImportPanelProps {
  /** Post URL to import; a job is started for it when there is no jobId yet. */
  url: string | null;
  jobId: string | null;
  onJobId: (jobId: string) => void;
  onPhase?: (phase: InstagramJobPhase) => void;
  onClose: () => void;
  onShowOnMap?: (points: LatLng[]) => void;
  /** Hand a venue name to the map search, aimed at `near`; the context lets the
   *  place saved from there carry the post link and the "instagram" tag too. */
  onSearch?: (query: string, context: { postUrl: string; tagId: string | null; near: LatLng | null }) => void;
  /** The dialog opens on the title (not on the first "Remove"); switching
   *  between the list and a branch picker moves focus back to it. */
  titleRef?: RefObject<HTMLHeadingElement | null>;
}

function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <circle cx="12" cy="12" r="4" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

const ERROR_COPY: Record<InstagramJobError, string> = {
  invalid_url: "That isn't an Instagram post or reel link.",
  post_unavailable: "Couldn't open this post. It may be private or deleted.",
  budget_exceeded: "You've used this month's Instagram imports.",
  not_configured: "Instagram import isn't set up on this server.",
  service_error: "Something went wrong while reading this post.",
  stalled: "This took too long and stopped.",
};

/** Picked by the user in the branch picker (see the pick route). */
const PICKED = "Picked by you";

function skipCopy(item: InstagramImportItemView): string {
  switch (item.reason) {
    case "chain_branch_unknown":
      return item.sameNameCount > 1
        ? `${item.sameNameCount} branches · the post doesn't say which`
        : "Several branches · the post doesn't say which";
    case "ambiguous":
      return "More than one place matches";
    case "closed":
      return "Permanently closed on Google";
    case "no_evidence":
      return "Couldn't confirm which place this is";
    default:
      return item.reason ?? "Not added";
  }
}

function shortUrl(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
}

function centroid(points: LatLng[]): LatLng | null {
  if (points.length === 0) return null;
  return {
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length,
  };
}

const ORDER: Record<InstagramImportItemView["status"], number> = {
  added: 0,
  pending: 0,
  already_saved: 1,
  removed: 2,
  skipped: 3,
  failed: 3,
};

/** A filter box appears above this many options. */
const FILTER_FROM = 7;

function PlacePicker({
  options,
  pendingId,
  onPick,
}: {
  options: PlaceOption[];
  pendingId: string | null;
  onPick: (option: PlaceOption) => void;
}) {
  const [filter, setFilter] = useState("");
  const q = fold(filter);
  const visible = q ? options.filter((o) => fold(`${o.name} ${o.address}`).includes(q)) : options;

  return (
    <div className="space-y-2">
      {options.length >= FILTER_FROM && (
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by street or district"
          aria-label="Filter places"
          className="h-10"
        />
      )}
      <ul className="divide-y">
        {visible.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => onPick(o)}
              disabled={pendingId !== null}
              className="w-full min-h-11 flex items-start gap-3 px-1 py-2.5 text-left rounded-md cursor-pointer transition-colors duration-200 hover:bg-accent disabled:cursor-default disabled:opacity-60"
            >
              <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium truncate">{o.name}</span>
                <span className="block text-xs text-muted-foreground line-clamp-2">{o.address}</span>
              </span>
              {pendingId === o.id && (
                <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin text-muted-foreground" aria-label="Adding" />
              )}
            </button>
          </li>
        ))}
      </ul>
      {visible.length === 0 && (
        <p className="py-2 text-sm text-muted-foreground">Nothing matches &ldquo;{filter}&rdquo;.</p>
      )}
    </div>
  );
}

export function InstagramImportPanel({
  url,
  jobId,
  onJobId,
  onPhase,
  onClose,
  onShowOnMap,
  onSearch,
  titleRef,
}: InstagramImportPanelProps) {
  const queryClient = useQueryClient();
  // Read through a ref: the start can answer after this panel has unmounted.
  const onJobIdRef = useRef(onJobId);
  useEffect(() => {
    onJobIdRef.current = onJobId;
  }, [onJobId]);
  const start = useStartInstagramImport((id) => onJobIdRef.current(id));
  const pick = usePickInstagramPlace(jobId);
  const { data: view, isError: loadFailed } = useInstagramImport(jobId);
  const [removing, setRemoving] = useState<string | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);

  // Start once per URL. React may mount this twice in development; the server
  // also hands back the same job when the post was shared minutes ago.
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (jobId || !url || startedFor.current === url) return;
    startedFor.current = url;
    start.mutate(url);
  }, [jobId, url, start]);

  const phase = view?.phase ?? null;
  useEffect(() => {
    if (phase) onPhase?.(phase);
  }, [phase, onPhase]);

  // New pins land while the job runs — refresh the map's places as they do.
  const landed = view?.items.filter((i) => i.status === "added").length ?? 0;
  useEffect(() => {
    if (landed > 0 || phase === "done") queryClient.invalidateQueries({ queryKey: ["places"] });
  }, [landed, phase, queryClient]);

  function retry() {
    const postUrl = view?.postUrl || url;
    if (!postUrl) return;
    start.mutate(postUrl);
  }

  async function remove(item: InstagramImportItemView) {
    if (!item.place) return;
    setRemoving(item.id);
    try {
      const res = await fetch(`/api/places/${item.place.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await queryClient.invalidateQueries({ queryKey: ["instagram-import", jobId] });
      queryClient.invalidateQueries({ queryKey: ["places"] });
      toast.success(`${item.name} removed`);
    } catch {
      toast.error(`Couldn't remove ${item.name}`);
    } finally {
      setRemoving(null);
    }
  }

  /** Swap between the list and a branch picker; the dialog reads from the top again. */
  function showPicker(itemId: string | null) {
    setPickingId(itemId);
    requestAnimationFrame(() => titleRef?.current?.focus());
  }

  function choose(item: InstagramImportItemView, option: PlaceOption) {
    pick.mutate(
      { itemId: item.id, placeId: option.id },
      {
        onSuccess: (r) => {
          showPicker(null);
          if (r.status === "already_saved") toast.success(`${option.name} is already in your places · tag and link added`);
        },
        onError: (e) => toast.error(e.message),
      }
    );
  }

  // ---------- derived state ----------
  const items = [...(view?.items ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const onMap = items.filter((i) => (i.status === "added" || i.status === "already_saved") && i.place);
  const pendingItems = items.filter((i) => i.status === "pending");
  const pending = pendingItems.length;
  const shown = items.filter((i) => i.status !== "removed");
  const placeRows = shown.filter((i) => i.status !== "skipped" && i.status !== "failed");
  const single = phase === "done" && placeRows.length === 1 && shown.length === 1 ? placeRows[0] : null;
  const startError = start.isError ? start.error.message : null;
  const failed = phase === "failed" || loadFailed || !!startError;
  const working = !failed && (!view || phase === "reading" || phase === "adding");
  const empty = phase === "done" && placeRows.length === 0;
  // Closes by itself once the picked item stops being "skipped".
  const picking =
    shown.find((i) => i.id === pickingId && i.status === "skipped" && i.options.length > 0) ?? null;
  const pickPendingId = pick.isPending ? (pick.variables?.placeId ?? null) : null;

  /** Where to aim a map search for a skipped venue: where the post puts it,
   *  else among the places it could be, else among the post's other places. */
  const nearOf = (item: InstagramImportItemView | null): LatLng | null =>
    item?.near ?? centroid(item?.options ?? []) ?? centroid(onMap.map((i) => i.place!));
  const searchFor = (query: string, near: LatLng | null) =>
    onSearch?.(query, { postUrl: view?.postUrl || url || "", tagId: view?.tagId ?? null, near });

  let title = "Adding from Instagram";
  if (failed) title = "Couldn't add from this post";
  else if (picking) {
    title =
      picking.reason === "chain_branch_unknown"
        ? `Which ${picking.searchName || picking.name}?`
        : `Which ${picking.name}?`;
  } else if (phase === "adding") {
    title = pending > 0 && pendingItems.every((i) => i.evidence.includes(PICKED))
      ? `Adding ${pendingItems.map((i) => i.name).join(", ")}…`
      : `Adding ${pending + landed} place${pending + landed === 1 ? "" : "s"}…`;
  } else if (single) title = single.status === "already_saved" ? "Already in your places" : `${single.name} added`;
  else if (empty) title = "No places in this post";
  else if (phase === "done") {
    const added = placeRows.filter((i) => i.status === "added").length;
    title = added > 0 ? `${added} place${added === 1 ? "" : "s"} added` : "Already in your places";
  }

  const post = view?.post;
  const description = picking
    ? `${picking.options.length} ${picking.reason === "chain_branch_unknown" ? "branches" : picking.options.length === 1 ? "place" : "places"} · pick the one in the post`
    : post
      ? `@${post.owner}${post.caption ? ` · "${post.caption.split("\n")[0].slice(0, 90)}${post.caption.length > 90 ? "…" : ""}"` : ""}`
      : view?.postUrl || url
        ? shortUrl(view?.postUrl || url || "")
        : "Instagram post";

  return (
    <>
      <DialogHeader>
        <DialogTitle ref={titleRef} tabIndex={-1} className="flex items-center gap-2 outline-none">
          {failed ? (
            <CircleAlert className="h-5 w-5 text-destructive" aria-hidden="true" />
          ) : picking ? (
            <MapPin className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          ) : working ? (
            <InstagramGlyph className="h-5 w-5 text-pink-600" />
          ) : empty ? (
            <MapPinOff className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          ) : (
            <Check className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          )}
          <span className="truncate">{title}</span>
        </DialogTitle>
        <DialogDescription className="truncate">{description}</DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto min-h-0 space-y-3">
        {failed && (
          <p role="alert" className="text-sm text-muted-foreground">
            {startError ??
              (loadFailed
                ? "Couldn't load this import."
                : ERROR_COPY[view?.error ?? "service_error"])}
          </p>
        )}

        {!failed && (!view || phase === "reading") && (
          <ol role="status" aria-live="polite" className="space-y-3 py-2">
            <li className="flex items-center gap-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
              Reading the post and finding places
            </li>
            <li className="flex items-center gap-3 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              Adding them to your map
            </li>
            <li className="pt-2 text-xs text-muted-foreground">
              You can close this. It keeps going and lets you know when it&apos;s done.
            </li>
          </ol>
        )}

        {!failed && picking && (
          <PlacePicker
            key={picking.id}
            options={picking.options}
            pendingId={pickPendingId}
            onPick={(o) => choose(picking, o)}
          />
        )}

        {!picking && single && single.place && (
          <div className="space-y-3">
            <div className="relative h-36 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
              {single.place.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Storage URL, same as the other place cards
                <img src={single.place.photoUrl} alt={single.name} className="w-full h-full object-cover" />
              ) : single.photoPending ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading photo" />
              ) : (
                <MapPin className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              )}
            </div>
            <div>
              <h3 className="font-semibold">{single.name}</h3>
              {single.place.address && <p className="text-sm text-muted-foreground">{single.place.address}</p>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {single.evidence.map((e) => (
                <Badge key={e} className="bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {e}
                </Badge>
              ))}
              <Badge variant="secondary"># instagram</Badge>
              {single.status === "added" && <Badge variant="secondary">Want to go</Badge>}
            </div>
            {view?.postUrl && (
              <p className="text-xs text-muted-foreground truncate">Note: {shortUrl(view.postUrl)}</p>
            )}
            {single.status === "added" && (
              <button
                type="button"
                onClick={() => remove(single)}
                disabled={removing === single.id}
                className="min-h-11 text-xs text-muted-foreground underline underline-offset-2 cursor-pointer hover:text-foreground"
              >
                {removing === single.id ? "Removing…" : "Wrong place? Remove it"}
              </button>
            )}
          </div>
        )}

        {!picking && !single && view && (phase === "adding" || phase === "done") && shown.length > 0 && (
          <ul className="divide-y" aria-live="polite">
            {shown.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-2.5">
                <div className="h-10 w-10 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center">
                  {item.place?.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Storage URL thumbnail
                    <img src={item.place.photoUrl} alt="" className="h-full w-full object-cover" />
                  ) : item.status === "already_saved" ? (
                    <Bookmark className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  ) : item.status === "skipped" || item.status === "failed" ? (
                    <MapPinOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {item.status === "pending" && "Adding…"}
                    {item.status === "added" && [item.evidence.join(" · "), item.place?.address].filter(Boolean).join(" · ")}
                    {item.status === "already_saved" && "Already in your places · tag and link added"}
                    {item.status === "skipped" && skipCopy(item)}
                    {item.status === "failed" && `Couldn't add${item.reason ? ` · ${item.reason}` : ""}`}
                  </p>
                </div>
                {item.status === "pending" && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" aria-label="Adding" />
                )}
                {item.status === "added" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 h-11 sm:h-9 cursor-pointer text-muted-foreground"
                    onClick={() => remove(item)}
                    disabled={removing === item.id}
                  >
                    {removing === item.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Remove"}
                  </Button>
                )}
                {item.status === "skipped" && (item.options.length > 0 || onSearch) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 h-11 sm:h-9 cursor-pointer"
                    onClick={() =>
                      item.options.length > 0
                        ? showPicker(item.id)
                        : searchFor(item.searchName || item.name, nearOf(item))
                    }
                  >
                    {item.options.length === 0
                      ? "Search"
                      : item.reason === "chain_branch_unknown"
                        ? "Pick branch"
                        : "Choose"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {!picking && empty && shown.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No account, location tag or address in this post points to one specific place.
          </p>
        )}
      </div>

      <div className="flex gap-2 pt-3 border-t shrink-0">
        {picking ? (
          <>
            <Button variant="outline" className="flex-1 h-10 cursor-pointer" onClick={() => showPicker(null)}>
              <ChevronLeft className="h-4 w-4 mr-1" aria-hidden="true" />
              Back
            </Button>
            {onSearch && (
              <Button
                variant="outline"
                className="flex-1 h-10 cursor-pointer"
                onClick={() => searchFor(picking.searchName || picking.name, nearOf(picking))}
              >
                <Search className="h-4 w-4 mr-1" aria-hidden="true" />
                Search the map
              </Button>
            )}
          </>
        ) : working ? (
          <Button variant="outline" className="flex-1 h-10 cursor-pointer" onClick={onClose}>
            Continue in background
          </Button>
        ) : failed ? (
          <>
            <Button variant="outline" className="flex-1 h-10 cursor-pointer" onClick={onClose}>
              Close
            </Button>
            {view?.error !== "budget_exceeded" && view?.error !== "not_configured" && (view?.postUrl || url) && (
              <Button className="flex-1 h-10 cursor-pointer" onClick={retry} disabled={start.isPending}>
                {start.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" />}
                Try again
              </Button>
            )}
          </>
        ) : empty ? (
          <>
            <Button variant="outline" className="flex-1 h-10 cursor-pointer" onClick={onClose}>
              Close
            </Button>
            {onSearch && (
              <Button className="flex-1 h-10 cursor-pointer" onClick={() => searchFor("", null)}>
                <Search className="h-4 w-4 mr-1" aria-hidden="true" />
                Search manually
              </Button>
            )}
          </>
        ) : (
          <>
            {single?.place ? (
              <Link
                href={`/places/${single.place.id}`}
                className={cn(buttonVariants({ variant: "outline" }), "flex-1 h-10")}
              >
                <Pencil className="h-4 w-4 mr-1" aria-hidden="true" />
                Edit
              </Link>
            ) : (
              <Button variant="outline" className="flex-1 h-10 cursor-pointer" onClick={onClose}>
                Close
              </Button>
            )}
            {onShowOnMap && onMap.length > 0 ? (
              <Button
                className="flex-1 h-10 cursor-pointer"
                onClick={() => onShowOnMap(onMap.map((i) => ({ lat: i.place!.lat, lng: i.place!.lng })))}
              >
                <MapPin className="h-4 w-4 mr-1" aria-hidden="true" />
                {onMap.length > 1 ? "Show all on map" : "Show on map"}
              </Button>
            ) : (
              <Button className="flex-1 h-10 cursor-pointer" onClick={onClose}>
                Done
              </Button>
            )}
          </>
        )}
      </div>
    </>
  );
}
