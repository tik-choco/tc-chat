import { render } from 'preact'
import './index.css'
import { App } from './app.tsx'
import { LocaleProvider } from './lib/i18n'
import { writeAppManifest } from './lib/appManifest'
import { BUS_VERSION } from './lib/sharedBus'

render(
  <LocaleProvider>
    <App />
  </LocaleProvider>,
  document.getElementById('app')!,
)

writeAppManifest({
  app: 'tc-chat',
  busVersion: BUS_VERSION,
  publishes: [],
  consumes: ['note-article'],
  reads: ['tc-storage-snapshot-v1'],
})
