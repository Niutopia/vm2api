import type { JevScopeAccount } from '@/types/panel-routing'
import { describe, expect, it } from 'vitest'
import { modeOf, reviewedUnder, scopeBody } from './scope-mode'

const slot = (
  id: string,
  scope_key: string,
  extra: Partial<JevScopeAccount> = {}
): JevScopeAccount => ({
  id,
  email: null,
  name: null,
  platform: scope_key.split(':')[0],
  plan_type: null,
  scope_key,
  schedulable: true,
  ...extra,
})

describe('send-to-review scope', () => {
  it('reads the saved backend scope as one of the three modes', () => {
    expect(modeOf({ account_platform_plans: [], account_ids: [] })).toBe('all')
    expect(
      modeOf({ account_platform_plans: ['claude:max'], account_ids: [] })
    ).toBe('custom')
    // Older combinations stay editable as 自己勾 instead of being silently rewritten.
    expect(
      modeOf({ account_platform_plans: ['claude:pro'], account_ids: [] })
    ).toBe('custom')
    expect(
      modeOf({
        account_platform_plans: ['claude:max'],
        account_ids: ['kvm-erik'],
      })
    ).toBe('custom')
    expect(
      modeOf({ account_platform_plans: [], account_ids: ['niutopia2005'] })
    ).toBe('custom')
  })

  it('saves each mode with the existing backend fields', () => {
    expect(scopeBody({ mode: 'all', picked: ['x'] })).toEqual({
      account_platform_plans: [],
      account_ids: [],
      account_types: [],
      account_plan_types: [],
    })
    expect(
      scopeBody({ mode: 'custom', picked: ['kvm-erik', 'niutopia2005'] })
    ).toMatchObject({
      account_platform_plans: [],
      account_ids: ['kvm-erik', 'niutopia2005'],
    })
  })

  it('marks which slots go through the gates under each mode', () => {
    const max = slot('NIutopia0648', 'claude:max')
    const pro = slot('kvm-erik', 'claude:pro', { name: 'Erik' })
    const gpt = slot('gpt-01', 'gpt:plus')
    expect(reviewedUnder({ mode: 'all', picked: [] }, pro, false)).toBe(true)
    expect(reviewedUnder({ mode: 'all', picked: [] }, gpt, false)).toBe(false)
    expect(reviewedUnder({ mode: 'all', picked: [] }, gpt, true)).toBe(true)
    expect(
      reviewedUnder({ mode: 'custom', picked: ['kvm-erik'] }, pro, false)
    ).toBe(true)
    expect(
      reviewedUnder({ mode: 'custom', picked: ['kvm-erik'] }, max, false)
    ).toBe(false)
  })
})
