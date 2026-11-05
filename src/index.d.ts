export type CheckKind = 'contains' | 'not_contains' | 'json_equals';

export interface CheckContains {
  file: string;
  kind: 'contains' | 'not_contains';
  value: string;
}

export interface CheckJsonEquals {
  file: string;
  kind: 'json_equals';
  path: string[];
  value: unknown;
}

export type RequirementCheck = CheckContains | CheckJsonEquals;

export interface DocumentationRequirement {
  id: string;
  component: string;
  title: string;
  mode: 'static' | 'manual' | 'out_of_scope';
  documents: string[];
  checks?: RequirementCheck[];
  reason?: string;
}

export interface DocumentationContractRegistry {
  schemaVersion: 1;
  scope: string;
  requirements: DocumentationRequirement[];
  docFolders?: string[];
  userDocPrefix?: string;
  boundaryRules?: BoundaryRule[];
  requireGit?: boolean;
}

export type BoundaryRule = [name: string, pattern: RegExp | { source: string; flags?: string }];

export interface BoundaryIssue {
  file: string;
  rule: string;
  line: number | null;
}

export interface SiteOutputResult {
  directory: string;
  passed: boolean;
  forbiddenFiles?: string[];
  indexSha256?: string;
  reason?: string;
}

export interface RequirementVerificationResult {
  id: string;
  component: string;
  title: string;
  documents: string[];
  status: 'matched_static' | 'mismatch' | 'unverified' | 'pending_manual' | 'out_of_scope';
  failures: Array<{ file?: string; kind?: string; reason?: string }>;
  reason?: string;
}

export interface DocumentCoverageItem {
  path: string;
  requirementIds: string[];
  modes: string[];
  staticAssertionIds: string[];
}

export interface ComponentSnapshot {
  path: string;
  head: string | null;
  dirty: boolean | null;
  registeredRequirements: number;
}

export interface DocumentationContractReport {
  schemaVersion: 1;
  generatedAt: string;
  scope: string;
  assurance: string;
  registrySha256: string;
  metrics: {
    registeredRequirements: number;
    matched_static: number;
    mismatch: number;
    unverified: number;
    pending_manual: number;
    out_of_scope: number;
    automaticVerificationRate: number | null;
    staticMatchRate: number | null;
    documentFiles: number | null;
    mappedDocumentFiles: number;
    documentFileMappingRate: number | null;
    documentFilesWithStaticAssertions: number;
    unmappedDocumentFiles: number | null;
    userDocumentationBoundaryIssues: number;
    repositoryMappingRate: number | null;
  };
  inventoryErrors: string[];
  snapshotComplete: boolean;
  evidenceStable: boolean;
  components: ComponentSnapshot[];
  documentCoverage: DocumentCoverageItem[];
  boundaryIssues: BoundaryIssue[];
  evidenceSha256: Record<string, string>;
  results: RequirementVerificationResult[];
  staticGatePassed: boolean;
  exhaustiveConformanceProven: false;
  siteOutput?: SiteOutputResult;
}

export interface DocumentationContractOptions {
  docFolders?: string[];
  userDocPrefix?: string;
  boundaryRules?: BoundaryRule[];
  requireGit?: boolean;
}

export const DEFAULT_BOUNDARY_RULES: BoundaryRule[];

export function inspectUserDocumentationBoundary(
  documents: Array<{ path: string; text: string }>,
  customRules?: BoundaryRule[],
  userDocPrefix?: string
): BoundaryIssue[];

export function verifyUserSiteOutput(
  root: string,
  directory: string
): SiteOutputResult;

export function verifyDocumentationContracts(
  root: string,
  registry: DocumentationContractRegistry,
  options?: DocumentationContractOptions
): DocumentationContractReport;

export function renderReport(report: DocumentationContractReport): string;
