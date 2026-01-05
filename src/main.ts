import './style.css'
import './extra-style.css' // Carichiamo i nuovi stili
import { createDefaultConfig, createDefaultModel, stepFsm } from './sim/fsm'
import { clamp } from './sim/math'
import { createThreeSim } from './sim/three-scene'
import type { Outputs, SimModel } from './sim/types'

// Setup UI
const appEl = document.querySelector<HTMLDivElement>('#app')
if (!appEl) throw new Error('Missing #app')

appEl.innerHTML = `
  <div id="loading" class="loading">
    <div class="loading-card">
      <div id="loadingTitle" class="loading-title">Loading room…</div>
      <div id="loadingSub" class="loading-sub">Caricamento modello 3D e scena</div>
      <div class="loading-meter" aria-hidden="true">
        <div id="loadingBar" class="loading-meter-bar" style="width:0%"></div>
      </div>
      <div id="loadingMeta" class="loading-meta">0%</div>
    </div>
  </div>
  <canvas id="c"></canvas>
  
  <!-- Gaming Stats Overlay (Always Visible) -->
  <div class="stats-overlay">
    <div class="stats-row header">System Status</div>
    <div class="stats-row">
      <span class="stats-label">TIME</span>
      <span id="statTime" class="stats-val">--:--</span>
    </div>
    <div class="stats-row">
      <span class="stats-label">STATE</span>
      <span id="statState" class="stats-val highlight">INIT</span>
    </div>
    <div class="stats-row">
      <span class="stats-label">MODE</span>
      <span id="statMode" class="stats-val">AUTO</span>
    </div>

    <div class="stats-row header" style="margin-top:12px">Sensors</div>
    <div class="stats-row">
      <span class="stats-label">L_EXT (Light)</span>
      <span id="statLExt" class="stats-val">0</span>
    </div>
    <div class="stats-row">
      <span class="stats-label">L_INT (Room)</span>
      <span id="statLInt" class="stats-val">0</span>
    </div>
    <div class="stats-row">
      <span class="stats-label">HUM (Humidity)</span>
      <span id="statHum" class="stats-val">0</span>
    </div>
    <div class="stats-row">
      <span class="stats-label">BTN (Action)</span>
      <span id="statBtn" class="stats-val">OFF</span>
    </div>

    <div class="stats-row header" style="margin-top:12px">Actuators</div>
    <div class="stats-row">
      <span class="stats-label">WINDOW PWM</span>
      <span id="statWin" class="stats-val">0</span>
    </div>
    <div class="stats-row">
      <span class="stats-label">LAMP PWM</span>
      <span id="statLamp" class="stats-val">0</span>
    </div>
    <div class="stats-row">
      <span class="stats-label">HUMID PWM</span>
      <span id="statHumid" class="stats-val">0</span>
    </div>
  </div>

  <div class="ui-layer">
    <aside class="panel compact">
      <p class="subtitle">Control Panel</p>

      <div class="control-group">
        <h3>Player</h3>
        <div class="toggle-row" style="margin-bottom:10px">
          <span class="toggle-label" style="font-weight:600">Timelapse</span>
          <label class="switch">
            <input id="tlEnabled" type="checkbox" checked>
            <span class="slider"></span>
          </label>
        </div>
        <div id="tlOptions" class="player-bar">
          <div class="player-row">
            <button id="tlPlay" class="btn btn-icon" disabled aria-label="Play/Pause">
              <span id="tlPlayIcon">▶</span>
            </button>
            <select id="tlSpeed" class="select" disabled>
              <option value="30">x30</option>
              <option value="60" selected>x60</option>
              <option value="120">x120</option>
              <option value="240">x240</option>
            </select>
            <div class="player-time">
              <span class="player-time-label">Time</span>
              <span id="tlTimeLabel" class="player-time-value">--:--</span>
            </div>
          </div>
          <input id="tlScrub" type="range" min="0" max="1439" value="480" disabled />
          <div class="toggle-row" style="margin-top:10px">
            <span class="toggle-label" style="font-size:13px">Auto L_int</span>
            <label class="switch" style="transform:scale(0.8)">
              <input id="tlAutoLint" type="checkbox" checked>
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div class="control-group">
        <div class="toggle-row">
          <span class="toggle-label" style="font-weight:600">Manual Override</span>
          <label class="switch">
            <input id="modeToggle" type="checkbox">
            <span class="slider"></span>
          </label>
        </div>
      </div>

      <!-- Manual Controls (Visible only in Manual Mode) -->
      <div id="manualControls" class="control-group hidden">
        <h3>Manual Actuators</h3>
        <div class="input-row">
          <div class="label-row"><label>Window Opacity</label></div>
          <input id="winPwm" type="range" min="0" max="255" value="0" />
        </div>
        <div class="input-row">
          <div class="label-row"><label>Lamp Brightness</label></div>
          <input id="lampPwm" type="range" min="0" max="255" value="0" />
        </div>
        <div class="input-row">
          <div class="label-row"><label>Humidifier Power</label></div>
          <input id="humidPwm" type="range" min="0" max="255" value="0" />
        </div>
      </div>

      <!-- Debug Environment (Collapsible) -->
      <div class="debug-section">
        <div class="debug-title" id="debugToggle">
          <span>▼ Environment Simulation</span>
        </div>
        <div id="debugControls">
          <div class="input-row">
            <div class="label-row"><label>Sunlight (L_ext)</label></div>
            <input id="lExt" type="range" min="0" max="1023" value="800" />
          </div>
          <div class="input-row">
            <div class="label-row"><label>Room Light (L_int)</label></div>
            <input id="lInt" type="range" min="0" max="1023" value="500" />
          </div>
          <div class="input-row">
            <div class="label-row"><label>Humidity Sensor</label></div>
            <input id="hum" type="range" min="0" max="1023" value="500" />
          </div>
          <div class="toggle-row">
            <span class="toggle-label" style="font-size:13px">User Button</span>
            <label class="switch" style="transform:scale(0.8)">
              <input id="btn" type="checkbox">
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </div>

    </aside>

    <div class="terminal">
      <div class="terminal-header">
        <span>SERIAL LOG</span>
        <button id="clearLog">[x]</button>
      </div>
      <div class="terminal-body" id="console"></div>
    </div>
  </div>

  <button id="infoBtn" class="info-fab" type="button" aria-label="Info">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="currentColor" d="M11 9h2V7h-2v2Zm1 13C6.935 22 3 18.065 3 13S6.935 4 12 4s9 3.935 9 9-3.935 9-9 9Zm0-2a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm-1-3h2v-7h-2v7Z"/>
    </svg>
  </button>

  <dialog id="aboutDialog" class="about-dialog">
    <form method="dialog" class="about-card">
      <div class="about-header">
        <div>
          <div class="about-title">Embedded System Simulation</div>
          <div class="about-sub">react/vite + threejs</div>
        </div>
        <button class="about-close" aria-label="Chiudi" value="close">✕</button>
      </div>

      <div class="about-body">
        <div class="about-line">
          Developed by
          <a class="about-link" href="https://github.com/rstlgu" target="_blank" rel="noreferrer">@rstlgu</a>
        </div>
        <div class="about-line" style="margin-top:10px">
          Repository:
          <a class="about-link" href="https://github.com/rstlgu/embedded-threejs.git" target="_blank" rel="noreferrer">
            embedded-threejs
          </a>
        </div>
      </div>
    </form>
  </dialog>
`

