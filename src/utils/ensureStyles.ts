/**
 * Inject the section stylesheet once per document.
 *
 * `DSH_PLUGIN_GROQ_SPEECH_CSS` is replaced at build time with the minified
 * `theme.scss` output, so the module has no runtime stylesheet request.
 *
 * @param id plugin id used as the style tag marker.
 */
export function ensureStyles (id: string): void {
  if (typeof document === 'undefined' || !document.head) return
  if (document.querySelector(`style[data-plugin="${id}"]`) !== null) return

  const tag = document.createElement('style')

  tag.dataset.plugin = id
  tag.textContent = import.meta.env.DSH_PLUGIN_GROQ_SPEECH_CSS || ''
  document.head.appendChild(tag)
}
