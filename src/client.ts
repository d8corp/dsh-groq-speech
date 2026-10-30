// SPDX-License-Identifier: MIT
// dsh-groq-speech — browser-half entry loaded by the shell's ModuleLoader.

import { registerClient } from './clientModule'

if (typeof window !== 'undefined' && window.__ModuleLoader__ !== undefined) {
  registerClient(window.__ModuleLoader__)
}