// Helpers
function getEl<T extends HTMLElement>(id: string) {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el as T
}

// UI Refs
const modeToggle = getEl<HTMLInputElement>('modeToggle')
const manualControls = getEl<HTMLDivElement>('manualControls')
const debugToggle = getEl<HTMLDivElement>('debugToggle')
const debugControls = getEl<HTMLDivElement>('debugControls')

// Environment Inputs
const lExtEl = getEl<HTMLInputElement>('lExt')
const lIntEl = getEl<HTMLInputElement>('lInt')
const humEl = getEl<HTMLInputElement>('hum')
const btnEl = getEl<HTMLInputElement>('btn')

// Actuators Inputs
const winPwmEl = getEl<HTMLInputElement>('winPwm')
const lampPwmEl = getEl<HTMLInputElement>('lampPwm')
const humidPwmEl = getEl<HTMLInputElement>('humidPwm')

// Stats Refs
const statTime = getEl<HTMLSpanElement>('statTime')
const statState = getEl<HTMLSpanElement>('statState')
const statMode = getEl<HTMLSpanElement>('statMode')
const statLExt = getEl<HTMLSpanElement>('statLExt')
const statLInt = getEl<HTMLSpanElement>('statLInt')
const statHum = getEl<HTMLSpanElement>('statHum')
const statBtn = getEl<HTMLSpanElement>('statBtn')
const statWin = getEl<HTMLSpanElement>('statWin')
const statLamp = getEl<HTMLSpanElement>('statLamp')
const statHumid = getEl<HTMLSpanElement>('statHumid')

