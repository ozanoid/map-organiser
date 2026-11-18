import { getLibraryOverview } from "@/lib/assistant/tools/get-library-overview";
import { getPlaces } from "@/lib/assistant/tools/get-places";
import { getVisits } from "@/lib/assistant/tools/get-visits";
import { logVisitTool } from "@/lib/assistant/tools/log-visit";
import { rankPlaces } from "@/lib/assistant/tools/rank-places";
import { readReviews } from "@/lib/assistant/tools/read-reviews";
import { searchGoogleMaps } from "@/lib/assistant/tools/search-google-maps";
import { searchPlaces } from "@/lib/assistant/tools/search-places";
import type { AssistantTool } from "@/lib/assistant/tools/types";
import { updatePlaces } from "@/lib/assistant/tools/update-places";

/** Every assistant tool, in the order clients list them. */
export const ASSISTANT_TOOLS: AssistantTool[] = [
  getLibraryOverview,
  searchPlaces,
  rankPlaces,
  getPlaces,
  readReviews,
  getVisits,
  searchGoogleMaps,
  logVisitTool,
  updatePlaces,
] as unknown as AssistantTool[];
