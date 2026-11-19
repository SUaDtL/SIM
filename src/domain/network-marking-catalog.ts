import type { Marking } from "../db/markings";

export interface MarkingFields {
  readonly fullLabel: string;
  readonly shortLabel: string;
  readonly base: Marking;
  readonly description: string | null;
}

export interface MarkingPreset extends MarkingFields {
  readonly source: "builtin";
  readonly key: string;
  readonly section: "quick" | "more" | "legacy";
  readonly keywords: readonly string[];
}

export interface CustomMarking extends MarkingFields {
  readonly source: "custom";
  readonly key: string;
}

export type NetworkMarking = MarkingPreset | CustomMarking;
export type MarkingSelection = Pick<NetworkMarking, "source" | "key">;

/** Curated Network Marking Picker v2 catalog in the handoff's declared order. */
export const MARKING_PRESETS: readonly MarkingPreset[] = [
  {
    source: "builtin",
    key: "u",
    fullLabel: "UNCLASSIFIED",
    shortLabel: "U",
    base: "UNCLASSIFIED",
    section: "quick",
    description: "Unclassified network context.",
    keywords: ["unclass", "public"],
  },
  {
    source: "builtin",
    key: "cui",
    fullLabel: "CUI",
    shortLabel: "CUI",
    base: "CUI",
    section: "quick",
    description: "Controlled Unclassified Information context (not a classified level).",
    keywords: ["controlled", "controlled unclassified"],
  },
  {
    source: "builtin",
    key: "c",
    fullLabel: "CONFIDENTIAL",
    shortLabel: "C",
    base: "CONFIDENTIAL",
    section: "quick",
    description: "Confidential network context.",
    keywords: ["conf"],
  },
  {
    source: "builtin",
    key: "s",
    fullLabel: "SECRET",
    shortLabel: "S",
    base: "SECRET",
    section: "quick",
    description: "Secret network context.",
    keywords: ["sec", "sipr"],
  },
  {
    source: "builtin",
    key: "sec-rel",
    fullLabel: "SEC-REL",
    shortLabel: "SEC-REL",
    base: "SECRET",
    section: "quick",
    description: "Secret Releasable. Common engineering/network shorthand, not a formal document banner.",
    keywords: ["secret releasable", "secret rel", "coalition", "rel"],
  },
  {
    source: "builtin",
    key: "s-nf",
    fullLabel: "SECRET//NOFORN",
    shortLabel: "S//NF",
    base: "SECRET",
    section: "quick",
    description: "Secret, no-foreign-dissemination context.",
    keywords: ["noforn", "no foreign"],
  },
  {
    source: "builtin",
    key: "ts",
    fullLabel: "TOP SECRET",
    shortLabel: "TS",
    base: "TOP SECRET",
    section: "quick",
    description: "Top Secret network context.",
    keywords: ["top secret", "ts"],
  },
  {
    source: "builtin",
    key: "ts-sci",
    fullLabel: "TS/SCI",
    shortLabel: "TS/SCI",
    base: "TOP SECRET",
    section: "quick",
    description: "Common network-environment shorthand for Top Secret/SCI; not a complete official banner.",
    keywords: ["sci", "ts sci", "jwics", "compartmented"],
  },
  {
    source: "builtin",
    key: "s-rel-fvey",
    fullLabel: "SECRET//REL TO USA, AUS, CAN, GBR, NZL",
    shortLabel: "S//REL FVEY",
    base: "SECRET",
    section: "more",
    description:
      "Illustrative specific releasability example using country trigraphs, not a claim that a network is authorized.",
    keywords: ["rel to", "releasable", "fvey", "five eyes", "usa", "aus", "can", "gbr", "nzl"],
  },
  {
    source: "builtin",
    key: "s-rel-gbr",
    fullLabel: "SECRET//REL TO USA, GBR",
    shortLabel: "S//REL GBR",
    base: "SECRET",
    section: "more",
    description: "Illustrative bilateral releasability-style label.",
    keywords: ["united kingdom", "uk", "britain", "rel to"],
  },
  {
    source: "builtin",
    key: "s-si",
    fullLabel: "SECRET//SI",
    shortLabel: "S//SI",
    base: "SECRET",
    section: "more",
    description: "Illustrative Secret with SI control-system context.",
    keywords: ["sci", "special intelligence"],
  },
  {
    source: "builtin",
    key: "ts-si-nf",
    fullLabel: "TOP SECRET//SI//NOFORN",
    shortLabel: "TS//SI//NF",
    base: "TOP SECRET",
    section: "more",
    description: "Illustrative Top Secret SI with NOFORN context.",
    keywords: ["sci", "si", "no foreign"],
  },
  {
    source: "builtin",
    key: "ts-tk",
    fullLabel: "TOP SECRET//TK",
    shortLabel: "TS//TK",
    base: "TOP SECRET",
    section: "more",
    description: "Illustrative Top Secret TK control-system context.",
    keywords: ["sci", "tk", "talent keyhole"],
  },
  {
    source: "builtin",
    key: "cui-cti",
    fullLabel: "CUI//SP-CTI",
    shortLabel: "CUI CTI",
    base: "CUI",
    section: "more",
    description: "Illustrative CUI Specified controlled technical information marking.",
    keywords: ["technical", "controlled technical information", "cti"],
  },
  {
    source: "builtin",
    key: "nato-c",
    fullLabel: "NATO CONFIDENTIAL",
    shortLabel: "NATO C",
    base: "CONFIDENTIAL",
    section: "more",
    description: "NATO confidentiality terminology, kept distinct in the displayed label.",
    keywords: ["nato", "alliance"],
  },
  {
    source: "builtin",
    key: "nato-s",
    fullLabel: "NATO SECRET",
    shortLabel: "NATO S",
    base: "SECRET",
    section: "more",
    description: "NATO Secret terminology, kept distinct in the displayed label.",
    keywords: ["nato", "alliance"],
  },
  {
    source: "builtin",
    key: "nato-ts",
    fullLabel: "COSMIC TOP SECRET",
    shortLabel: "COSMIC TS",
    base: "TOP SECRET",
    section: "more",
    description: "NATO Cosmic Top Secret terminology.",
    keywords: ["nato", "alliance", "cosmic"],
  },
  {
    source: "builtin",
    key: "s-sap",
    fullLabel: "SECRET · SAP-associated",
    shortLabel: "S · SAP",
    base: "SECRET",
    section: "more",
    description: "Descriptive diagram label for a Secret SAP-related environment, NOT a SAR/program banner.",
    keywords: ["sap", "special access", "special access program"],
  },
  {
    source: "builtin",
    key: "ts-sap",
    fullLabel: "TOP SECRET · SAP-associated",
    shortLabel: "TS · SAP",
    base: "TOP SECRET",
    section: "more",
    description: "Descriptive diagram label for a Top Secret SAP-related environment, NOT a SAR/program banner.",
    keywords: ["sap", "special access", "special access program"],
  },
  {
    source: "builtin",
    key: "fouo",
    fullLabel: "U//FOUO",
    shortLabel: "FOUO",
    base: "UNCLASSIFIED",
    section: "legacy",
    description:
      "Legacy FOUO notation; included only for mapping existing environments, not suggested for new official documents.",
    keywords: ["fouo", "for official use only"],
  },
];
