export type MaterialCategory = 'drawing' | 'technical' | 'software'
export type PackageStatus =
  | 'draft'
  | 'validating'
  | 'reviewing'
  | 'returned'
  | 'approved'
  | 'licensed'
  | 'locked'
export type ApprovalLevel = 'standard' | 'enhanced' | 'senior'
export type FindingLevel = 'high' | 'medium' | 'low'
export type FindingType = 'missing-declaration' | 'escalation' | 'version-mismatch' | 'unclassified-page' | 'quota'

export interface PageReview {
  id: string
  page: number
  category: MaterialCategory
  controlled: boolean
  desensitized: boolean
  note: string
  reviewer: string
  reviewedAt?: string
}

export interface FileVersion {
  id: string
  label: string
  uploadedAt: string
  hash: string
  sizeKb: number
  pages: PageReview[]
  changeSummary: string
}

export interface MaterialFile {
  id: string
  packageId: string
  name: string
  kind: MaterialCategory
  activeVersionId: string
  referencedVersionId: string
  versions: FileVersion[]
}

export interface ApprovalStep {
  id: string
  order: number
  role: string
  assignee: string
  level: ApprovalLevel
  status: 'waiting' | 'active' | 'approved' | 'returned' | 'invalidated'
  comment: string
  decidedAt?: string
}

export interface PackageVersion {
  id: string
  label: string
  createdAt: string
  createdBy: string
  summary: string
  snapshot: {
    title: string
    category: MaterialCategory
    destination: string
    endUse: string
    technologyTags: string[]
    personnelScopes: string[]
    declarations: string[]
    activeFileVersions: Record<string, string>
  }
}

export interface ReviewComment {
  id: string
  packageId: string
  author: string
  content: string
  createdAt: string
  round: number
}

export interface MaterialPackage {
  id: string
  code: string
  title: string
  category: MaterialCategory
  applicant: string
  recipient: string
  destination: string
  endUse: string
  technologyTags: string[]
  personnelScopes: string[]
  declarations: string[]
  status: PackageStatus
  matchedRuleId?: string
  approvalRoute: ApprovalStep[]
  currentRound: number
  quotaUsed: number
  quotaLimit: number
  createdAt: string
  updatedAt: string
  versions: PackageVersion[]
}

export interface LicenseRule {
  id: string
  name: string
  categories: MaterialCategory[]
  destinations: string[]
  technologyTags: string[]
  personnelScopes: string[]
  requiredDeclarations: string[]
  approvalLevel: ApprovalLevel
  quotaLimit: number
  explanation: string
}

export interface ValidationFinding {
  id: string
  packageId: string
  type: FindingType
  level: FindingLevel
  message: string
  action: string
  ruleId?: string
}

export interface AuditEntry {
  id: string
  packageId?: string
  action: string
  target: string
  operator: string
  detail: string
  createdAt: string
}

export type BatchStatus = 'open' | 'ready' | 'released'
export type ReceiptStatus = 'pending' | 'verified' | 'invalid'

/** 逐页脱敏摘要：仅由页码与分类元数据派生，不含正文内容。 */
export interface PageDigest {
  pageId: string
  page: number
  digest: string
  controlled: boolean
  desensitized: boolean
  reviewedAt: string
}

/** 送审时固化的单个文件引用版本及其逐页脱敏摘要。 */
export interface BatchFileFreeze {
  fileId: string
  fileName: string
  versionId: string
  versionLabel: string
  hash: string
  pages: PageDigest[]
  /** 无法补齐摘要的原因（未核对页、版本缺失等）。 */
  missing: string[]
  complete: boolean
}

/** 对账批次：把资料包版本、文件引用版本、审批路线和许可回执接成可续办的整体。 */
export interface ReconBatch {
  id: string
  code: string
  packageId: string
  round: number
  packageVersionId: string
  routeSnapshot: {
    stepId: string
    order: number
    role: string
    assignee: string
    level: ApprovalLevel
  }[]
  files: BatchFileFreeze[]
  digestComplete: boolean
  status: BatchStatus
  /** 乐观锁版本号，双人同时确认时只放行一个。 */
  revision: number
  createdAt: string
  createdBy: string
  releasedAt?: string
  releasedBy?: string
}

/** 许可平台回执：可能晚到或重复，按回执号去重，版本不符停在待核。 */
export interface LicenseReceipt {
  id: string
  batchId: string
  packageId: string
  receiptNo: string
  packageVersionId: string
  fileVersions: Record<string, string>
  status: ReceiptStatus
  note: string
  receivedAt: string
  verifiedAt?: string
  invalidReason?: string
}

export interface WorkspaceState {
  packages: MaterialPackage[]
  files: MaterialFile[]
  rules: LicenseRule[]
  findings: ValidationFinding[]
  comments: ReviewComment[]
  audit: AuditEntry[]
  batches: ReconBatch[]
  receipts: LicenseReceipt[]
}

export interface VersionDiff {
  id: string
  field: string
  before: string
  after: string
  kind: 'package' | 'file'
}
