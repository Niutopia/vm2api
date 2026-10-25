import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { JevInterceptConfig, JevScopeAccount } from '@/types/panel-routing'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useServerDraft } from '@/hooks/use-server-draft'
import { SaveBar } from '@/features/settings/save-bar'
import { FoldPanel } from './blocks'
import { jevInterceptQueryOptions } from './queries'
import {
  draftOf,
  reviewedUnder,
  sameDraft,
  scopeBody,
  type ScopeMode,
} from './scope-mode'

function planLabel(account: JevScopeAccount) {
  const [platform, plan] = String(account.scope_key || '').split(':')
  if (platform === 'gpt') return `GPT · ${plan || '未标注'}`
  if (plan === 'max') return 'Max'
  if (plan === 'pro') return 'Pro'
  return '未标注'
}

const MODES: { id: ScopeMode; label: string; hint: string }[] = [
  {
    id: 'all',
    label: '全部送审',
    hint: '所有槽都送审，以后新建的槽也一样（GPT 槽另看「OpenAI 平台」开关）。',
  },
  {
    id: 'custom',
    label: '自己勾',
    hint: '一个个勾：只审勾上的槽，以后新建的槽默认不送审。',
  },
]

/**
 * 风控的送审范围：一个槽一行，直接看出哪些槽过四道关、哪些在接单却没送审。
 * 后端规则不变（account_platform_plans / account_ids），只是换一种方式填。
 */
