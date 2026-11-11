import type { Migration } from "../migrate";
import { initial } from "./0001-initial";
import { mapPositions } from "./0002-map-positions";

/** Forward-only, in order. Never edit a released migration; add a new one. */
export const MIGRATIONS: readonly Migration[] = [initial, mapPositions];
