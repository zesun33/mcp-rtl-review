export type RuleSeverity = 'error' | 'warning' | 'info';

export interface ReviewViolation {
  ruleId: string;
  severity: RuleSeverity;
  file: string;
  line: number;
  column?: number;
  message: string;
  fixSuggestion: string;
  snippet?: string;
}

export interface ReviewMetrics {
  modulesAnalyzed: number;
  alwaysBlocksAnalyzed: number;
  sequentialBlocks: number;
  combinationalBlocks: number;
  linesAnalyzed: number;
}

export interface ReviewSummary {
  passed: boolean;
  score: number;
  totalViolations: number;
  errors: number;
  warnings: number;
  info: number;
  violations: ReviewViolation[];
  metrics: ReviewMetrics;
  rulesChecked: string[];
}

export interface AssignmentViolation {
  file: string;
  line: number;
  variable: string;
  message: string;
  fixSuggestion: string;
}

export interface AssignmentCheckResult {
  passed: boolean;
  totalViolations: number;
  blockingInSeq: AssignmentViolation[];
  nonBlockingInComb: AssignmentViolation[];
}

export interface WidthMismatchViolation {
  file: string;
  line: number;
  expectedWidth?: number;
  actualWidth?: number;
  message: string;
  fixSuggestion: string;
}

export interface WidthCheckResult {
  passed: boolean;
  totalMismatches: number;
  widthMismatches: WidthMismatchViolation[];
}

export interface ToolchainInfo {
  runtime: string;
  image: string;
  verilatorVersion: string;
  rulesSupported: string[];
}

export interface AstLocation {
  fileId: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  raw: string;
}

export interface AstSenItem {
  edgeType?: 'POS' | 'NEG';
  signalName?: string;
}

export interface AstAssignment {
  type: 'blocking' | 'nonblocking';
  line: number;
  column: number;
  file: string;
  targetVar?: string;
}

export interface AstAlwaysBlock {
  loc: AstLocation;
  isSequential: boolean;
  senItems: AstSenItem[];
  assignments: AstAssignment[];
  hasResetMismatch?: boolean;
  resetMismatchDetails?: {
    resetName: string;
    expectedCondition: string;
    actualCondition: string;
    line: number;
  };
}

export interface AstModule {
  name: string;
  file: string;
  alwaysBlocks: AstAlwaysBlock[];
}

export interface ParsedAst {
  files: Map<string, string>; // fileId -> filename
  modules: AstModule[];
}