export function AccountScopeSettings() {
  const qc = useQueryClient()
  const q = useQuery(jevInterceptQueryOptions())
  const [draft, setDraft] = useServerDraft(
    q.data,
    draftOf,
    (a, b) => !sameDraft(a, b)
  )
  const [open, setOpen] = useState(false)

  const save = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('没有可保存的配置')
      return api<JevInterceptConfig>('/api/panel/jev-intercept', {
        method: 'PUT',
        body: JSON.stringify(scopeBody(draft)),
      })
    },
    onSuccess: (data) => {
      toast.success('已保存送审范围')
      setDraft(draftOf(data))
      qc.setQueryData(jevInterceptQueryOptions().queryKey, data)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (q.error) {
    return (
      <p
        className='rounded-xl border px-4 py-3 text-sm text-destructive'
        role='alert'
      >
        {(q.error as Error).message}
      </p>
    )
  }
  if (!draft || !q.data) {
    return <div className='h-12 animate-pulse rounded-xl bg-muted/40' />
  }

  const saved = draftOf(q.data)
  const dirty = !sameDraft(draft, saved)
  const accounts = q.data.account_scope?.accounts || []
  const openai = q.data.openai_platform_enabled === true
  const reviewed = (account: JevScopeAccount) =>
    reviewedUnder(draft, account, openai)
  const count = accounts.filter(reviewed).length
  const gaps = accounts.filter(
    (account) => account.schedulable && !reviewed(account)
  )
  const emptyCustom = draft.mode === 'custom' && !draft.picked.length
  const mode = MODES.find((m) => m.id === draft.mode) || MODES[0]

  const setMode = (next: ScopeMode) =>
    setDraft({
      mode: next,
      // Switching to 自己勾 starts from what the current choice reviews.
      picked:
        next === 'custom' && draft.mode !== 'custom'
          ? accounts.filter(reviewed).map((a) => a.id)
          : draft.picked,
    })
  const togglePick = (id: string, on: boolean) =>
    setDraft({
      ...draft,
      picked: on ? [...draft.picked, id] : draft.picked.filter((x) => x !== id),
    })

  return (
    <FoldPanel
      title='送审范围'
      hint='决定哪些槽的请求要过蒸馏、硬正则、拒答缓存和决策模型这四道关。没送审的槽，四道关全部跳过。'
      open={open || dirty}
      onOpenChange={(next) => {
        if (!next && dirty) return
        setOpen(next)
      }}
      meta={
        gaps.length ? (
          <span className='text-[var(--status-caution)]'>
            {gaps.length} 个接单中的槽没送审
          </span>
        ) : (
          `${draft.mode === 'all' ? '全部送审' : '自己勾'} · 审 ${count} 个槽`
        )
      }
    >
      <div className='space-y-4 px-4 py-4'>
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2 text-sm'>
          <span>
            {dirty ? '改完后' : '现在'}：审{' '}
            <span className='font-semibold tabular-nums'>{count}</span> 个槽
          </span>
          {gaps.length ? (
            <span className='rounded-md bg-[var(--status-caution)]/10 px-2 py-0.5 text-xs text-[var(--status-caution)]'>
              {gaps.length} 个接单中的槽没送审：
              {gaps.map((a) => a.name || a.id).join('、')}
            </span>
          ) : (
            <span className='text-xs text-muted-foreground'>
              接单中的槽都送审了
            </span>
          )}
        </div>

        <div className='space-y-2'>
          <div
            role='group'
            aria-label='送审方式'
            className='inline-flex flex-wrap gap-1 rounded-lg border bg-muted/30 p-1'
          >
            {MODES.map((m) => (
              <button
                key={m.id}
                type='button'
                aria-pressed={draft.mode === m.id}
                onClick={() => setMode(m.id)}
                className={cn(
                  'cursor-pointer rounded-md px-3 py-1.5 text-xs transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  draft.mode === m.id
                    ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className='text-xs text-muted-foreground'>{mode.hint}</p>
        </div>

        {/* 全部送审时每个槽都审，逐槽列表没有信息量，只在「自己勾」时显示。 */}
        {draft.mode === 'all' ? null : accounts.length ? (
          <div className='overflow-x-auto rounded-md border'>
            <table className='w-full min-w-[520px] text-sm'>
              <thead className='bg-muted/40 text-left text-xs text-muted-foreground'>
                <tr>
                  <th className='px-3 py-2 font-medium'>槽位</th>
                  <th className='px-3 py-2 font-medium'>套餐</th>
                  <th className='px-3 py-2 font-medium'>调度</th>
                  <th className='px-3 py-2 font-medium'>送审</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => {
                  const on = reviewed(account)
                  const locked = draft.mode !== 'custom'
                  const label = planLabel(account)
                  return (
                    <tr key={account.id} className='border-t'>
                      <td className='px-3 py-2 font-mono text-xs whitespace-nowrap'>
                        {account.id}
                        {account.name && account.name !== account.id ? (
                          <span className='ml-1.5 font-sans text-muted-foreground'>
                            {account.name}
                          </span>
                        ) : null}
                      </td>
                      <td className='px-3 py-2'>
                        <span
                          className={cn(
                            'inline-block rounded-md px-2 py-0.5 text-xs font-medium',
                            label === 'Max'
                              ? 'bg-primary/10 text-primary'
                              : 'bg-muted text-foreground',
                            label === '未标注' &&
                              'bg-transparent text-muted-foreground'
                          )}
                        >
                          {label}
                        </span>
                      </td>
                      <td className='px-3 py-2 text-xs whitespace-nowrap'>
                        {account.schedulable ? (
                          '接单中'
                        ) : (
                          <span className='text-muted-foreground'>关调度</span>
                        )}
                      </td>
                      <td className='px-3 py-2'>
                        <label className='flex items-center gap-2'>
                          <input
                            type='checkbox'
                            className='size-4 accent-primary'
                            aria-label={`${account.id} 送审`}
                            checked={on}
                            disabled={locked}
                            onChange={(event) =>
                              togglePick(account.id, event.target.checked)
                            }
                          />
                          {!on && account.schedulable ? (
                            <span className='text-xs text-[var(--status-caution)]'>
                              四道关全跳过
                            </span>
                          ) : locked && on ? (
                            <span className='text-xs text-muted-foreground'>
                              全部送审
                            </span>
                          ) : null}
                        </label>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className='text-xs text-muted-foreground'>还没有槽位。</p>
        )}

        {dirty ? (
          <SaveBar
            blockedReason={
              emptyCustom
                ? '至少勾一个槽；要所有槽都审，请选「全部送审」'
                : undefined
            }
            saving={save.isPending}
            onSave={() => save.mutate()}
            onDiscard={() => setDraft(saved)}
          />
        ) : null}
      </div>
    </FoldPanel>
  )
}
