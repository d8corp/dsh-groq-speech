import type * as ReactTypes from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  DEFAULT_POLISH_PROMPT,
  LANGUAGES,
  MAX_PROMPT_CHARS,
  MODEL_OPTIONS,
} from '../../constants'
import type { ClientStatus, GroqSpeechSettings, ModelRoute, VoiceInputStatus } from '../../contracts'
import { Button } from '../../ui/Button'
import { Link } from '../../ui/Link'
import { Notice } from '../../ui/Notice'
import { Row } from '../../ui/Row'
import type { SelectOption } from '../../ui/Select'
import { Select } from '../../ui/Select'
import { Status } from '../../ui/Status'
import { Textarea } from '../../ui/Textarea'
import {
  callApi,
  decodeModelValue,
  encodeModelValue,
  errorMessage,
  languageLabel,
  normalizeModels,
  normalizeSettings,
  normalizeStatus,
  normalizeVoice,
  settingsSnapshot,
} from '../../utils'

/** Page lifecycle: loading | ready | error. */
type Phase = 'loading' | 'ready' | 'error'

interface FormNotice {
  kind: 'saved' | 'error'
  text: string
}

/** Stable element ids for label/control pairing. */
const ID = {
  model: 'groq-speech-model',
  language: 'groq-speech-language',
  polishModel: 'groq-speech-polish-model',
  prompt: 'groq-speech-polish-prompt',
}

export interface SettingsProps {
  /** Opens the built-in Models section; supplied by the slot injector. */
  openModels?: () => boolean
  /** Opens the official voice-input plugin details; supplied by the injector. */
  openVoiceInput?: () => boolean
  /** Closes the settings panel; supplied by the shell. */
  close?: () => void
}

/**
 * The Settings → Groq Speech page: shared-key guidance, recognition and polish.
 *
 * The section never renders a key input and never receives key material; the
 * Groq key is managed only in Settings → Models. Edits are saved automatically
 * after a short debounce, with writes serialized so a slow earlier request can
 * never overwrite a newer edit.
 *
 * @param props slot-injected navigation helpers and the shell close callback.
 * @returns the settings section.
 */
