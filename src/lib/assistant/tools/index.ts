import { createPlanTool } from "@/lib/assistant/tools/create-plan";
import { getLibraryOverview } from "@/lib/assistant/tools/get-library-overview";
import { getPlaces } from "@/lib/assistant/tools/get-places";
import { getPlans } from "@/lib/assistant/tools/get-plans";
import { getVisits } from "@/lib/assistant/tools/get-visits";
import { logVisitTool } from "@/lib/assistant/tools/log-visit";
import { rankPlaces } from "@/lib/assistant/tools/rank-places";
import { readReviews } from "@/lib/assistant/tools/read-reviews";
import { searchGoogleMaps } from "@/lib/assistant/tools/search-google-maps";
import { searchPlaces } from "@/lib/assistant/tools/search-places";
import type { AssistantTool } from "@/lib/assistant/tools/types";
import { updatePlaces } from "@/lib/assistant/tools/update-places";
import { updatePlanTool } from "@/lib/assistant/tools/update-plan";

/** Every assistant tool, in the order clients list them: reads, then writes. */
export const ASSISTANT_TOOLS: AssistantTool[] = [
  getLibraryOverview,
  searchPlaces,
  rankPlaces,
  getPlaces,
  readReviews,
  getVisits,
  getPlans,
  searchGoogleMaps,
  createPlanTool,
  updatePlanTool,
  logVisitTool,
  updatePlaces,
] as unknown as AssistantTool[];
