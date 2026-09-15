// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { zh as common } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { SessionMenuRegistry } from '../src/client/session-menu.ts'
import { SessionNodeItem } from '../src/client/rows/Rows.tsx'
afterEach(cleanup)
it('registers reactively, rejects collisions and withdraws on disposal', () => {
  const registry = new SessionMenuRegistry()
  const listener = vi.fn()
  const stop = registry.source.subscribe(listener)
  const before = registry.source.getSnapshot()
  const remove = registry.register({ id:'copy',label:'复制',run:()=>{} })
  expect(registry.source.getSnapshot()).not.toBe(before)
  expect(registry.source.getSnapshot()).toBe(registry.source.getSnapshot())
  expect(() => registry.register({ id:'copy',label:'复制',run:()=>{} })).toThrow()
  expect(() => registry.register({ id:'archive',label:'归档',run:()=>{} })).toThrow()
  remove();expect(registry.source.getSnapshot()).toEqual([])
  expect(listener).toHaveBeenCalledTimes(2);stop()
})
it('dispatches to clicked row without opening it', async () => {
  const run=vi.fn();const open=vi.fn()
  render(<SessionNodeItem node={{ id:'clicked' as SessionId,title:'测试',blank:false,running:false,runningSubagentCount:0,completed:false,hasActiveSchedule:false,updatedAt:0 }} currentId={'other'} now={0} onOpen={open} onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} menuActions={[{ id:'copy',label:'复制工作目录',run }]} t={makeTranslate(zh,common) as never} />)
  fireEvent.click(screen.getByRole('button',{ name:'会话“测试”的操作' }))
  fireEvent.click(screen.getByRole('menuitem',{ name:'复制工作目录' }))
  await waitFor(()=>{ expect(run).toHaveBeenCalledWith('clicked') })
  expect(open).not.toHaveBeenCalled()
})
