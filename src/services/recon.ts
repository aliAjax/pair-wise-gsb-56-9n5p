import type {
  ApprovalStep,
  BatchFileFreeze,
  BatchStatus,
  LicenseReceipt,
  MaterialFile,
  MaterialPackage,
  PageDigest,
  PageReview,
  ReconBatch,
  ReceiptStatus,
  WorkspaceState,
} from '@/types/domain'

const now = () => new Date().toISOString()

/** 稳定短摘要（FNV-1a），只用于派生脱敏摘要，不含正文内容。 */
export function digestOf(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0')
}

/** 逐页脱敏摘要：只取页码、分类、受控与脱敏标记、核对时间等元数据。 */
export function pageDigestOf(page: PageReview): string {
  return digestOf(
    [
      page.page,
      page.category,
      page.controlled ? 'C' : 'G',
      page.desensitized ? 'D' : 'R',
      page.reviewedAt ?? '',
    ].join('|'),
  )
}

/** 固化某文件的指定引用版本：生成逐页脱敏摘要，缺核对记录的页记入 missing。 */
export function freezeFileVersion(file: MaterialFile, versionId: string): BatchFileFreeze {
  const version = file.versions.find((item) => item.id === versionId)
  if (!version) {
    return {
      fileId: file.id,
      fileName: file.name,
      versionId,
      versionLabel: '版本缺失',
      hash: '-',
      pages: [],
      missing: [`首次送审引用的版本 ${versionId} 已不存在，无法回填脱敏摘要。`],
      complete: false,
    }
  }
  const pages: PageDigest[] = []
  const missing: string[] = []
  version.pages.forEach((page) => {
    if (!page.reviewedAt) {
      missing.push(`第 ${page.page} 页未完成逐页核对，缺脱敏摘要。`)
      return
    }
    pages.push({
      pageId: page.id,
      page: page.page,
      digest: pageDigestOf(page),
      controlled: page.controlled,
      desensitized: page.desensitized,
      reviewedAt: page.reviewedAt,
    })
  })
  return {
    fileId: file.id,
    fileName: file.name,
    versionId: version.id,
    versionLabel: version.label,
    hash: version.hash,
    pages,
    missing,
    complete: missing.length === 0,
  }
}

function snapshotRoute(route: ApprovalStep[]): ReconBatch['routeSnapshot'] {
  return route.map((step) => ({
    stepId: step.id,
    order: step.order,
    role: step.role,
    assignee: step.assignee,
    level: step.level,
  }))
}

export function batchCode(packageCode: string, round: number): string {
  return `RC-${packageCode.replace(/^EC-?/, '')}-R${round}`
}

/** 送审时固化：当前资料包版本 + 文件引用版本 + 逐页脱敏摘要 + 审批路线快照。 */
export function buildBatch(
  packageItem: MaterialPackage,
  files: MaterialFile[],
  packageVersionId: string,
  operator: string,
): ReconBatch {
  const frozenFiles = files
    .filter((file) => file.packageId === packageItem.id)
    .map((file) => freezeFileVersion(file, file.referencedVersionId))
  return {
    id: `batch-${crypto.randomUUID()}`,
    code: batchCode(packageItem.code, packageItem.currentRound),
    packageId: packageItem.id,
    round: packageItem.currentRound,
    packageVersionId,
    routeSnapshot: snapshotRoute(packageItem.approvalRoute),
    files: frozenFiles,
    digestComplete: frozenFiles.every((file) => file.complete),
    status: 'open',
    revision: 1,
    createdAt: now(),
    createdBy: operator,
  }
}

/**
 * 旧数据回填：按首次送审内容（首个资料包版本快照中的文件引用版本）
 * 补齐批次与逐页脱敏摘要；引用的版本或页核对记录缺失时标记不完整。
 */
