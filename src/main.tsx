import { render } from 'preact'
import './index.css'
import { App } from './app.tsx'
import { LocaleProvider } from './lib/i18n'
import { writeAppManifest } from './lib/appManifest'
import { BUS_VERSION } from './lib/sharedBus'
import { registerServiceWorker } from './lib/swRegister'

render(
  <LocaleProvider>
    <App />
  </LocaleProvider>,
  document.getElementById('app')!,
)

// Caches the app shell + assets so an installed copy opens offline. Every peer
// keeps its own history locally (localStorage + mistlib's OPFS store), so an
// offline launch is genuinely useful, not just a nicer error page.
registerServiceWorker()

writeAppManifest({
  app: 'tc-chat',
  busVersion: BUS_VERSION,
  publishes: [],
  consumes: ['note-article'],
  reads: ['tc-storage-snapshot-v1'],
})
