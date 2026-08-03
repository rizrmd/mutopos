import { root } from '@lynx-js/react'

import './styles/tokens.css'
import './styles/base.css'
import './styles/shell.css'
import './styles/pos.css'
import './styles/passcode.css'
import { App } from './App.js'

root.render(<App />)

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept()
}
