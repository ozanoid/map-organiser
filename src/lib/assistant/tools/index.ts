import { getLibraryOverview } from "@/lib/assistant/tools/get-library-overview";
import { getPlaces } from "@/lib/assistant/tools/get-places";
import { rankPlaces } from "@/lib/assistant/tools/rank-places";
import { readReviews } from "@/lib/assistant/tools/read-reviews";
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
  updatePlaces,
] as unknown as AssistantTool[];