export function Settings ({ openModels, openVoiceInput, close }: SettingsProps) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [loadError, setLoadError] = useState('')
  const [statusValue, setStatusValue] = useState<ClientStatus | null>(null)
  const [form, setForm] = useState<GroqSpeechSettings | null>(null)
  const [models, setModels] = useState<ModelRoute[]>([])
  const [modelsError, setModelsError] = useState('')
  const [modelsLoading, setModelsLoading] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [selectingVoice, setSelectingVoice] = useState(false)
  const [notice, setNotice] = useState<FormNotice | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveInFlightRef = useRef(false)
  const inFlightSnapshotRef = useRef('')
  const queuedSaveRef = useRef<GroqSpeechSettings | null>(null)
  const latestFormRef = useRef<GroqSpeechSettings | null>(null)
  const persistedSnapshotRef = useRef('')
  const editVersionRef = useRef(0)
  const mountedRef = useRef(true)

  /**
   * Install settings loaded from the host without triggering autosave.
   *
   * @param nextSettings normalized settings document.
   */
  function applyLoadedSettings (nextSettings: GroqSpeechSettings): void {
    latestFormRef.current = nextSettings
    persistedSnapshotRef.current = settingsSnapshot(nextSettings)
    setForm(nextSettings)
  }

  /**
   * Merge edits into the editable settings copy and schedule one write.
   *
   * @param next complete next settings document.
   */
  function commitForm (next: GroqSpeechSettings): void {
    editVersionRef.current += 1
    latestFormRef.current = next
    setForm(next)
    scheduleSettingsSave(next)
  }

  /**
   * Merge a patch into the editable settings copy.
   *
   * @param patch fields to replace.
   */
  function patchForm (patch: Partial<GroqSpeechSettings>): void {
    const current = latestFormRef.current

    if (current === null) return

    commitForm({ ...current, ...patch })
  }

  /**
   * Merge a patch into the polish sub-object.
   *
   * @param patch polish fields to replace.
   */
  function patchPolish (patch: Partial<GroqSpeechSettings['polish']>): void {
    const current = latestFormRef.current

    if (current === null) return

    commitForm({ ...current, polish: { ...current.polish, ...patch } })
  }

  /**
   * Debounce rapid edits (notably prompt typing) into one write.
   *
   * @param next settings document to persist.
   */
  function scheduleSettingsSave (next: GroqSpeechSettings): void {
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current)

    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      persistSettings(next)
    }, 500)
  }

  /**
   * Persist one settings snapshot. Writes are serialized so a slow earlier
   * request can never overwrite a newer edit.
   *
   * @param settings snapshot captured when the debounce fired.
   */
  async function persistSettings (settings: GroqSpeechSettings | null): Promise<void> {
    if (settings === null) return

    const snapshot = settingsSnapshot(settings)

    if (saveInFlightRef.current) {
      if (snapshot !== inFlightSnapshotRef.current) queuedSaveRef.current = settings

      return
    }

    if (snapshot === persistedSnapshotRef.current) return

    saveInFlightRef.current = true
    inFlightSnapshotRef.current = snapshot

    const version = editVersionRef.current

    if (mountedRef.current) setSavingSettings(true)

    try {
      const value = await callApi('set-settings', {
        patch: {
          model: settings.model,
          language: settings.language,
          polish: {
            provider: settings.polish.provider,
            model: settings.polish.model,
            prompt: settings.polish.prompt,
          },
        },
      })

      const saved = normalizeSettings(
        value !== null && typeof value === 'object' && (value as { settings?: unknown }).settings
          ? (value as { settings: unknown }).settings
          : settings,
      )

      persistedSnapshotRef.current = settingsSnapshot(saved)

      if (mountedRef.current && version === editVersionRef.current) {
        latestFormRef.current = saved
        setForm(saved)
        setNotice({ kind: 'saved', text: 'Saved' })
      }
    } catch (error) {
      if (mountedRef.current) {
        setNotice({ kind: 'error', text: errorMessage(error, 'Could not save settings.') })
      }
    } finally {
      saveInFlightRef.current = false
      inFlightSnapshotRef.current = ''

      if (mountedRef.current) setSavingSettings(false)

      const queued = queuedSaveRef.current

      queuedSaveRef.current = null

      if (queued !== null) persistSettings(queued)
    }
  }

  /**
   * Flush the pending debounce when the section unmounts.
   */
  function flushPendingSettings (): void {
    if (saveTimerRef.current === null) return

    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null

    const pending = latestFormRef.current

    if (pending !== null && settingsSnapshot(pending) !== persistedSnapshotRef.current) {
      persistSettings(pending)
    }
  }

  /**
   * Mount load: status, settings and model list. The model list is allowed to
   * fail softly — the rest of the form stays usable.
   */
  async function loadAll (): Promise<void> {
    setPhase('loading')
    setLoadError('')
    setModelsError('')
    setNotice(null)

    const [statusResult, settingsResult, modelsResult] = await Promise.allSettled([
      callApi('status'),
      callApi('get-settings'),
      callApi('list-models'),
    ])

    if (!mountedRef.current) return

    if (statusResult.status !== 'fulfilled') {
      setPhase('error')
      setLoadError(errorMessage(statusResult.reason, 'Could not load Groq Speech status.'))

      return
    }

    const nextStatus = normalizeStatus(statusResult.value)

    const loadedSettings = settingsResult.status === 'fulfilled' && settingsResult.value
      ? (settingsResult.value as { settings?: unknown }).settings
      : undefined

    const nextSettings = normalizeSettings(loadedSettings ?? nextStatus.settings ?? null)

    setStatusValue(nextStatus)
    applyLoadedSettings(nextSettings)

    if (modelsResult.status === 'fulfilled') {
      setModels(normalizeModels(modelsResult.value))
      setModelsError('')
    } else {
      setModels([])
      setModelsError(errorMessage(modelsResult.reason, 'Could not load the model list.'))
    }

    setPhase('ready')
  }

  /**
   * Retry just the model list, keeping the rest of the form usable.
   */
  async function loadModels (): Promise<void> {
    setModelsLoading(true)
    setModelsError('')

    try {
      setModels(normalizeModels(await callApi('list-models')))
    } catch (error) {
      setModels([])
      setModelsError(errorMessage(error, 'Could not load the model list.'))
    } finally {
      setModelsLoading(false)
    }
  }

  useEffect(() => {
    mountedRef.current = true
    loadAll()

    return () => {
      mountedRef.current = false
      // The component is going away: flush the last debounced edit.
      flushPendingSettings()
    }
  }, [])

  const configured = statusValue !== null && statusValue.configured
  const envVar = statusValue !== null ? statusValue.envVar : 'GROQ_API_KEY'
  const voice: VoiceInputStatus = statusValue !== null ? statusValue.voice : normalizeVoice(null)

  /**
   * Explain where the shared key lives; never renders key material.
   *
   * @returns the row description.
   */
  function keyDescription (): string {
    if (configured) {
      return 'Configured through the shared ' + envVar +
        ' credential. Groq Speech uses the same key as the Groq provider; manage it only in Settings → Models.'
    }

    return 'No Groq API key is configured. Add it in Settings → Models; Groq Speech will use the same ' +
      envVar + ' credential automatically.'
  }

  /**
   * Handle the Models link without leaving the settings panel.
   *
   * @param event click event.
   */
  function handleModelsLink (event: ReactTypes.MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault()

    if (typeof openModels === 'function' && openModels()) return

    setNotice({
      kind: 'error',
      text: 'Open Settings → Models from the settings sidebar to manage the key.',
    })
  }

  /**
   * Explain which recognition service the microphone currently uses.
   *
   * @returns the row description.
   */
  function voiceDescription (): string {
    if (!voice.available) {
      return 'The official voice-input bundle is not available in this profile, so Groq Whisper cannot be selected. Enable it and reload DSH.'
    }

    if (voice.selected) {
      return 'Groq Whisper is the recognition service for the microphone. No local model download is required.'
    }

    if (voice.providerName !== null) {
      return 'The microphone currently uses ' + voice.providerName +
        '. Switch to Groq Whisper to transcribe through the Groq API instead.'
    }

    return 'Choose Groq Whisper to transcribe through the Groq API instead of a local model.'
  }

  /**
   * Ask the host to make Groq Whisper the selected voice-input provider.
   */
  async function selectVoiceProvider (): Promise<void> {
    setSelectingVoice(true)

    try {
      const value = await callApi('select-provider')

      const nextVoice = normalizeVoice(
        value !== null && typeof value === 'object'
          ? (value as { voice?: unknown }).voice
          : undefined,
      )

      if (!mountedRef.current) return

      setStatusValue((current) => current === null ? current : { ...current, voice: nextVoice })

      if (nextVoice.selected) {
        setNotice({ kind: 'saved', text: 'Groq Whisper is now the voice-input provider.' })
      } else {
        setNotice({
          kind: 'error',
          text: 'The voice-input provider did not change. Choose Groq Whisper under Recognition service in Voice input settings.',
        })
      }
    } catch (error) {
      if (mountedRef.current) {
        setNotice({ kind: 'error', text: errorMessage(error, 'Could not select Groq Whisper for voice input.') })
      }
    } finally {
      if (mountedRef.current) setSelectingVoice(false)
    }
  }

  /**
   * Open the official voice-input settings and close this panel.
   *
   * @param event click event.
   */
  function handleVoiceLink (event: ReactTypes.MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault()

    if (typeof openVoiceInput === 'function' && openVoiceInput()) {
      if (typeof close === 'function') close()

      return
    }

    setNotice({
      kind: 'error',
      text: 'Open the voice-input plugin from the Plugins page to change the recognition service.',
    })
  }

  if (phase === 'loading') {
    return (
      <div className='gqs-section'>
        <p className='gqs-loading' role='status'>Loading Groq Speech settings…</p>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className='gqs-section'>
        <p className='gqs-notice gqs-notice-error' role='alert'>
          {loadError || 'Could not load Groq Speech settings.'}
        </p>
        <div className='gqs-footer'>
          <Button onClick={() => { loadAll() }}>Retry</Button>
        </div>
      </div>
    )
  }

  if (form === null) return null

  const modelOptions: SelectOption[] = MODEL_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }))

  if (!modelOptions.some((option) => option.value === form.model)) {
    modelOptions.push({ value: form.model, label: form.model })
  }

  const languageOptions: SelectOption[] = LANGUAGES.map((code) => ({
    value: code,
    label: languageLabel(code),
  }))

  if (!languageOptions.some((option) => option.value === form.language)) {
    languageOptions.push({ value: form.language, label: languageLabel(form.language) })
  }

  const currentPolish = encodeModelValue(form.polish.provider, form.polish.model)
  const polishOptions: SelectOption[] = [{ value: '', label: 'No polishing' }]

  for (const model of models) {
    polishOptions.push({
      value: encodeModelValue(model.provider, model.model),
      label: model.providerName + ' — ' + model.modelName,
    })
  }

  if (currentPolish && !polishOptions.some((option) => option.value === currentPolish)) {
    polishOptions.push({
      value: currentPolish,
      label: form.polish.provider + ' — ' + form.polish.model,
    })
  }

  const polishDisabled = modelsLoading || (models.length === 0 && !currentPolish)
  const footerText = savingSettings ? 'Saving…' : (notice !== null ? notice.text : '')
  const footerKind = notice !== null && notice.kind === 'error' ? 'error' : 'success'
  const voiceLabel = !voice.available ? 'Not detected' : (voice.selected ? 'Selected' : 'Not selected')

  return (
    <div className='gqs-section'>
      <Row
        key='key'
        title='Groq API key'
        badge={(
          <Status
            state={configured ? 'on' : 'off'}
            label={configured ? 'Configured' : 'Not configured'}
            hint={configured
              ? 'A shared ' + envVar + ' credential is available to Groq Speech.'
              : 'No shared ' + envVar + ' credential is available yet. Add it in Settings → Models.'}
          />
        )}
        description={keyDescription()}
        control={<Link onClick={handleModelsLink}>Settings → Models</Link>}
      />
      <Row
        key='voice'
        title='Voice input provider'
        badge={(
          <Status
            state={voice.selected ? 'on' : 'off'}
            label={voiceLabel}
            hint={voice.selected
              ? 'The microphone uses Groq Whisper for speech recognition.'
              : voice.available
                ? 'The official voice-input settings select a different recognition service.'
                : 'The official voice-input service did not report a provider list.'}
          />
        )}
        description={voiceDescription()}
        control={voice.available
          ? (
            <div className='gqs-actions'>
              {voice.selectable && !voice.selected
                ? (
                  <Button compact disabled={selectingVoice} onClick={() => { selectVoiceProvider() }}>
                    {selectingVoice ? 'Selecting…' : 'Use Groq Whisper'}
                  </Button>
                  )
                : null}
              <Link onClick={handleVoiceLink}>Voice input settings</Link>
            </div>
            )
          : null}
      />
      <Row
        key='model'
        title='Whisper model'
        description='Model used to transcribe speech. Turbo is the fastest default.'
        htmlFor={ID.model}
        control={(
          <Select
            id={ID.model}
            value={form.model}
            options={modelOptions}
            onChange={(value) => patchForm({ model: value as GroqSpeechSettings['model'] })}
          />
        )}
      />
      <Row
        key='language'
        title='Language hint'
        description='Auto-detect lets Whisper guess the language; pin one to improve accuracy on short recordings.'
        htmlFor={ID.language}
        control={(
          <Select
            id={ID.language}
            value={form.language}
            options={languageOptions}
            onChange={(value) => patchForm({ language: value })}
          />
        )}
      />
      <Row
        key='polish-model'
        title='Polish model'
        description='Choose any model exposed by DSH, including Groq. No polishing keeps the raw transcript; any failure also falls back to it.'
        htmlFor={ID.polishModel}
        control={(
          <Select
            id={ID.polishModel}
            value={currentPolish}
            options={polishOptions}
            disabled={polishDisabled}
            onChange={(value) => {
              const next = decodeModelValue(value)

              patchPolish({ provider: next.provider, model: next.model })
            }}
          />
        )}
      />
      {modelsError
        ? (
          <div className='gqs-row' key='models-error'>
            <div className='gqs-text'>
              <div className='gqs-desc'>{modelsError}</div>
            </div>
            <div className='gqs-control'>
              <Button variant='secondary' compact disabled={modelsLoading} onClick={() => { loadModels() }}>
                {modelsLoading ? 'Loading…' : 'Retry'}
              </Button>
            </div>
          </div>
          )
        : null}
      {models.length === 0 && !modelsError
        ? (
          <div className='gqs-row' key='models-empty'>
            <div className='gqs-text'>
              <div className='gqs-desc'>
                No polish models were found. Configure a provider in DSH Settings → Models, then retry.
              </div>
            </div>
          </div>
          )
        : null}
      <Row
        key='polish-prompt'
        title='Polish prompt (optional)'
        description='Used only when a Polish model is selected. Leave empty to use the built-in default prompt.'
        prompt
        htmlFor={ID.prompt}
        control={(
          <Textarea
            id={ID.prompt}
            value={form.polish.prompt}
            placeholder={DEFAULT_POLISH_PROMPT}
            maxLength={MAX_PROMPT_CHARS}
            onChange={(value) => patchPolish({ prompt: value })}
          />
        )}
      />
      {savingSettings || notice
        ? (
          <div className='gqs-footer'>
            <p
              className={'gqs-notice gqs-notice-' + footerKind}
              role={!savingSettings && footerKind === 'error' ? 'alert' : 'status'}
              aria-live='polite'
            >
              {footerText}
            </p>
          </div>
          )
        : null}
      {notice !== null && notice.kind === 'error' && !savingSettings
        ? <Notice kind='error' text={notice.text} />
        : null}
    </div>
  )
}
