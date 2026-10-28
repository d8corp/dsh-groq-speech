// SPDX-License-Identifier: MIT
// dsh-groq-speech — browser half: the Settings → Groq Speech section.
//
// Loaded by dsh-client-modules through the shipped ModuleLoader CJS envelope.
// The factory body is plain script (no JSX, no bundler): only require('react')
// is resolved from the shell's module table. One small stylesheet is injected
// into document.head so rows match the shell's General settings; the only
// network target is the plugin's own same-origin route /groq-speech/api.
//
// Privacy: the Groq key is managed only in Settings → Models. This section
// never renders a key input and never receives key material from the host; it
// only shows whether the shared GROQ_API_KEY credential is configured.

window.__ModuleLoader__.load({
	id: "dsh-groq-speech",
	factory: (require) => {
		const React = require("react");
		const h = React.createElement;

		//#region constants (mirror lib/constants.js; the client has no bundler)
		/** Same-origin browser API prefix (host route). */
		const API_URL = "/groq-speech/api";
		/** Settings section identity. */
		const SECTION_ID = "groq-speech";
		const SECTION_ORDER = 30;
		const SECTION_LABEL = "Groq Speech";
		/** Shared credential used by Groq Speech and the DSH Groq provider. */
		const ENV_VAR = "GROQ_API_KEY";
		/** Server-side prompt cap; enforce it in the textarea too. */
		const MAX_PROMPT_CHARS = 4000;
		/** Selectable transcription models. */
		const MODEL_OPTIONS = [
			{ value: "whisper-large-v3-turbo", label: "whisper-large-v3-turbo (fast, default)" },
			{ value: "whisper-large-v3", label: "whisper-large-v3 (most accurate)" },
			{ value: "distil-whisper-large-v3-en", label: "distil-whisper-large-v3-en (English only, fastest)" }
		];
		const DEFAULT_MODEL = MODEL_OPTIONS[0].value;
		/** Provider language hints; `auto` lets Whisper detect the language. */
		const LANGUAGES = [
			"auto",
			"ru",
			"en",
			"uk",
			"de",
			"fr",
			"es",
			"it",
			"pt",
			"nl",
			"pl",
			"tr",
			"zh",
			"ja",
			"ko"
		];
		/** Default polish prompt, used as the textarea placeholder. */
		const DEFAULT_POLISH_PROMPT = [
			"You are an editor of speech-to-text transcripts.",
			"Fix punctuation, capitalization, and obvious recognition errors,",
			"remove filler words and repetitions.",
			"Do not add new information, do not change the meaning, and do not translate the text.",
			"Return only the corrected text without explanations."
		].join(" ");
		/** Provider/model select value separator (never user-visible). */
		const MODEL_VALUE_SEPARATOR = "\u0000";
		/** Stable element ids for label/input pairing. */
		const ID = {
			model: "groq-speech-model",
			language: "groq-speech-language",
			polishModel: "groq-speech-polish-model",
			prompt: "groq-speech-polish-prompt"
		};
		//#endregion

		//#region host API
		/**
		 * POST one action to the plugin's same-origin route and unwrap the host
		 * envelope: `{ ok: true, value }` or `{ ok: false, error: { code, message } }`.
		 * Request/response bodies are never logged.
		 */
		async function callApi(action, extra) {
			const body = Object.assign({ action }, extra || {});
			const response = await fetch(API_URL, {
				method: "POST",
				headers: { "content-type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify(body)
			});
			let payload = null;
			try {
				payload = await response.json();
			} catch (error) {
				payload = null;
			}
			if (payload && typeof payload === "object" && payload.ok === false) {
				throw new Error(safeMessage(payload.error && payload.error.message));
			}
			if (!response.ok) {
				throw new Error("Groq Speech request failed (HTTP " + response.status + ").");
			}
			if (!payload || typeof payload !== "object") {
				throw new Error("Groq Speech returned an unreadable response.");
			}
			return Object.prototype.hasOwnProperty.call(payload, "value") ? payload.value : payload;
		}

		/** Collapse an unknown thrown value into a display-safe single line. */
		function safeMessage(value) {
			if (typeof value === "string" && value.trim()) return value.trim();
			if (value && typeof value.message === "string" && value.message.trim()) return value.message.trim();
			return "Something went wrong. Please try again.";
		}

		/** Normalize the `status` value, keeping any embedded settings blob. */
		function normalizeStatus(value) {
			const source = value && typeof value === "object" ? value : {};
			const rawSource = source.source === "stored" || source.source === "env" ? source.source : null;
			return {
				configured: source.configured === true,
				source: rawSource,
				writable: source.writable !== false,
				envVar: typeof source.envVar === "string" && source.envVar ? source.envVar : ENV_VAR,
				settings: source.settings && typeof source.settings === "object" ? source.settings : null
			};
		}

		/** Normalize a settings document to the shape the form edits. */
		function normalizeSettings(value) {
			const source = value && typeof value === "object" ? value : {};
			const polish = source.polish && typeof source.polish === "object" ? source.polish : {};
			return {
				model: typeof source.model === "string" && source.model ? source.model : DEFAULT_MODEL,
				language: typeof source.language === "string" && source.language ? source.language : "auto",
				polish: {
					provider: typeof polish.provider === "string" ? polish.provider : "",
					model: typeof polish.model === "string" ? polish.model : "",
					prompt: typeof polish.prompt === "string" ? polish.prompt : ""
				}
			};
		}

		/** Stable comparison string for the fields the autosave persists. */
		function settingsSnapshot(value) {
			const settings = normalizeSettings(value);
			return JSON.stringify({
				model: settings.model,
				language: settings.language,
				polish: {
					provider: settings.polish.provider,
					model: settings.polish.model,
					prompt: settings.polish.prompt
				}
			});
		}

		/** Normalize the `list-models` value into usable rows. */
		function normalizeModels(value) {
			const list = Array.isArray(value) ? value : [];
			const rows = [];
			for (const item of list) {
				if (!item || typeof item !== "object") continue;
				const provider = typeof item.provider === "string" ? item.provider : "";
				const model = typeof item.model === "string" ? item.model : "";
				if (!provider || !model) continue;
				rows.push({
					provider,
					providerName: typeof item.providerName === "string" && item.providerName ? item.providerName : provider,
					model,
					modelName: typeof item.modelName === "string" && item.modelName ? item.modelName : model
				});
			}
			return rows;
		}

		/** Encode/decode the provider+model pair carried by one select value. */
		function encodeModelValue(provider, model) {
			if (!provider || !model) return "";
			return provider + MODEL_VALUE_SEPARATOR + model;
		}

		function decodeModelValue(value) {
			const text = typeof value === "string" ? value : "";
			const index = text.indexOf(MODEL_VALUE_SEPARATOR);
			if (index < 0) return { provider: "", model: "" };
			return { provider: text.slice(0, index), model: text.slice(index + 1) };
		}

		/** Language option label: `auto` is spelled out, codes are uppercase. */
		function languageLabel(value) {
			return value === "auto" ? "Auto-detect" : String(value).toUpperCase();
		}
		//#endregion

		//#region styles (one injected stylesheet, General-settings rows)
		const STYLE_ID = "@dsh-groq-speech/settings.css";
		const CSS = `
.gqs-section{display:flex;flex-direction:column;width:100%;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.gqs-row{border-bottom:.5px solid var(--dsw-alias-border-l2);display:flex;align-items:center;gap:8px;padding:16px 0}
.gqs-row:last-of-type{border-bottom:none}
.gqs-text{display:flex;flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:48px}
.gqs-titleRow{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.gqs-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:400;line-height:22px}
.gqs-badge{display:inline-flex;align-items:center;gap:5px;flex:none;border:.5px solid transparent;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px;white-space:nowrap}
.gqs-badge-on{background:var(--dsw-alias-bg-module-platform);border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.gqs-badge-off{background:var(--dsw-alias-bg-module-platform);border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.gqs-dot{width:6px;height:6px;flex:none;border-radius:50%;background:currentColor}
.gqs-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;line-height:18px}
.gqs-desc code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px}
.gqs-control{display:flex;align-items:center;gap:8px;flex:none;min-width:0}
.gqs-link{color:var(--dsw-alias-link);font:inherit;text-decoration:none;white-space:nowrap;cursor:pointer}
.gqs-link:hover{text-decoration:underline}
.gqs-selectWrap{position:relative;display:inline-flex;align-items:center;min-width:0}
.gqs-select{appearance:none;-webkit-appearance:none;box-sizing:border-box;border:none;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);height:36px;max-width:320px;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:14px;line-height:22px;padding:0 36px 0 14px}
.gqs-select:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.gqs-select:disabled{cursor:default;opacity:.5}
.gqs-select:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.gqs-chevron{position:absolute;right:12px;color:var(--dsw-alias-label-caption);pointer-events:none;flex:none}
.gqs-textarea{box-sizing:border-box;width:100%;min-height:96px;resize:vertical;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;padding:8px 12px;outline:none}
.gqs-textarea::placeholder{color:var(--dsw-alias-label-caption)}
.gqs-textarea:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-state-business-primary)}
.gqs-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;border-radius:var(--dsw-radius-md);border:none;padding:0 14px;font:inherit;font-size:14px;line-height:22px;cursor:pointer;white-space:nowrap}
.gqs-button:disabled{opacity:.4;cursor:default}
.gqs-button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.gqs-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:500}
.gqs-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.gqs-secondary{border:.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary)}
.gqs-secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.gqs-compact{height:28px;padding:0 10px;font-size:12px;line-height:18px}
.gqs-row-prompt{flex-direction:column;align-items:stretch;gap:10px}
.gqs-row-prompt .gqs-text{padding-right:0}
.gqs-footer{display:flex;align-items:center;gap:16px;padding:16px 0 0}
.gqs-footer .gqs-notice{flex:1;min-width:0}
.gqs-footer .gqs-button{margin-left:auto}
.gqs-notice{margin:0;font-size:12px;line-height:18px}
.gqs-notice-success{color:var(--dsw-alias-state-success-primary)}
.gqs-notice-error{color:var(--dsw-alias-state-error-primary)}
.gqs-loading{border-bottom:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);padding:16px 0;font-size:12px;line-height:18px}
@media (max-width:640px){
.gqs-row{flex-wrap:wrap}
.gqs-text{padding-right:0;flex-basis:100%}
.gqs-control{width:100%;align-items:stretch}
.gqs-selectWrap,.gqs-select{width:100%;max-width:none}
}
`;

		/** Inject the section stylesheet once per document. */
		function ensureStyles() {
			if (typeof document === "undefined" || !document.head) return;
			if (document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-groq-speech";
			tag.dataset.pluginCss = STYLE_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		ensureStyles();

		/** Inline chevron that matches the shell's select controls. */
		function selectChevron() {
			return h(
				"svg",
				{
					className: "gqs-chevron",
					viewBox: "0 0 16 16",
					width: 14,
					height: 14,
					"aria-hidden": "true"
				},
				h("path", {
					d: "M4 6l4 4 4-4",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			);
		}

		/** One General-style row: title + description left, control right. */
		function settingsRow({ key, title, description, control, prompt, htmlFor, badge }) {
			const titleNode = htmlFor
				? h("label", { className: "gqs-title", htmlFor }, title)
				: h("span", { className: "gqs-title" }, title);
			return h(
				"div",
				{ key, className: prompt ? "gqs-row gqs-row-prompt" : "gqs-row" },
				h(
					"div",
					{ className: "gqs-text" },
					h("div", { className: "gqs-titleRow" }, titleNode, badge || null),
					description ? h("div", { className: "gqs-desc" }, description) : null
				),
				prompt ? control : h("div", { className: "gqs-control" }, control)
			);
		}

		/** A select with the shell's 36px module background and chevron. */
		function selectControl({ id, value, disabled, onChange, options }) {
			return h(
				"span",
				{ className: "gqs-selectWrap" },
				h(
					"select",
					{
						id,
						className: "gqs-select",
						value,
						disabled,
						onChange
					},
					options.map((option) =>
						h("option", { key: option.value, value: option.value }, option.label)
					)
				),
				selectChevron()
			);
		}
		//#endregion

		/**
		 * Activate the built-in Models section in the already-open settings
		 * panel. The shell does not expose a navigation callback to section
		 * components, so mirror its order and click the matching nav cell. The
		 * lookup is by slot id, never by a guessed URL or a localized label.
		 */
		function openModelsSection(ctx) {
			if (typeof document === "undefined") return false;
			const panel = document.querySelector('[data-shortcut-modal="settings"]');
			if (panel === null) return false;
			let index = -1;
			try {
				const rows = ctx.slots
					.entries("settings.section")
					.map((entry) => ({
						id: entry && entry.options ? entry.options.id : "",
						order: entry && entry.options && typeof entry.options.order === "number"
							? entry.options.order
							: 0
					}))
					.sort((left, right) => left.order - right.order);
				index = rows.findIndex((row) => row.id === "models");
			} catch (error) {
				index = -1;
			}
			const buttons = panel.querySelectorAll("nav > div:last-child button");
			if (index < 0 || !buttons[index]) return false;
			buttons[index].click();
			return true;
		}

		//#region settings section component
		/**
		 * The Settings → Groq Speech page: key guidance, recognition, polish.
		 * The shell's `close` prop is deliberately ignored — this form never
		 * navigates away; the key link switches to the Models section instead.
		 */
		function GroqSpeechSection({ openModels }) {
			/** Page lifecycle: loading | ready | error. */
			const [phase, setPhase] = React.useState("loading");
			const [loadError, setLoadError] = React.useState("");
			/** Host key status: { configured, source, writable, envVar, settings }. */
			const [statusValue, setStatusValue] = React.useState(null);
			/** Editable copy of the persisted settings. */
			const [form, setForm] = React.useState(null);
			/** LLM models for the polish picker. */
			const [models, setModels] = React.useState([]);
			const [modelsError, setModelsError] = React.useState("");
			const [modelsLoading, setModelsLoading] = React.useState(false);
			const [savingSettings, setSavingSettings] = React.useState(false);
			/** Inline status: { text, kind: 'saved' | 'error' } | null. */
			const [notice, setNotice] = React.useState(null);
			/** Autosave refs: one debounced write, serialized in order. */
			const saveTimerRef = React.useRef(null);
			const saveInFlightRef = React.useRef(false);
			const inFlightSnapshotRef = React.useRef("");
			const queuedSaveRef = React.useRef(null);
			const latestFormRef = React.useRef(null);
			const persistedSnapshotRef = React.useRef("");
			const editVersionRef = React.useRef(0);
			const mountedRef = React.useRef(true);

			/** Keep the editable copy and schedule one debounced write. */
			function commitForm(next) {
				editVersionRef.current += 1;
				latestFormRef.current = next;
				setForm(next);
				scheduleSettingsSave(next);
			}

			/** Merge edits into the editable settings copy. */
			function patchForm(patch) {
				commitForm(Object.assign({}, latestFormRef.current, patch));
			}

			/** Merge edits into the polish sub-object. */
			function patchPolish(patch) {
				commitForm(Object.assign({}, latestFormRef.current, {
					polish: Object.assign({}, latestFormRef.current.polish, patch)
				}));
			}

			/** Install settings loaded from the host without triggering autosave. */
			function applyLoadedSettings(nextSettings) {
				const next = normalizeSettings(nextSettings);
				latestFormRef.current = next;
				persistedSnapshotRef.current = settingsSnapshot(next);
				setForm(next);
			}

			/** Debounce rapid edits (notably prompt typing) into one write. */
			function scheduleSettingsSave(next) {
				if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
				saveTimerRef.current = setTimeout(() => {
					saveTimerRef.current = null;
					void persistSettings(next);
				}, 500);
			}

			/**
			 * Persist one settings snapshot. Writes are serialized so a slow
			 * earlier request can never overwrite a newer edit.
			 */
			async function persistSettings(settings) {
				if (!settings) return;
				const snapshot = settingsSnapshot(settings);
				if (saveInFlightRef.current) {
					if (snapshot !== inFlightSnapshotRef.current) queuedSaveRef.current = settings;
					return;
				}
				if (snapshot === persistedSnapshotRef.current) return;

				saveInFlightRef.current = true;
				inFlightSnapshotRef.current = snapshot;
				const version = editVersionRef.current;
				if (mountedRef.current) setSavingSettings(true);
				try {
					const value = await callApi("set-settings", {
						patch: {
							model: settings.model,
							language: settings.language,
							polish: {
								provider: settings.polish.provider,
								model: settings.polish.model,
								prompt: settings.polish.prompt
							}
						}
					});
					const saved = normalizeSettings(value && value.settings ? value.settings : settings);
					persistedSnapshotRef.current = settingsSnapshot(saved);
					if (mountedRef.current && version === editVersionRef.current) {
						latestFormRef.current = saved;
						setForm(saved);
						setNotice({ text: "Saved", kind: "saved" });
					}
				} catch (error) {
					if (mountedRef.current) {
						setNotice({ text: safeMessage(error), kind: "error" });
					}
				} finally {
					saveInFlightRef.current = false;
					inFlightSnapshotRef.current = "";
					if (mountedRef.current) setSavingSettings(false);
					const queued = queuedSaveRef.current;
					queuedSaveRef.current = null;
					if (queued) void persistSettings(queued);
				}
			}

			/** Flush the pending debounce when the section unmounts. */
			function flushPendingSettings() {
				if (saveTimerRef.current === null) return;
				clearTimeout(saveTimerRef.current);
				saveTimerRef.current = null;
				const pending = latestFormRef.current;
				if (pending && settingsSnapshot(pending) !== persistedSnapshotRef.current) {
					void persistSettings(pending);
				}
			}

			/** Mount load: status + settings + model list (models may fail softly). */
			async function loadAll() {
				setPhase("loading");
				setLoadError("");
				setModelsError("");
				setNotice(null);
				const [statusResult, settingsResult, modelsResult] = await Promise.allSettled([
					callApi("status"),
					callApi("get-settings"),
					callApi("list-models")
				]);
				if (statusResult.status !== "fulfilled") {
					setPhase("error");
					setLoadError(safeMessage(statusResult.reason) || "Could not load Groq Speech status.");
					return;
				}
				const nextStatus = normalizeStatus(statusResult.value);
				let nextSettings = null;
				if (settingsResult.status === "fulfilled" && settingsResult.value && settingsResult.value.settings) {
					nextSettings = normalizeSettings(settingsResult.value.settings);
				} else if (nextStatus.settings) {
					nextSettings = normalizeSettings(nextStatus.settings);
				} else {
					nextSettings = normalizeSettings(null);
				}
				setStatusValue(nextStatus);
				applyLoadedSettings(nextSettings);
				if (modelsResult.status === "fulfilled") {
					setModels(normalizeModels(modelsResult.value));
					setModelsError("");
				} else {
					setModels([]);
					setModelsError(safeMessage(modelsResult.reason) || "Could not load the model list.");
				}
				setPhase("ready");
			}

			/** Retry just the model list, keeping the rest of the form usable. */
			async function loadModels() {
				setModelsLoading(true);
				setModelsError("");
				try {
					const list = await callApi("list-models");
					setModels(normalizeModels(list));
				} catch (error) {
					setModels([]);
					setModelsError(safeMessage(error));
				} finally {
					setModelsLoading(false);
				}
			}

			React.useEffect(() => {
				let cancelled = false;
				mountedRef.current = true;
				(async () => {
					await loadAll();
					if (cancelled) return;
				})();
				return () => {
					cancelled = true;
					mountedRef.current = false;
					// The component is going away: flush the last debounced edit.
					flushPendingSettings();
				};
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, []);

			/** Explain where the shared key lives; never render key material. */
			function keyDescription() {
				if (statusValue && statusValue.configured) {
					return "Configured through the shared " + ENV_VAR + " credential. Groq Speech uses the same key as the Groq provider; manage it only in Settings → Models.";
				}
				return "No Groq API key is configured. Add it in Settings → Models; Groq Speech will use the same " + ENV_VAR + " credential automatically.";
			}

			/** Visible key-status pill; reports presence only, never key material. */
			function keyStatusBadge() {
				const configured = !!(statusValue && statusValue.configured);
				const label = configured ? "Configured" : "Not configured";
				const hint = configured
					? "A shared " + ENV_VAR + " credential is available to Groq Speech."
					: "No shared " + ENV_VAR + " credential is available yet. Add it in Settings → Models.";
				return h(
					"span",
					{
						className: configured ? "gqs-badge gqs-badge-on" : "gqs-badge gqs-badge-off",
						title: hint,
						"aria-label": "Groq API key status: " + label
					},
					h("span", { className: "gqs-dot", "aria-hidden": "true" }),
					label
				);
			}

			/** Non-editable key row with a link to the built-in Models section. */
			function renderKeyInfo() {
				return settingsRow({
					key: "key",
					title: "Groq API key",
					badge: keyStatusBadge(),
					description: keyDescription(),
					control: h(
						"a",
						{
							href: "#",
							className: "gqs-link",
							onClick: (event) => {
								event.preventDefault();
								if (typeof openModels !== "function" || !openModels()) {
									setNotice({
										text: "Open Settings → Models from the settings sidebar to manage the key.",
										kind: "error"
									});
								}
							}
						},
						"Settings → Models"
					)
				});
			}

			/** Model + language selects, one General-style row each. */
			function renderRecognition() {
				if (!form) return null;
				const modelOptions = MODEL_OPTIONS.map((option) => ({ value: option.value, label: option.label }));
				if (!modelOptions.some((option) => option.value === form.model)) {
					modelOptions.push({ value: form.model, label: form.model });
				}
				const languageOptions = LANGUAGES.map((code) => ({ value: code, label: languageLabel(code) }));
				if (!languageOptions.some((option) => option.value === form.language)) {
					languageOptions.push({ value: form.language, label: languageLabel(form.language) });
				}
				return h(
					React.Fragment,
					null,
					settingsRow({
						key: "model",
						title: "Whisper model",
						description: "Model used to transcribe speech. Turbo is the fastest default.",
						htmlFor: ID.model,
						control: selectControl({
							id: ID.model,
							value: form.model,
							onChange: (event) => patchForm({ model: event.target.value }),
							options: modelOptions
						})
					}),
					settingsRow({
						key: "language",
						title: "Language hint",
						description: "Auto-detect lets Whisper guess the language; pin one to improve accuracy on short recordings.",
						htmlFor: ID.language,
						control: selectControl({
							id: ID.language,
							value: form.language,
							onChange: (event) => patchForm({ language: event.target.value }),
							options: languageOptions
						})
					})
				);
			}

			/** Polish model picker (list-models) and prompt textarea. */
			function renderPolish() {
				if (!form) return null;
				const current = encodeModelValue(form.polish.provider, form.polish.model);
				const modelOptions = [{ value: "", label: "No polishing" }];
				for (const model of models) {
					modelOptions.push({
						value: encodeModelValue(model.provider, model.model),
						label: model.providerName + " — " + model.modelName
					});
				}
				if (current && !modelOptions.some((option) => option.value === current)) {
					modelOptions.push({
						value: current,
						label: form.polish.provider + " — " + form.polish.model
					});
				}
				const disabled = modelsLoading || (models.length === 0 && !current);
				return h(
					React.Fragment,
					null,
					settingsRow({
						key: "polish-model",
						title: "Polish model",
						description: "Choose any model exposed by DSH, including Groq. No polishing keeps the raw transcript; any failure also falls back to it.",
						htmlFor: ID.polishModel,
						control: selectControl({
							id: ID.polishModel,
							value: current,
							disabled,
							onChange: (event) => {
								const next = decodeModelValue(event.target.value);
								patchPolish({ provider: next.provider, model: next.model });
							},
							options: modelOptions
						})
					}),
					modelsError
						? h(
								"div",
								{ className: "gqs-row", key: "models-error" },
								h("div", { className: "gqs-text" }, h("div", { className: "gqs-desc" }, modelsError)),
								h(
									"div",
									{ className: "gqs-control" },
									h(
										"button",
										{
											type: "button",
											onClick: () => void loadModels(),
											disabled: modelsLoading,
											className: "gqs-button gqs-secondary gqs-compact"
										},
										modelsLoading ? "Loading…" : "Retry"
									)
								)
							)
						: null,
					models.length === 0 && !modelsError
						? h(
								"div",
								{ className: "gqs-row", key: "models-empty" },
								h(
									"div",
									{ className: "gqs-text" },
									h(
										"div",
										{ className: "gqs-desc" },
										"No polish models were found. Configure a provider in DSH Settings → Models, then retry."
									)
								)
							)
						: null,
					settingsRow({
						key: "polish-prompt",
						title: "Polish prompt (optional)",
						description: "Used only when a Polish model is selected. Leave empty to use the built-in default prompt.",
						prompt: true,
						htmlFor: ID.prompt,
						control: h("textarea", {
							id: ID.prompt,
							className: "gqs-textarea",
							value: form.polish.prompt,
							placeholder: DEFAULT_POLISH_PROMPT,
							rows: 4,
							maxLength: MAX_PROMPT_CHARS,
							spellCheck: true,
							onChange: (event) => patchPolish({ prompt: event.target.value })
						})
					})
				);
			}

			if (phase === "loading") {
				return h(
					"div",
					{ className: "gqs-section" },
					h("p", { className: "gqs-loading", role: "status" }, "Loading Groq Speech settings…")
				);
			}

			if (phase === "error") {
				return h(
					"div",
					{ className: "gqs-section" },
					h(
						"p",
						{ className: "gqs-notice gqs-notice-error", role: "alert" },
						loadError || "Could not load Groq Speech settings."
					),
					h(
						"div",
						{ className: "gqs-footer" },
						h(
							"button",
							{
								type: "button",
								onClick: () => void loadAll(),
								className: "gqs-button gqs-primary"
							},
							"Retry"
						)
					)
				);
			}

			return h(
				"div",
				{ className: "gqs-section" },
				renderKeyInfo(),
				renderRecognition(),
				renderPolish(),
				savingSettings || notice
					? h(
							"div",
							{ className: "gqs-footer" },
							h(
								"p",
								{
									className:
										"gqs-notice " +
										(savingSettings
											? ""
											: notice.kind === "error"
												? "gqs-notice-error"
												: "gqs-notice-success"),
									role: !savingSettings && notice.kind === "error" ? "alert" : "status",
									"aria-live": "polite"
								},
								savingSettings ? "Saving…" : notice.text
							)
						)
					: null
			);
		}
		//#endregion

		/**
		 * Register the Settings → Groq Speech section. The shell owns
		 * navigation; slot lifecycle is handled by ctx.slots.inject.
		 */
		function apply(ctx) {
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: SECTION_ID,
						order: SECTION_ORDER,
						label: SECTION_LABEL,
						inject: () => ({
							openModels: () => openModelsSection(ctx)
						})
					},
					GroqSpeechSection
				)
			);
		}

		return {
			apply,
			inject: ["slots"],
			GroqSpeechSection,
			openModelsSection,
			callApi
		};
	}
});
