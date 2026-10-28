/**
 * Offline test-suite entry point.
 *
 * `npm test` runs `node --test test/`. Node resolves that directory to this
 * file, which imports every suite below; the suites live in separate modules
 * but share this one test process. They never import DSH itself and never
 * contact Groq: providers are faked and HTTP goes to loopback servers only.
 */

import './settings.test.js'
import './groq.test.js'
import './api.test.js'
import './polish.test.js'
import './provider.test.js'
import './index.test.js'
import './client.test.js'
