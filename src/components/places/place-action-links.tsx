"use client";

import { Button } from "@/components/ui/button";
import { CalendarCheck, ExternalLink, UtensilsCrossed } from "lucide-react";

/**
 * NF-06 (action leg) — book-online + local business links as buttons.
 * Extracted from places/[id]/page.tsx (v1.17.0 refactor). One deliberate
 * deviation: the old inline `{(a || b?.length) && …}` gate rendered a
 * literal "0" text node when links was an empty array (classic &&
 * footgun); the null-return below renders nothing.
 */
export function PlaceActionLinks({
  bookOnlineUrl,
  links,
}: {
  bookOnlineUrl?: string;
  links?: Array<{ type: string; url: string; title?: string }>;
}) {
  if (!bookOnlineUrl && !links?.length) return null;

  return (
    <section className="flex flex-wrap gap-2">
      {bookOnlineUrl && (
        <a href={bookOnlineUrl} target="_blank" rel="noopener noreferrer">
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer gap-1.5 text-xs"
          >
            <CalendarCheck className="h-3.5 w-3.5" />
            Book Online
          </Button>
        </a>
      )}
      {links?.map((link, i) => (
        <a key={i} href={link.url} target="_blank" rel="noopener noreferrer">
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer gap-1.5 text-xs"
          >
            {link.type === "menu" ? (
              <UtensilsCrossed className="h-3.5 w-3.5" />
            ) : (
              <ExternalLink className="h-3.5 w-3.5" />
            )}
            {link.title || link.type || "Link"}
          </Button>
        </a>
      ))}
    </section>
  );
}
