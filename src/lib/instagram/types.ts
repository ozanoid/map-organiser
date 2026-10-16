/**
 * Instagram import shapes shared by the server (job + status route) and the
 * client (dialog hook). No server-only imports here.
 */

export type InstagramJobPhase = "reading" | "adding" | "done" | "failed";

export type InstagramJobError =
  | "invalid_url"
  | "post_unavailable"
  | "budget_exceeded"
  | "not_configured"
  | "service_error"
  | "stalled";

export type InstagramSkipReason = "chain_branch_unknown" | "no_evidence" | "ambiguous" | "closed";

export interface InstagramPostSummary {
  owner: string;
  ownerFullName: string | null;
  caption: string;
  locationName: string | null;
}

/** Stored on `import_jobs.meta` for kind = "instagram". */
export interface InstagramJobMeta {
  phase: InstagramJobPhase;
  shortcode: string;
  post?: InstagramPostSummary;
  error?: InstagramJobError;
}

/** Stored on `import_job_items.payload.instagram`. */
export interface InstagramItemInfo {
  label: string;
  sources: string[];
  rule: string | null;
  /** Human labels: "Tagged in photo", "Phone matches", … */
  evidence: string[];
  skip: string | null;
  sameNameCount: number;
  /** Prefill for the manual "Pick branch" search. */
  searchName: string;
}

export type InstagramItemStatus = "pending" | "added" | "already_saved" | "skipped" | "failed" | "removed";

export interface InstagramImportItemView {
  id: string;
  status: InstagramItemStatus;
  name: string;
  reason: string | null;
  evidence: string[];
  sameNameCount: number;
  searchName: string;
  place: {
    id: string;
    name: string;
    address: string | null;
    lat: number;
    lng: number;
    photoUrl: string | null;
  } | null;
}

export interface InstagramImportView {
  id: string;
  phase: InstagramJobPhase;
  error: InstagramJobError | null;
  postUrl: string;
  /** The user's "instagram" tag — handed to a manual "Pick branch" save. */
  tagId: string | null;
  post: InstagramPostSummary | null;
  createdAt: string;
  items: InstagramImportItemView[];
}
