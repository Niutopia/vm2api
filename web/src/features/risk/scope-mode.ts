import type { JevInterceptConfig, JevScopeAccount } from '@/types/panel-routing'
import { type AccountScope, scopeConfigured, scopeMatches } from './model'

/** 送审方式：全部 / 自己勾（按槽位）。 */
export type ScopeMode = 'all' | 'custom'

export type ScopeDraft = { mode: ScopeMode; picked: string[] }

function savedScope(data: JevInterceptConfig): AccountScope {
  return {
    account_platform_plans: data.account_platform_plans || [],
    account_ids: data.account_ids || [],
  }
}

/** Any narrowed scope (older plan picks such as claude:max, named accounts) shows as 自己勾 with today's matches. */
export function modeOf(scope: AccountScope): ScopeMode {
  return scopeConfigured(scope) ? 'custom' : 'all'
}

export function draftOf(data: JevInterceptConfig): ScopeDraft {
  const scope = savedScope(data)
  const mode = modeOf(scope)
  const accounts = data.account_scope?.accounts || []
  return {
    mode,
    picked:
      mode === 'custom' ? scopeMatches(scope, accounts).map((a) => a.id) : [],
  }
}

export function sameDraft(a: ScopeDraft, b: ScopeDraft) {
  if (a.mode !== b.mode) return false
  if (a.mode !== 'custom') return true
  return [...a.picked].sort().join('\n') === [...b.picked].sort().join('\n')
}

/** The body PUT /api/panel/jev-intercept receives for a draft. */
export function scopeBody(draft: ScopeDraft) {
  return {
    account_platform_plans: [],
    account_ids: draft.mode === 'custom' ? draft.picked : [],
    account_types: [],
    account_plan_types: [],
  }
}

export function reviewedUnder(
  draft: ScopeDraft,
  account: JevScopeAccount,
  openaiPlatform: boolean
) {
  if (draft.mode === 'all')
    return account.platform === 'gpt' ? openaiPlatform : true
  return draft.picked.includes(account.id)
}
