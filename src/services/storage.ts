import type { WorkspaceState } from '@/types/domain'
import { createInitialState } from './mockData'
import { migrateWorkspace } from './recon'

const STORAGE_KEY = 'export-control-review-v1'

export function loadWorkspace(): WorkspaceState {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const initial = migrateWorkspace(createInitialState())
    saveWorkspace(initial)
    return initial
  }
  try {
    const parsed = JSON.parse(raw) as WorkspaceState
    const migrated = migrateWorkspace(parsed)
    if (JSON.stringify(migrated) !== JSON.stringify(parsed)) saveWorkspace(migrated)
    return migrated
  } catch {
    const initial = migrateWorkspace(createInitialState())
    saveWorkspace(initial)
    return initial
  }
}

export function saveWorkspace(state: WorkspaceState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

/**
 * 原子写入：保存前重新读取存储并校验 guard，
 * 校验失败说明已有并发写入（例如他人已放行），本次写入整体放弃。
 */
export function saveWorkspaceAtomic(
  state: WorkspaceState,
  guard: (stored: WorkspaceState) => boolean,
): void {
  const stored = loadWorkspace()
  if (!guard(stored)) {
    throw new Error('CONCURRENT_MODIFICATION')
  }
  saveWorkspace(state)
}

export function resetWorkspace(): WorkspaceState {
  const initial = migrateWorkspace(createInitialState())
  saveWorkspace(initial)
  return initial
}
