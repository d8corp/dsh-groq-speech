// SPDX-License-Identifier: MIT
// dsh-groq-speech — browser-half entry loaded by the shell's ModuleLoader.

import type { Context } from '@deepseek-ai/cordis'

import { openModelsSection } from './clientModule'
import { Settings } from './components'
import { ensureStyles } from './utils'

export const inject = ['slots']

/** The slice of the slot service used by the Models link. */
interface SlotEntry {
  options?: {
    id?: unknown
    order?: unknown
  }
}

interface SlotService {
  inject (name: string, register: () => unknown): unknown
  register (meta: Record<string, unknown>, component: typeof Settings): unknown
  entries (name: string): SlotEntry[]
}

interface NavigationContext {
  slots: Pick<SlotService, 'entries'>
}

const SECTION = {
  name: 'settings.section',
  id: 'groq-speech',
  order: 30,
  label: 'Groq Speech',
} as const

export function apply (ctx: Context): void {
  ensureStyles('dsh-groq-speech')

  const slots = (ctx as unknown as { slots: SlotService }).slots

  slots.inject('settings.section', () => slots.register(
    {
      ...SECTION,
      inject: () => ({
        openModels: () => openModelsSection(ctx as unknown as NavigationContext),
      }),
    },
    Settings,
  ))
}