const consoleEl = getEl<HTMLDivElement>('console')
const clearLogBtn = getEl<HTMLButtonElement>('clearLog')

// Timelapse Refs
const tlEnabledEl = getEl<HTMLInputElement>('tlEnabled')
const tlOptionsEl = getEl<HTMLDivElement>('tlOptions')
const tlPlayEl = getEl<HTMLButtonElement>('tlPlay')
const tlPlayIconEl = getEl<HTMLSpanElement>('tlPlayIcon')
const tlSpeedEl = getEl<HTMLSelectElement>('tlSpeed')
const tlScrubEl = getEl<HTMLInputElement>('tlScrub')
const tlTimeLabel = getEl<HTMLSpanElement>('tlTimeLabel')
const tlAutoLintEl = getEl<HTMLInputElement>('tlAutoLint')

// Logic
const canvas = getEl<HTMLCanvasElement>('c')
const loadingEl = getEl<HTMLDivElement>('loading')
const loadingTitleEl = getEl<HTMLDivElement>('loadingTitle')
const loadingSubEl = getEl<HTMLDivElement>('loadingSub')
const loadingBarEl = getEl<HTMLDivElement>('loadingBar')
const loadingMetaEl = getEl<HTMLDivElement>('loadingMeta')
const infoBtn = getEl<HTMLButtonElement>('infoBtn')
const aboutDialog = getEl<HTMLDialogElement>('aboutDialog')
const three = createThreeSim(canvas, {
  onModelProgress(progress) {
    const { loaded, total } = progress
    const ratio = typeof total === 'number' && total > 0 ? loaded / total : null
    const pct = ratio === null ? null : Math.max(0, Math.min(100, Math.round(ratio * 100)))

    if (pct !== null) {
      loadingBarEl.style.width = `${pct}%`
      loadingMetaEl.textContent = `${pct}%`
      loadingSubEl.textContent = 'Download modello 3D…'
      return
    }

    // Fallback quando `total` non è disponibile
    const mb = Math.max(0, loaded) / (1024 * 1024)
    loadingMetaEl.textContent = `${mb.toFixed(1)} MB`
    loadingSubEl.textContent = 'Download modello 3D…'
  }
})
const config = createDefaultConfig()
let model = createDefaultModel(performance.now())

// Logging
const MAX_LOGS = 50
let lastLogState = ''
function log(msg: string, type: 'info' | 'state' | 'action' = 'info') {
  const line = document.createElement('div')
  const time = new Date().toLocaleTimeString('it-IT', { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })
  let className = 'log-info'
  if (type === 'state') className = 'log-state'
  if (type === 'action') className = 'log-action'
  line.innerHTML = `<span class="log-time">[${time}]</span><span class="${className}">${msg}</span>`
  consoleEl.appendChild(line)
  if (consoleEl.children.length > MAX_LOGS) consoleEl.removeChild(consoleEl.firstChild!)
  consoleEl.scrollTop = consoleEl.scrollHeight
}
clearLogBtn.onclick = () => { consoleEl.innerHTML = '' }

infoBtn.addEventListener('click', () => {
  if (typeof aboutDialog.showModal === 'function') aboutDialog.showModal()
})

