# dsh-groq-speech

Groq Whisper speech recognition for DSH voice input: a cloud `groq-whisper`
provider in the microphone picker, optional LLM polishing of the transcript,
and a settings page that reuses the shared `GROQ_API_KEY` credential from
**Settings → Models**.

## What it does

- Registers the `groq-whisper` provider with the official DSH voice input.
- Uploads the recording (16 kHz mono PCM16 WAV) to Groq:
  `POST https://api.groq.com/openai/v1/audio/transcriptions`.
- Optionally polishes the transcript through any model configured in DSH
  (**Settings → Models**) to fix punctuation and obvious recognition errors.
- Uses the shared Groq key from **Settings → Models** and never sends it to the
  browser.

## Requirements

- DSH `0.2.1-rc.2` or newer, Node.js 22.
- The official voice-input bundle
  `@deepseek-ai/dsh-experimental-voice-input-bundle` enabled and listed in
  `dsh.profile.bundles` for the `web` profile. It provides `ctx.speechToText`
  and the microphone button; without it the plugin loads but the provider is
  not offered.
- A Groq account and API key: <https://console.groq.com/keys>.

## Installation

The publishable package is generated into `release/` by `npm run build`. Install
that directory (the repository root only contains sources and dev tooling):

```sh
npm install
npm run build
dsh plugin --profile web add file:/site/dsh/dsh-groq-speech/release
```

From npm:

```sh
dsh plugin --profile web add dsh-groq-speech
```

From git (build `release/` before installing, or publish from CI):

```sh
npm install && npm run build
dsh plugin --profile web add file:/path/to/dsh-groq-speech/release
```

Reload the Web GUI after installing. If the **Settings → Groq Speech** section
or the microphone provider is missing, restart `dsh web`.

## Configuring the key

1. Open **Settings → Models**.
2. Add or select the **Groq** provider and enter its API key.
3. Groq Speech uses the same `GROQ_API_KEY` credential automatically; there is
   no separate key field in the plugin settings.
4. On **Settings → Groq Speech**, the **Settings → Models** link opens that
   section, and the key row shows whether the credential is configured.

The plugin stores no copy of the key and cannot set or clear it. The key from
Models is used both for Whisper transcription and for Groq models.

## Recognition settings

- **Whisper model**: `whisper-large-v3-turbo` (default, fast),
  `whisper-large-v3` (more accurate), or `distil-whisper-large-v3-en`
  (English only, fastest).
- **Language hint**: `auto` (detect automatically) or one of the offered
  languages.
- Model, language and polish changes are saved automatically.

## Polishing

Polishing runs when a model is selected in **Polish model**. Choose
**No polishing** to keep the raw transcript. The list is built from the models
exposed by the DSH agent, so Groq appears automatically once it is configured in
**Settings → Models**. Polishing goes through the DSH model route and does not
use the Groq Speech key. A custom prompt can be provided; an empty field uses the
built-in default.

If the model is unavailable, the request fails, a timeout fires, or the stream
breaks, the provider returns the **raw transcript**. The user's words are never
lost.

## Security

- The Groq key lives in **DSH credentials** (reference `GROQ_API_KEY`) and is
  configured in **Settings → Models**; the plugin settings file never contains
  it.
- Settings are stored at `$DSH_HOME/dsh-groq-speech/groq-speech.json` (or
  `~/.dsh/dsh-groq-speech/groq-speech.json`). A 0.1.0 file at
  `$DSH_HOME/groq-speech.json` is read as a one-time fallback and is never
  modified.
- The browser receives only `{ configured, source, writable }` plus the
  non-secret settings. The key, its prefix and its length are never returned.
- The plugin has no API actions to set or clear the key: the Groq Speech page
  shows a **Configured** / **Not configured** badge and links to Models.
- The `GROQ_API_KEY` environment variable is a read-only fallback; a stored key
  takes priority.
- The settings file is written atomically (temporary file + rename) with mode
  `0600`, and every browser API request is fenced to loopback / trusted hosts,
  same-origin and a live DSH browser session (when the `connection` service is
  available).
- Audio is sent to Groq (`api.groq.com`). With polishing enabled, the transcript
  is sent to the selected DSH provider. No other network requests are made.
- Groq errors are surfaced as fixed messages; response bodies and keys are never
  included.
- Removing the bundle from the profile manifest lets the host delete the plugin
  data directory after a short confirmation window; disabling or reloading the
  plugin never deletes settings.

## The provider in the UI

The voice-input microphone picker shows **Groq Whisper** marked `cloud`. There is
no preparation (model download) step; the provider is ready immediately.

## Troubleshooting

| Symptom | What to do |
|---|---|
| `Groq API key is not configured` | Add a key for the Groq provider in Settings → Models. |
| `Groq rejected the API key` (401/403) | The key was revoked or copied incorrectly. Create a new one at console.groq.com/keys and update it in Settings → Models. |
| `Groq rate limit reached` (429) | The Groq quota is exhausted. Wait or check the plan and limits in the Groq console. |
| `Groq is unavailable` (5xx) | Groq-side failure; retry later. |
| `Could not reach Groq` | No network, DNS failure, or a proxy blocking `api.groq.com`. |
| Provider missing from the microphone picker | Enable the official voice-input bundle, make sure the plugin is added to the `web` profile, and restart DSH. |
| No Settings → Groq Speech section | Reload the page with the cache cleared; if that does not help, restart DSH. |
| Polishing does not run | Select a provider and model under Polish; settings save automatically. Any failure keeps the raw text. |

## Tests

```sh
npm test
```

The suite is fully offline: no real keys are needed, Groq is never contacted,
and a local `http` server imitates the API. Tests run with Jest and ts-jest; the
`@deepseek-ai/dsh-llm` peer is mapped to a tiny local fixture. The tests do not
load DSH.

## Build

```sh
npm run build        # theme → client bundle → release/
npm run build:client # only client/client.js
npm test             # Jest
npm run lint         # ESLint over src/
```

`npm run build` writes:

- `client/client.js` — the browser half loaded by the shell's ModuleLoader;
- `release/` — the publishable package (`index.mjs`, host modules, types,
  `cordis.patch.yml` and the client bundle).

## Layout

```
dsh-groq-speech/
├── package.json          plugin manifest and build scripts
├── cordis.patch.yml      adds the plugin to the web profile
├── theme.scss            settings-section styles (inlined at build time)
├── buildEnv.ts           compiles theme.scss into .env.theme
├── src/
│   ├── constants.ts      shared constants
│   ├── contracts.ts      host/UI type shapes
│   ├── atomicFile.ts     atomic 0600 writes
│   ├── settings.ts       settings read, validation and persistence
│   ├── fence.ts          same-origin guard and JSON responses
│   ├── groq.ts           Groq multipart request and error mapping
│   ├── polish.ts         optional LLM polishing with fallback
│   ├── provider.ts       the `groq-whisper` SpeechProvider
│   ├── api.ts            browser JSON API
│   ├── uninstall.ts      post-uninstall data cleanup
│   ├── index.ts          host plugin entry
│   ├── client.ts         ModuleLoader registration
│   ├── components/       Settings → Groq Speech React section
│   ├── ui/               small React controls
│   └── utils/            API client, styling and form helpers
├── test/                 offline Jest suites and helpers
├── client/client.js      generated browser bundle
├── release/              generated publishable package
├── README.md
└── LICENSE
```

## License

MIT. See [LICENSE](LICENSE).
