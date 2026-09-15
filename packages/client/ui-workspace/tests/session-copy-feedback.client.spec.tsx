// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { zh as common } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { SessionNodeItem } from '../src/client/rows/Rows.tsx'
afterEach(cleanup)
it.each([false, true])('reports real clipboard settlement, failure=%s', async (fail) => {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const result = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  render(<SessionNodeItem node={{ id: 'copy-test' as SessionId, title: '复制测试', blank: false, running: false, runningSubagentCount: 0, completed: false, hasActiveSchedule: false, updatedAt: 0 }} currentId={undefined} now={0} onOpen={vi.fn()} onRename={vi.fn()} onFork={vi.fn()} onArchive={vi.fn()} menuActions={[{ id: 'copy', label: '复制为 Markdown', feedback: { pending: '正在复制…', success: '已复制到剪贴板' }, run: () => result }]} t={makeTranslate(zh, common) as never} />)
  fireEvent.click(screen.getByRole('button', { name: '会话“复制测试”的操作' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '复制为 Markdown' }))
  expect(screen.getByRole('alert').textContent).toBe('正在复制…')
  expect(screen.queryByText('已复制到剪贴板')).toBeNull()
  await act(async () => { if (fail) reject(new Error('剪贴板权限不足')); else resolve(); await Promise.resolve() })
  expect(screen.getByRole('alert').textContent).toBe(fail ? '剪贴板权限不足' : '已复制到剪贴板')
})