export function backfillBatch(packageItem: MaterialPackage, files: MaterialFile[]): ReconBatch {
  const firstSubmission = packageItem.versions[0]
  const snapshotRefs = firstSubmission?.snapshot.activeFileVersions ?? {}
  const packageFiles = files.filter((file) => file.packageId === packageItem.id)
  const frozenFiles = packageFiles.map((file) =>
    freezeFileVersion(file, snapshotRefs[file.id] ?? file.referencedVersionId),
  )
  return {
    id: `batch-${crypto.randomUUID()}`,
    code: batchCode(packageItem.code, Math.max(1, packageItem.currentRound)),
    packageId: packageItem.id,
    round: Math.max(1, packageItem.currentRound),
    packageVersionId: firstSubmission?.id ?? 'pkg-version-missing',
    routeSnapshot: snapshotRoute(packageItem.approvalRoute),
    files: frozenFiles,
    digestComplete: frozenFiles.every((file) => file.complete),
    status: 'open',
    revision: 1,
    createdAt: firstSubmission?.createdAt ?? now(),
    createdBy: '系统回填',
  }
}

export function currentBatch(state: WorkspaceState, packageId: string): ReconBatch | undefined {
  return state.batches
    .filter((batch) => batch.packageId === packageId)
    .sort((left, right) => right.round - left.round || right.createdAt.localeCompare(left.createdAt))[0]
}

export function batchReceipts(state: WorkspaceState, batchId: string): LicenseReceipt[] {
  return state.receipts.filter((receipt) => receipt.batchId === batchId)
}

/** 回执声称的版本与批次固化版本逐项核对，返回不一致说明。 */
export function receiptMismatches(
  batch: ReconBatch,
  claim: { packageVersionId: string; fileVersions: Record<string, string> },
): string[] {
  const mismatches: string[] = []
  if (claim.packageVersionId !== batch.packageVersionId) {
    mismatches.push('回执的资料包版本与批次固化版本不一致')
  }
  batch.files.forEach((file) => {
    const claimed = claim.fileVersions[file.fileId]
    if (claimed !== file.versionId) {
      mismatches.push(`${file.fileName} 回执版本与批次固化版本（${file.versionLabel}）不一致`)
    }
  })
  return mismatches
}

function routeFullyApproved(packageItem: MaterialPackage): boolean {
  return (
    packageItem.approvalRoute.length > 0 &&
    packageItem.approvalRoute.every((step) => step.status === 'approved')
  )
}

/** 派生批次状态：已放行保持不变，否则按摘要、回执与审批路线重算。 */
export function deriveBatchStatus(
  batch: ReconBatch,
  receipts: LicenseReceipt[],
  packageItem: MaterialPackage,
): BatchStatus {
  if (batch.status === 'released') return 'released'
  const related = receipts.filter(
    (receipt) => receipt.batchId === batch.id && receipt.status !== 'invalid',
  )
  const verified = related.filter((receipt) => receipt.status === 'verified')
  const pending = related.filter((receipt) => receipt.status === 'pending')
  if (
    batch.digestComplete &&
    verified.length >= 1 &&
    pending.length === 0 &&
    routeFullyApproved(packageItem)
  ) {
    return 'ready'
  }
  return 'open'
}

export function refreshBatchStatus(state: WorkspaceState, packageId: string): void {
  const packageItem = state.packages.find((item) => item.id === packageId)
  if (!packageItem) return
  state.batches
    .filter((batch) => batch.packageId === packageId)
    .forEach((batch) => {
      batch.status = deriveBatchStatus(batch, state.receipts, packageItem)
    })
}

/** 放行前检查：任一条件不满足都不放行，返回原因列表。 */
export function releaseBlockers(
  batch: ReconBatch,
  receipts: LicenseReceipt[],
  packageItem: MaterialPackage,
): string[] {
  const blockers: string[] = []
  if (!batch.digestComplete) {
    const missing = batch.files
      .filter((file) => !file.complete)
      .flatMap((file) => file.missing.map((reason) => `${file.fileName}：${reason}`))
    blockers.push(`批次脱敏摘要未补齐（${missing[0] ?? '存在缺失'}${missing.length > 1 ? ` 等 ${missing.length} 项` : ''}），补不全不放行`)
  }
  const related = receipts.filter(
    (receipt) => receipt.batchId === batch.id && receipt.status !== 'invalid',
  )
  const pending = related.filter((receipt) => receipt.status === 'pending')
  if (pending.length) {
    blockers.push(`存在 ${pending.length} 张版本不符的待核回执，未核销前不放行`)
  }
  if (!related.some((receipt) => receipt.status === 'verified')) {
    blockers.push('尚无已核许可回执，回执晚到时批次保持对账中')
  }
  if (!routeFullyApproved(packageItem)) {
    blockers.push('审批路线尚未全部通过')
  }
  return blockers
}

