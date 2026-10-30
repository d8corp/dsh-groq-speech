/**
 * @jest-environment node
 */

/**
 * Polish pass: prompt resolution and the hard guarantee that any LLM failure
 * returns the raw transcript unchanged.
 *
 * `@deepseek-ai/dsh-llm` is a runtime peer of the installed DSH profile, not of
 * this checkout, so the Jest module mapper points that specifier at a tiny
 * fixture. That lets the real streaming code path run fully offline.
 */

import assert from 'node:assert/strict'

import { DEFAULT_POLISH_PROMPT } from '../src/constants'
import { polishTranscript, resolvePolishPrompt } from '../src/polish'

interface StreamChunk {
  type: string
  text?: string
  reason?: { kind: string }
}

interface Capture {
  prepare?: Record<string, unknown>
  stream?: Record<string, any>
}

/**
 * A fake prepared call whose stream yields the supplied chunks.
 *
 * @param chunks chunks to yield.
 * @param capture object filled with the call options.
 * @returns a `prepareCall` implementation.
 */
function streamCall (chunks: StreamChunk[], capture?: Capture) {
  return async (callOptions: Record<string, unknown>) => {
    return {
      config: { temperature: 0.2 },
      async * stream (streamOptions: Record<string, unknown>) {
        if (capture) Object.assign(capture, { prepare: callOptions, stream: streamOptions })

        for (const chunk of chunks) yield chunk
      },
    }
  }
}

test('resolvePolishPrompt prefers a non-empty custom prompt and falls back to the default', () => {
  assert.equal(resolvePolishPrompt({ polish: { prompt: '  Fix punctuation.  ' } }), 'Fix punctuation.')
  assert.equal(resolvePolishPrompt({ polish: { prompt: '   ' } }), DEFAULT_POLISH_PROMPT)
  assert.equal(resolvePolishPrompt({ polish: { prompt: '' } }), DEFAULT_POLISH_PROMPT)
  assert.equal(resolvePolishPrompt({ polish: { prompt: 42 } }), DEFAULT_POLISH_PROMPT)
  assert.equal(resolvePolishPrompt({}), DEFAULT_POLISH_PROMPT)
  assert.equal(resolvePolishPrompt(null), DEFAULT_POLISH_PROMPT)
  assert.match(DEFAULT_POLISH_PROMPT, /editor/i)
})

test('polishTranscript returns blank text untouched without calling the LLM', async () => {
  let called = false
  const ctx = {
    llm: {
      async prepareCall () {
        called = true
        throw new Error('must not be called')
      },
    },
  }

  assert.equal(await polishTranscript({ ctx, text: '   ', provider: 'p', model: 'm' }), '   ')
  assert.equal(called, false)
})

test('polishTranscript returns the raw text when the LLM route is incomplete', async () => {
  const cases = [
    { ctx: undefined, provider: 'p', model: 'm' },
    { ctx: {}, provider: 'p', model: 'm' },
    { ctx: { llm: {} }, provider: 'p', model: 'm' },
    {
      ctx: { llm: { prepareCall: async () => ({ stream: async function * () { yield { type: 'text-delta', text: 'x' } } }) } },
      provider: '',
      model: 'm',
    },
    {
      ctx: { llm: { prepareCall: async () => ({ stream: async function * () { yield { type: 'text-delta', text: 'x' } } }) } },
      provider: 'p',
      model: '',
    },
  ]

  for (const options of cases) {
    const result = await polishTranscript({ ...options, text: 'raw transcript' })

    assert.equal(result, 'raw transcript')
  }
})

test('polishTranscript returns the raw transcript when the stream throws', async () => {
  const ctx = {
    llm: {
      async prepareCall () {
        return {
          config: {},
          async * stream () {
            yield { type: 'text-delta', text: 'partial output' }
            throw new Error('stream exploded')
          },
        }
      },
    },
  }

  const result = await polishTranscript({ ctx, text: 'raw transcript', provider: 'p', model: 'm' })

  assert.equal(result, 'raw transcript', 'a partial polish result is never returned')
})

test('polishTranscript returns the raw transcript on an error finish chunk', async () => {
  const ctx = {
    llm: {
      prepareCall: streamCall([
        { type: 'text-delta', text: 'partial' },
        { type: 'finish', reason: { kind: 'error' } },
      ]),
    },
  }

  assert.equal(
    await polishTranscript({ ctx, text: 'raw transcript', provider: 'p', model: 'm' }),
    'raw transcript',
  )
})

test('polishTranscript returns the raw transcript when prepareCall rejects', async () => {
  const ctx = {
    llm: {
      async prepareCall () {
        throw new Error('no route')
      },
    },
  }

  assert.equal(
    await polishTranscript({ ctx, text: 'raw transcript', provider: 'p', model: 'm' }),
    'raw transcript',
  )
})

test('polishTranscript streams text deltas, trims and passes the prompt as system', async () => {
  const capture: Capture = {}
  const ctx = {
    llm: {
      prepareCall: streamCall([
        { type: 'text-delta', text: '  Привет, ' },
        { type: 'text-delta', text: 'мир!  ' },
        { type: 'finish', reason: { kind: 'stop' } },
      ], capture),
    },
  }

  const result = await polishTranscript({
    ctx,
    text: 'привет мир',
    provider: 'alpha',
    model: 'alpha-large',
    prompt: 'Fix punctuation.',
  })

  assert.equal(result, 'Привет, мир!')
  assert.equal(capture.prepare?.provider, 'alpha')
  assert.equal(capture.prepare?.model, 'alpha-large')
  assert.equal(capture.stream?.system, 'Fix punctuation.')
  assert.equal(capture.stream?.messages.length, 1)
  assert.equal(capture.stream?.messages[0].role, 'user')
  assert.deepEqual(capture.stream?.messages[0].content, [{ type: 'text', text: 'привет мир' }])
  assert.equal(capture.stream?.temperature, 0.2, 'prepared.config is forwarded to the stream')
})

test('polishTranscript falls back to the raw text when the model returns nothing', async () => {
  const ctx = { llm: { prepareCall: streamCall([{ type: 'finish', reason: { kind: 'stop' } }]) } }

  assert.equal(
    await polishTranscript({ ctx, text: 'raw transcript', provider: 'p', model: 'm' }),
    'raw transcript',
  )
})
