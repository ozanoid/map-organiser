import { addPlacesTool } from "@/lib/assistant/tools/add-places";
import { createPlanTool } from "@/lib/assistant/tools/create-plan";
import { deleteVisitTool } from "@/lib/assistant/tools/delete-visit";
import { getLibraryOverview } from "@/lib/assistant/tools/get-library-overview";
import { getLists } from "@/lib/assistant/tools/get-lists";
import { getPlaces } from "@/lib/assistant/tools/get-places";
import { getPlans } from "@/lib/assistant/tools/get-plans";
import { getVisits } from "@/lib/assistant/tools/get-visits";
import { logVisitTool } from "@/lib/assistant/tools/log-visit";
import { rankPlaces } from "@/lib/assistant/tools/rank-places";
import { readReviews } from "@/lib/assistant/tools/read-reviews";
import { saveListTool } from "@/lib/assistant/tools/save-list";
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
  getLists,
  searchGoogleMaps,
  addPlacesTool,
  createPlanTool,
  updatePlanTool,
  saveListTool,
  logVisitTool,
  deleteVisitTool,
  updatePlaces,
] as unknown as AssistantTool[];