aboutDialog.addEventListener('click', (e) => {
  // click su backdrop chiude
  if (e.target === aboutDialog) aboutDialog.close()
})

// Toggle Handlers
modeToggle.addEventListener('change', () => {
  const isManual = modeToggle.checked
  model.mode = isManual ? 'manual' : 'auto'
  
  if (isManual) {
    manualControls.classList.remove('hidden')
    // Sync sliders to current values when switching to manual
    winPwmEl.value = String(model.outputs.winPwm)
    lampPwmEl.value = String(model.outputs.lampPwm)
    humidPwmEl.value = String(model.outputs.humidPwm)
  } else {
    manualControls.classList.add('hidden')
  }
  log(`Mode switched to: ${model.mode.toUpperCase()}`)
})

// Debug Toggle
let isDebugOpen = true
debugToggle.onclick = () => {
  isDebugOpen = !isDebugOpen
  debugControls.classList.toggle('hidden', !isDebugOpen)
  debugToggle.querySelector('span')!.textContent = isDebugOpen ? '▼ Environment Simulation' : '▶ Environment Simulation'
}

// Timelapse state
const DAY_MINUTES = 24 * 60
let isTimelapseEnabled = false
let isTimelapsePlaying = false
let simMinutes = 8 * 60 // 08:00 default
let lastNowMs = performance.now()
let simNowMs = performance.now()
let simHum = model.sensors.hum
let simLint = model.sensors.lInt

