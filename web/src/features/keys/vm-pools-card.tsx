import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiKeyItem, VmPool } from '@/types/panel-keys'
import type { Vm } from '@/types/panel-vm'
import { ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { missingMemberIds, poolOwners, slotPlanLabel } from './vm-pool-members'

export function vmPoolsQueryOptions() {
  return {
    queryKey: ['panel', 'vm-pools'] as const,
    queryFn: () => api<{ pools?: VmPool[] }>('/api/panel/vm-pools'),
  }
}

const NO_POOL = '__none__'

function patchPool(
  id: string,
  body: Partial<Pick<VmPool, 'name' | 'enabled' | 'vm_ids'>>
) {
  return api(`/api/panel/vm-pools/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

function slotLive(vm: Vm) {
  return vm.schedulable !== false && (vm.status || 'running') === 'running'
}

function slotState(vm: Vm) {
  if ((vm.status || 'running') !== 'running')
    return { text: '已停止', live: false }
  return vm.schedulable === false
    ? { text: '关调度', live: false }
    : { text: '接单中', live: true }
}

function PlanBadge({ label }: { label: string }) {
  return (
    <span
      className={cn(
        'inline-block justify-self-start rounded-md px-2 py-0.5 text-xs font-medium',
        label === 'Max' && 'bg-primary/10 text-primary',
        label && label !== 'Max' && 'bg-muted text-foreground',
        !label && 'border border-dashed text-muted-foreground'
      )}
    >
      {label || '空槽'}
    </span>
  )
}

/**
 * 账号池按池分组：每个池一块，块里就是它的槽；收起时标题行列出成员。
 * 换池用每行的「移到…」：先从原池移出再加入新池，加入失败就放回原池，不用再点保存。
 */
export function VmPoolsCard({
  vms,
  keys = [],
}: {
  vms: Vm[]
  keys?: ApiKeyItem[]
}) {
  const qc = useQueryClient()
  const q = useQuery(vmPoolsQueryOptions())
  const pools = q.data?.pools || []
  const owners = poolOwners(pools)
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const refresh = () =>
    qc.invalidateQueries({ queryKey: vmPoolsQueryOptions().queryKey })

  const known = new Set(vms.map((vm) => vm.id))
  const liveIds = (pool: VmPool) => pool.vm_ids.filter((id) => known.has(id))
  const unpooled = vms.filter((vm) => !owners.has(vm.id))
  const isOpen = (id: string, index: number) => opened[id] ?? index === 0
  const setOpen = (id: string, open: boolean) =>
    setOpened((cur) => ({ ...cur, [id]: open }))

  async function run(task: () => Promise<string>) {
    setBusy(true)
    try {
      toast.success(await task())
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const moveSlot = (vmId: string, toId: string) =>
    run(async () => {
      const from = owners.get(vmId)
      const to = pools.find((pool) => pool.id === toId)
      if (from) {
        await patchPool(from.id, {
          vm_ids: liveIds(from).filter((id) => id !== vmId),
        })
      }
      if (to) {
        try {
          await patchPool(to.id, { vm_ids: [...liveIds(to), vmId] })
        } catch (error) {
          // Put it back so a failed move never leaves the slot outside both pools.
          if (from)
            await patchPool(from.id, { vm_ids: liveIds(from) }).catch(() => {})
          throw error
        }
        setOpen(to.id, true)
      }
      if (!to) return `已把 ${vmId} 移出「${from?.name}」`
      if (!from) return `已把 ${vmId} 放进「${to.name}」`
      return `已把 ${vmId} 从「${from.name}」挪到「${to.name}」`
    })

  return (
    <section className='mb-4 space-y-3 rounded-md border p-4'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h2 className='text-sm font-medium'>账号池</h2>
          <p className='text-xs text-muted-foreground'>
            一个槽只属于一个池。密钥绑了池之后，只在池里的槽之间选号、重试和排队；池停用或为空时直接失败，不回落到全局。
          </p>
        </div>
        <NewPool
          pending={busy}
          names={pools.map((pool) => pool.name)}
          onCreate={(name) =>
            run(async () => {
              await api('/api/panel/vm-pools', {
                method: 'POST',
                body: JSON.stringify({ name, vm_ids: [] }),
              })
              return `已创建「${name}」，在别的池里点「移到…」把槽挪进来`
            })
          }
        />
      </div>

      {!pools.length && !vms.length ? (
        <p className='text-xs text-muted-foreground'>还没有账号池和槽位。</p>
      ) : null}

      <div className='space-y-2'>
        {pools.map((pool, index) => (
          <PoolGroup
            key={pool.id}
            pool={pool}
            members={vms.filter((vm) => pool.vm_ids.includes(vm.id))}
            missing={missingMemberIds(pool.vm_ids, vms)}
            keys={keys.filter((key) => key.vm_pool_id === pool.id)}
            names={pools.filter((p) => p.id !== pool.id).map((p) => p.name)}
            pools={pools}
            open={isOpen(pool.id, index)}
            onOpenChange={(open) => setOpen(pool.id, open)}
            pending={busy}
            onMove={moveSlot}
            onToggle={() =>
              run(async () => {
                await patchPool(pool.id, { enabled: !pool.enabled })
                return pool.enabled
                  ? `「${pool.name}」已停用`
                  : `「${pool.name}」已启用`
              })
            }
            onRename={(name) =>
              run(async () => {
                await patchPool(pool.id, { name })
                return `已改名为「${name}」`
              })
            }
            onDelete={() =>
              run(async () => {
                await api(
                  `/api/panel/vm-pools/${encodeURIComponent(pool.id)}`,
                  { method: 'DELETE' }
                )
                return `已删除「${pool.name}」`
              })
            }
          />
        ))}
        {unpooled.length ? (
          <PoolGroup
            members={unpooled}
            pools={pools}
            open={opened[NO_POOL] ?? false}
            onOpenChange={(open) => setOpen(NO_POOL, open)}
            pending={busy}
            onMove={moveSlot}
          />
        ) : null}
      </div>
    </section>
  )
}

function NewPool({
  pending,
  names,
  onCreate,
}: {
  pending: boolean
  names: string[]
  onCreate: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  if (!open) {
    return (
      <Button size='sm' onClick={() => setOpen(true)}>
        新建池
      </Button>
    )
  }
  const trimmed = name.trim()
  const taken = names.includes(trimmed)
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Input
        autoFocus
        value={name}
        placeholder='例如：独享-小王'
        aria-label='新池名称'
        className='h-8 max-w-xs'
        onChange={(event) => setName(event.target.value)}
      />
      <Button
        size='sm'
        disabled={pending || !trimmed || taken}
        onClick={() => {
          onCreate(trimmed)
          setName('')
          setOpen(false)
        }}
      >
        创建
      </Button>
      <Button size='sm' variant='ghost' onClick={() => setOpen(false)}>
        取消
      </Button>
      {taken ? (
        <span className='text-xs text-destructive'>
          已经有叫「{trimmed}」的池了
        </span>
      ) : null}
    </div>
  )
}

/** One pool (or, without `pool`, the slots that are in no pool). */
function PoolGroup({
  pool,
  members,
  missing = [],
  keys = [],
  names = [],
  pools,
  open,
  onOpenChange,
  pending,
  onMove,
  onToggle,
  onRename,
  onDelete,
}: {
  pool?: VmPool
  members: Vm[]
  missing?: string[]
  keys?: ApiKeyItem[]
  names?: string[]
  pools: VmPool[]
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  onMove: (vmId: string, toId: string) => void
  onToggle?: () => void
  onRename?: (name: string) => void
  onDelete?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [name, setName] = useState(pool?.name || '')
  const live = members.filter(slotLive).length
  const title = pool ? pool.name : '不在池里'
  const trimmed = name.trim()
  const taken = names.includes(trimmed)

  let actions: React.ReactNode = null
  if (pool && editing) {
    actions = (
      <>
        <Button
          size='sm'
          disabled={pending || !trimmed || taken}
          onClick={() => {
            onRename?.(trimmed)
            setEditing(false)
          }}
        >
          保存名称
        </Button>
        <Button
          size='sm'
          variant='ghost'
          onClick={() => {
            setName(pool.name)
            setEditing(false)
          }}
        >
          取消
        </Button>
      </>
    )
  } else if (pool && confirming) {
    actions = members.length ? (
      <span className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
        还有 {members.length} 个槽，先把它们移走
        <Button size='sm' variant='ghost' onClick={() => setConfirming(false)}>
          知道了
        </Button>
      </span>
    ) : (
      <span className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
        删除「{pool.name}」？
        {keys.length
          ? `绑它的密钥（${keys.map((key) => key.name || key.id).join('、')}）会变成不绑池。`
          : ''}
        <Button
          size='sm'
          variant='destructive'
          disabled={pending}
          onClick={() => {
            onDelete?.()
            setConfirming(false)
          }}
        >
          删除
        </Button>
        <Button size='sm' variant='ghost' onClick={() => setConfirming(false)}>
          取消
        </Button>
      </span>
    )
  } else if (pool) {
    actions = (
      <>
        <button
          type='button'
          aria-pressed={pool.enabled}
          disabled={pending}
          onClick={onToggle}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
            pool.enabled
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground'
          )}
        >
          <span
            className='size-1.5 rounded-full bg-current'
            aria-hidden='true'
          />
          {pool.enabled ? '启用' : '已停用'}
        </button>
        <Button size='sm' variant='ghost' onClick={() => setEditing(true)}>
          改名
        </Button>
        <Button size='sm' variant='ghost' onClick={() => setConfirming(true)}>
          删除
        </Button>
      </>
    )
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border',
        pool ? 'bg-muted/20' : 'border-dashed'
      )}
    >
      <div className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2'>
        {editing ? (
          <div className='min-w-0'>
            <Input
              autoFocus
              value={name}
              aria-label='池名称'
              className='h-8 max-w-xs'
              onChange={(event) => setName(event.target.value)}
            />
            {taken ? (
              <p className='mt-1 text-xs text-destructive'>
                已经有叫「{trimmed}」的池了
              </p>
            ) : null}
          </div>
        ) : (
          <button
            type='button'
            aria-expanded={open}
            onClick={() => onOpenChange(!open)}
            className='flex min-w-0 cursor-pointer items-start gap-2 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
          >
            <ChevronRight
              className={cn(
                'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200',
                open && 'rotate-90'
              )}
              aria-hidden='true'
            />
            <span className='min-w-0'>
              <span className='flex flex-wrap items-baseline gap-x-2.5'>
                <span className='text-sm font-semibold'>{title}</span>
                <span className='text-xs text-muted-foreground'>
                  {members.length} 个槽 · {live} 个在接单
                  {pool && !pool.enabled
                    ? ' · 已停用，绑它的密钥会直接失败'
                    : ''}
                </span>
              </span>
              {!open ? (
                <span className='block truncate font-mono text-xs text-muted-foreground'>
                  {members
                    .map((vm) =>
                      vm.name && vm.name !== vm.id ? vm.name : vm.id
                    )
                    .join('、') || '还没有槽'}
                </span>
              ) : null}
              {missing.length ? (
                <span className='block text-xs text-amber-600'>
                  含已不存在的槽：{missing.join('、')}（下次改动时自动清掉）
                </span>
              ) : null}
            </span>
          </button>
        )}
        <div className='flex flex-wrap items-center justify-end gap-1'>
          {actions}
        </div>
      </div>
      {open ? (
        <div className='border-t'>
          {members.length ? (
            members.map((vm) => (
              <SlotRow
                key={vm.id}
                vm={vm}
                pool={pool}
                pools={pools}
                pending={pending}
                onMove={onMove}
              />
            ))
          ) : (
            <p className='px-3 py-2.5 pl-9 text-xs text-muted-foreground'>
              还没有槽。在别的池里点「移到…」把槽挪进来。
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

function SlotRow({
  vm,
  pool,
  pools,
  pending,
  onMove,
}: {
  vm: Vm
  pool?: VmPool
  pools: VmPool[]
  pending: boolean
  onMove: (vmId: string, toId: string) => void
}) {
  const state = slotState(vm)
  return (
    <div className='grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t px-3 py-2 pl-9 first:border-t-0 md:grid-cols-[minmax(0,1.4fr)_4.5rem_5.5rem_minmax(0,1.2fr)_8rem]'>
      <span className='min-w-0 truncate font-mono text-xs'>
        {vm.id}
        {vm.name && vm.name !== vm.id ? (
          <span className='ml-1.5 font-sans text-muted-foreground'>
            {vm.name}
          </span>
        ) : null}
      </span>
      <span className='hidden md:inline-block'>
        <PlanBadge label={slotPlanLabel(vm)} />
      </span>
      <span className='hidden items-center gap-1.5 text-xs md:inline-flex'>
        <span
          className={cn(
            'size-1.5 rounded-full',
            state.live ? 'bg-emerald-500' : 'bg-muted-foreground/50'
          )}
          aria-hidden='true'
        />
        <span className={state.live ? '' : 'text-muted-foreground'}>
          {state.text}
        </span>
      </span>
      <span className='hidden min-w-0 truncate text-xs text-muted-foreground md:block'>
        {vm.proxy?.label || vm.proxy?.host || '—'}
      </span>
      <select
        aria-label={`把 ${vm.id} 移到别的池`}
        className='h-7 max-w-32 cursor-pointer justify-self-end rounded-md border border-transparent bg-transparent px-1.5 text-xs text-muted-foreground hover:border-border hover:text-foreground'
        disabled={pending}
        value=''
        onChange={(event) =>
          event.target.value && onMove(vm.id, event.target.value)
        }
      >
        <option value=''>移到…</option>
        {pools
          .filter((p) => p.id !== pool?.id)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.enabled ? '' : '（已停用）'}
            </option>
          ))}
        {pool ? <option value={NO_POOL}>移出（不进池）</option> : null}
      </select>
    </div>
  )
}
