export interface Sensors {
  // 0..1023 come analogRead()
  lInt: number
  lExt: number
  hum: number
  // pulsante con pullup: in Arduino LOW = premuto
  isBtnPressed: boolean
}

export interface Outputs {
  // 0..255 come analogWrite PWM
  winPwm: number
  lampPwm: number
  humidPwm: number
}

export interface SimConfig {
  dayThreshold: number
  lMin: number
  lMax: number
  hMin: number
  lNight: number
  hNight: number
  lNightAlt: number
  hNightAlt: number
  // tempi (ms) “reali” per la web-sim (puoi accelerare con timeScale)
  tCheckMs: number
  tHumMs: number
  timeScale: number
}

export interface SimModel {
  sensors: Sensors
  outputs: Outputs
  mode: 'auto' | 'manual'
  state:
    | 'INIT'
    | 'CHECK_DAY_NIGHT'
    | 'DAY_LIGHT'
    | 'DAY_HUM'
    | 'HUM_ON'
    | 'NIGHT_LIGHT'
    | 'NIGHT_HUM'
    | 'WAIT'
  stateEnteredAtMs: number
  outputsUpdatedAtMs: number
}


