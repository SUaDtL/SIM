import type { Migration } from "../migrate";
import { networkMarkings } from "./0008-network-markings";
import { initial } from "./0001-initial";
import { mapPositions } from "./0002-map-positions";
import { scenarios } from "./0003-scenarios";
import { reviewIssuance } from "./0007-review-issuance";
import { assessmentNotes } from "./0006-assessment-notes";
import { savedViewpoints } from "./0005-saved-viewpoints";
import { assessmentContext } from "./0004-assessment-context";

/** Forward-only, in order. Never edit a released migration; add a new one. */
export const MIGRATIONS: readonly Migration[] = [
  initial,
  mapPositions,
  scenarios,
  assessmentContext,
  savedViewpoints,
  assessmentNotes,
  reviewIssuance,
  networkMarkings,
];
