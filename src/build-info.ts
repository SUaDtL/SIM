interface BuildIdentity {
  readonly version: string;
  readonly commit: string;
  readonly builtAt: string;
  readonly modified: boolean;
}

declare const __SIM_BUILD__: BuildIdentity;

export const BUILD = __SIM_BUILD__;

export function buildInformation(): string {
  return `SIM ${BUILD.version}\nBuild ${BUILD.commit}${BUILD.modified ? " (working tree changes)" : ""}\nBuilt ${BUILD.builtAt}`;
}