function formatClock(minutes: number) {
  const m = Math.floor(((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES)
  const hh = String(Math.floor(m / 60)).padStart(2, '0')
  const mm = String(m % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

function computeLextFromTime(minutes: number) {
  // sunrise ~06:00, sunset ~18:00 (sinusoid)
  const t = minutes / DAY_MINUTES // 0..1
  const phase = (t - 0.25) * Math.PI * 2 // shift so peak at noon
  const sun = Math.max(0, Math.sin(phase))
  const shaped = Math.pow(sun, 1.35)
  return clamp(Math.round(shaped * 1023), 0, 1023)
}

function computeHumFromTime(minutes: number) {
  // più secco a metà giornata per far scattare HUM_ON a tratti
  const t = minutes / DAY_MINUTES
  const phase = (t - 0.25) * Math.PI * 2
  const sun = Math.max(0, Math.sin(phase))
  const base = 520
  const dip = 260 * Math.pow(sun, 1.1) // diminuisce quando il sole è alto
  return clamp(Math.round(base - dip), 0, 1023)
}

function computeLintFromEnv(lext: number) {
  // Stima semplificata (anti-loop): L_int dipende dal sole + lampada, NON da WIN
  // (WIN ormai dipende solo da L_ext, e togliamo il feedback su L_int)
  const lampFactor = clamp(model.outputs.lampPwm / 255, 0, 1)
  const sunlightInside = lext * 0.42
  const lampInside = lampFactor * 820
  const base = 40
  return clamp(Math.round(base + sunlightInside + lampInside), 0, 1023)
}

function setTimelapseEnabled(next: boolean) {
  isTimelapseEnabled = next
  tlOptionsEl.classList.toggle('hidden', !next)
  tlPlayEl.disabled = !next
  tlSpeedEl.disabled = !next
  tlScrubEl.disabled = !next
  tlAutoLintEl.disabled = !next

  // quando il timelapse è attivo, i sensori vengono guidati dal player (disabilitiamo gli slider)
  for (const el of [lExtEl, lIntEl, humEl, btnEl]) el.disabled = next
  if (!next) isTimelapsePlaying = false
  tlPlayEl.textContent = isTimelapsePlaying ? 'Pause' : 'Play'

  // Nota UX: non chiudiamo automaticamente "Environment Simulation":
  // deve restare aperto per osservare i valori mentre cambiano.

  // rebase clock simulato così la FSM non resta “indietro”
  simNowMs = performance.now()
  model.stateEnteredAtMs = simNowMs
  simHum = model.sensors.hum
  simLint = model.sensors.lInt
}

tlEnabledEl.addEventListener('change', () => {
  setTimelapseEnabled(tlEnabledEl.checked)
  log(`Timelapse ${tlEnabledEl.checked ? 'ENABLED' : 'DISABLED'}`)
})

function syncPlayUi() {
  tlPlayEl.textContent = ''
  tlPlayEl.appendChild(tlPlayIconEl)
  tlPlayIconEl.textContent = isTimelapsePlaying ? '❚❚' : '▶'
}

tlPlayEl.addEventListener('click', () => {
  isTimelapsePlaying = !isTimelapsePlaying
  syncPlayUi()
  log(`Timelapse ${isTimelapsePlaying ? 'PLAY' : 'PAUSE'}`)
})

tlSpeedEl.addEventListener('change', () => {
  log(`Timelapse speed: x${tlSpeedEl.value}`)
})

tlScrubEl.addEventListener('input', () => {
  simMinutes = clamp(Number(tlScrubEl.value), 0, DAY_MINUTES - 1)
  tlTimeLabel.textContent = formatClock(simMinutes)
})

function readSensorsFromUI() {
  if (!isTimelapseEnabled) {
    model.sensors.lExt = clamp(Number(lExtEl.value), 0, 1023)
    model.sensors.lInt = clamp(Number(lIntEl.value), 0, 1023)
    model.sensors.hum = clamp(Number(humEl.value), 0, 1023)
    model.sensors.isBtnPressed = btnEl.checked
    return
  }

  // Timelapse-driven sensors
  const lext = computeLextFromTime(simMinutes)
  const hum = simHum
  const lint = tlAutoLintEl.checked ? simLint : model.sensors.lInt

  model.sensors.lExt = lext
  model.sensors.hum = hum
  model.sensors.lInt = lint
  model.sensors.isBtnPressed = false

  // aggiornamento UI (read-only)
  lExtEl.value = String(lext)
  humEl.value = String(hum)
  lIntEl.value = String(lint)
}

function updateStats() {
  const clock = formatClock(simMinutes)
  statTime.textContent = clock
  tlTimeLabel.textContent = clock

  statState.textContent = model.state
  statMode.textContent = model.mode.toUpperCase()
  statMode.className = `stats-val ${model.mode === 'manual' ? 'warn' : ''}`
  
  statLExt.textContent = String(model.sensors.lExt)
  statLInt.textContent = String(model.sensors.lInt)
  statHum.textContent = String(model.sensors.hum)
  statBtn.textContent = model.sensors.isBtnPressed ? 'PRESSED' : 'RELEASED'
  
  statWin.textContent = String(model.outputs.winPwm)
  statLamp.textContent = String(model.outputs.lampPwm)
  statHumid.textContent = String(model.outputs.humidPwm)
}

function runFsmWithLogs(m: SimModel, now: number) {
  const prevState = m.state
  const prevOutputs = { ...m.outputs }
  stepFsm(m, config, now)

  if (m.state !== prevState) {
    log(`[STATE] ${prevState} -> ${m.state}`, 'state')
  }
  
  // Serial prints simulation
  if (m.state !== lastLogState) {
     if (m.state === 'CHECK_DAY_NIGHT') log(`L_ext = ${m.sensors.lExt}`)
     if (m.state === 'DAY_HUM') log(`Humidity = ${m.sensors.hum}`)
     if (m.state === 'HUM_ON' && prevState !== 'HUM_ON') log(`-> HUMIDITY LOW: HUM_ON`, 'action')
     if (prevState === 'CHECK_DAY_NIGHT' && (m.state === 'DAY_LIGHT' || m.state === 'NIGHT_LIGHT')) {
       log(m.state === 'DAY_LIGHT' ? '-> DAY MODE' : '-> NIGHT MODE', 'action')
     }
     lastLogState = m.state
  }

  const hasOutChanged =
    prevOutputs.winPwm !== m.outputs.winPwm ||
    prevOutputs.lampPwm !== m.outputs.lampPwm ||
    prevOutputs.humidPwm !== m.outputs.humidPwm
  if (hasOutChanged) {
    log(`OUT  WIN=${m.outputs.winPwm}  LAMP=${m.outputs.lampPwm}  HUMID=${m.outputs.humidPwm}`, 'action')
  }
}

function manualOutputsFromUI(): Outputs {
  return {
    winPwm: clamp(Number(winPwmEl.value), 0, 255),
    lampPwm: clamp(Number(lampPwmEl.value), 0, 255),
    humidPwm: clamp(Number(humidPwmEl.value), 0, 255),
  }
}

function tick(nowMs: number) {
  const dtMs = nowMs - lastNowMs
  lastNowMs = nowMs

  if (isTimelapseEnabled && isTimelapsePlaying) {
    const speed = clamp(Number(tlSpeedEl.value), 1, 2000)
    // speed è un moltiplicatore (x30/x60/...), non "minuti al secondo"
    // 1 minuto simulato = 60_000ms simulati
    simMinutes = (simMinutes + (dtMs / 60_000) * speed) % DAY_MINUTES
    tlScrubEl.value = String(Math.floor(simMinutes))

    // clock simulato per FSM: minuti simulati -> ms simulati (1 min = 60_000 ms)
    simNowMs += dtMs * speed
  } else {
    simNowMs = nowMs
  }

  // Feedback fisico del sensore HUM: l'umidificatore deve far salire l'umidità misurata
  if (isTimelapseEnabled) {
    const speed = clamp(Number(tlSpeedEl.value), 1, 2000)
    const dtSimMs = dtMs * (isTimelapsePlaying ? speed : 1)
    const baseline = computeHumFromTime(simMinutes)

    // ritorno verso baseline (inerzia lenta)
    const tauMs = 8 * 60_000 // 8 minuti
    const k = clamp(dtSimMs / tauMs, 0, 1)
    simHum = simHum + (baseline - simHum) * k

    // contributo umidificatore: a 255, +~130 unità/min (scelto per essere visibile ma non istantaneo)
    const humidFactor = clamp(model.outputs.humidPwm / 255, 0, 1)
    const risePerSec = 2.2 // unità sensore al secondo @255
    simHum = simHum + humidFactor * risePerSec * (dtSimMs / 1000)

    simHum = clamp(Math.round(simHum), 0, 1023)
  }

  // Sensore L_int con inerzia (anti jitter): segue un target determinato da L_ext + LAMP,
  // ma con smoothing, così la lampada non “insegue” a scatti.
  if (isTimelapseEnabled && tlAutoLintEl.checked) {
    const speed = clamp(Number(tlSpeedEl.value), 1, 2000)
    const dtSimMs = dtMs * (isTimelapsePlaying ? speed : 1)
    const targetLint = computeLintFromEnv(computeLextFromTime(simMinutes))
    const tauMs = 25_000 // ~25s di inerzia
    const k = clamp(dtSimMs / tauMs, 0, 1)
    simLint = simLint + (targetLint - simLint) * k
    simLint = clamp(Math.round(simLint), 0, 1023)
  }

  readSensorsFromUI()

  if (model.mode === 'auto') {
    runFsmWithLogs(model, isTimelapseEnabled ? simNowMs : nowMs)
  } else {
    model.outputs = manualOutputsFromUI()
  }

  three.setSensors(model.sensors)
  three.setOutputs(model.outputs)
  updateStats()
  three.render(nowMs)
  
  requestAnimationFrame(tick)
}

log('=== SYSTEM START ===')

// Player attivo di default (richiesta)
setTimelapseEnabled(tlEnabledEl.checked)
syncPlayUi()

// Gate: aspetta il modello GLB prima di mostrare UI/canvas
let isLoadingHidden = false
function hideLoading() {
  if (isLoadingHidden) return
  isLoadingHidden = true
  loadingTitleEl.textContent = 'Loaded'
  loadingSubEl.textContent = 'Inizializzazione scena…'
  loadingEl.classList.add('hidden')
}

three.ready.then(hideLoading)
// fallback: non rimanere bloccati sul loading (anche se il GLB non risponde)
setTimeout(hideLoading, 3000)

requestAnimationFrame(tick)
