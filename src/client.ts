// SPDX-License-Identifier: MIT
// dsh-groq-speech — browser-half entry loaded by the shell's ModuleLoader.

import type { Context } from '@deepseek-ai/cordis'

import { Settings } from './components'
import { PROVIDER_NAME } from './constants'
import { ensureStyles } from './utils'

const PLUGIN_ID = 'dsh-groq-speech'

/** Settings section metadata registered into the shell. */
const SECTION = {
  name: 'settings.section',
  id: 'groq-speech',
  order: 30,
  label: PROVIDER_NAME,
} as const

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

/**
 * Activate the built-in Models section in the already-open settings panel.
 *
 * The shell does not expose a navigation callback to section components, so
 * mirror its order and click the matching nav cell. The lookup is by slot id,
 * never by a guessed URL or a localized label.
 *
 * @param ctx plugin context carrying the slot service.
 * @returns true when the Models cell was found and clicked.
 */
function openModelsSection (ctx: NavigationContext): boolean {
  if (typeof document === 'undefined') return false

  const panel = document.querySelector('[data-shortcut-modal="settings"]')

  if (panel === null) return false

  let index = -1

  try {
    const rows = ctx.slots
      .entries('settings.section')
      .map((entry) => ({
        id: entry && entry.options ? entry.options.id : '',
        order: entry && entry.options && typeof entry.options.order === 'number'
          ? entry.options.order
          : 0,
      }))
      .sort((left, right) => left.order - right.order)

    index = rows.findIndex((row) => row.id === 'models')
  } catch {
    index = -1
  }

  const buttons = panel.querySelectorAll('nav > div:last-child button')

  if (index < 0 || !buttons[index]) return false

  ;(buttons[index] as HTMLElement).click()

  return true
}

/**
 * Register the Settings → Groq Speech section. The shell owns navigation;
 * slot lifecycle is handled by ctx.slots.inject.
 *
 * @param ctx plugin context carrying the slot service.
 */
export function apply (ctx: Context): void {
  ensureStyles(PLUGIN_ID)

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
