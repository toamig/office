export interface Impact {
  everything: { web: string[]; electron: string[] };
  areas: Record<string, { web?: string[]; electron?: string[] }>;
}
export interface Selection {
  web: string[];
  electron: string[];
  fullWeb: boolean;
  fullElectron: boolean;
  unmapped: string[];
}
export function loadImpact(): Impact;
export function areaOf(file: string, impact: Impact): string | null;
export function selectSpecs(changed: string[], impact?: Impact): Selection;