/**
 * 文件换版后的失效重算：
 * - 依赖旧版本的待审批步骤（待处理/未开始）失效，并按原角色重算出新步骤；
 * - 已确认意见（通过/退回步骤）与许可记录（已核回执、额度）保留；
 * - 未核回执失效，开放批次中该文件的固化条目按新版本重算。
 */
export function invalidateForFileReversion(
  state: WorkspaceState,
  file: MaterialFile,
  newVersionId: string,
): { invalidatedSteps: number; invalidatedReceipts: number; recalculatedBatches: string[] } {
  const packageItem = state.packages.find((item) => item.id === file.packageId)
  if (!packageItem) return { invalidatedSteps: 0, invalidatedReceipts: 0, recalculatedBatches: [] }

  const pendingSteps = packageItem.approvalRoute.filter(
    (step) => step.status === 'active' || step.status === 'waiting',
  )
  pendingSteps.forEach((step) => {
    step.status = 'invalidated'
  })
  // 仅审批中的路线立即重算后续步骤；已退回的路线等重新送审时整体重建。
  const regenerated: ApprovalStep[] =
    packageItem.status === 'reviewing'
      ? pendingSteps.map((step, index) => ({
          id: `route-${crypto.randomUUID()}`,
          order: step.order,
          role: step.role,
          assignee: step.assignee,
          level: step.level,
          status: index === 0 ? 'active' : 'waiting',
          comment: '',
        }))
      : []
  packageItem.approvalRoute.push(...regenerated)
  packageItem.approvalRoute.sort((left, right) => left.order - right.order)

  let invalidatedReceipts = 0
  state.receipts
    .filter((receipt) => receipt.packageId === packageItem.id && receipt.status === 'pending')
    .forEach((receipt) => {
      receipt.status = 'invalid'
      receipt.invalidReason = `文件 ${file.name} 换版，未核回执失效重算。`
      invalidatedReceipts += 1
    })

  const recalculatedBatches: string[] = []
  state.batches
    .filter((batch) => batch.packageId === packageItem.id && batch.status !== 'released')
    .forEach((batch) => {
      const index = batch.files.findIndex((entry) => entry.fileId === file.id)
      if (index < 0) return
      batch.files[index] = freezeFileVersion(file, newVersionId)
      batch.digestComplete = batch.files.every((entry) => entry.complete)
      batch.revision += 1
      recalculatedBatches.push(batch.code)
    })

  refreshBatchStatus(state, packageItem.id)
  return { invalidatedSteps: pendingSteps.length, invalidatedReceipts, recalculatedBatches }
}

/**
 * 工作区迁移：保证批次与回执集合存在；
 * 对已送审但没有批次的旧数据，按首次送审内容回填批次。
 */
export function migrateWorkspace(state: WorkspaceState): WorkspaceState {
  state.batches ??= []
  state.receipts ??= []
  state.packages.forEach((packageItem) => {
    const submitted =
      packageItem.currentRound > 0 ||
      ['reviewing', 'returned', 'approved', 'licensed'].includes(packageItem.status)
    if (!submitted) return
    if (state.batches.some((batch) => batch.packageId === packageItem.id)) return
    state.batches.push(backfillBatch(packageItem, state.files))
  })
  state.packages.forEach((packageItem) => refreshBatchStatus(state, packageItem.id))
  return state
}

export const batchStatusLabels: Record<BatchStatus, string> = {
  open: '对账中',
  ready: '可放行',
  released: '已放行',
}

export const batchStatusColors: Record<BatchStatus, string> = {
  open: 'gold',
  ready: 'cyan',
  released: 'green',
}

export const receiptStatusLabels: Record<ReceiptStatus, string> = {
  pending: '待核',
  verified: '已核',
  invalid: '已失效',
}

export const receiptStatusColors: Record<ReceiptStatus, string> = {
  pending: 'warning',
  verified: 'success',
  invalid: 'default',
}
