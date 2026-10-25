import type { VmPool } from '@/types/panel-keys'
import type { Vm } from '@/types/panel-vm'
import { describe, expect, it } from 'vitest'
import {
  missingMemberIds,
  poolOwners,
  saveableMemberIds,
  slotPlanLabel,
} from './vm-pool-members'

const pool = (id: string, vm_ids: string[]): VmPool => ({
  id,
  name: id,
  enabled: true,
  vm_ids,
})

const vms = [{ id: 'vm-01' }, { id: 'vm-02' }, { id: 'vm-03' }] as Vm[]

describe('pool membership helpers', () => {
  const pools = [pool('A', ['kvm-erik', 'vm-01']), pool('B', ['vm-02'])]

  it('maps every slot to the pool that holds it, ignoring the edited pool', () => {
    const owners = poolOwners(pools, 'A')
    expect(owners.get('vm-02')?.id).toBe('B')
    expect(owners.has('kvm-erik')).toBe(false)
    expect(poolOwners(pools).get('kvm-erik')?.id).toBe('A')
  })

  it('reports members whose slot record is gone', () => {
    expect(
      missingMemberIds(['vm-01', 'niutopia2000', 'niutopia2006'], vms)
    ).toEqual(['niutopia2000', 'niutopia2006'])
    expect(missingMemberIds(['vm-01'], vms)).toEqual([])
  })

  it('saves only live slots that no other pool holds', () => {
    const owners = poolOwners(pools, 'A')
    expect(
      saveableMemberIds(
        ['vm-01', 'niutopia2000', 'vm-02', 'vm-03'],
        vms,
        owners
      )
    ).toEqual(['vm-01', 'vm-03'])
  })
})

describe('slot plan label on the pool table', () => {
  it('shows Max / Pro, a GPT plan, or 空槽 for a slot without an account', () => {
    expect(slotPlanLabel({ id: 'a', account_tier: 'max' } as Vm)).toBe('Max')
    expect(slotPlanLabel({ id: 'b', account_tier: 'PRO' } as Vm)).toBe('Pro')
    expect(slotPlanLabel({ id: 'c', plan_type: 'plus' } as Vm)).toBe(
      'GPT · plus'
    )
    expect(slotPlanLabel({ id: 'd' } as Vm)).toBe('')
    expect(slotPlanLabel({ id: 'e', account_tier: 'none' } as Vm)).toBe('')
  })
})
