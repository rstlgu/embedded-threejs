import { clamp, mapRangeClamped } from './math'
import type { Outputs, Sensors, SimConfig, SimModel } from './types'

function defaultOutputs(): Outputs {
  return { winPwm: 0, lampPwm: 0, humidPwm: 0 }
}

function approachPwm(current: number, target: number, dtMs: number, ratePerSec: number) {
  const maxDelta = (ratePerSec * dtMs) / 1000
  const next = current + clamp(target - current, -maxDelta, maxDelta)
  return clamp(Math.round(next), 0, 255)
}

function smoothOutputs(model: SimModel, nowMs: number, target: Partial<Outputs>) {
  const dtMs = clamp(nowMs - model.outputsUpdatedAtMs, 0, 250)
  model.outputsUpdatedAtMs = nowMs

  const targetWin = target.winPwm ?? model.outputs.winPwm
  const targetLamp = target.lampPwm ?? model.outputs.lampPwm
  const targetHumid = target.humidPwm ?? model.outputs.humidPwm

  // rate limit: evita 0↔max e rende i valori intermedi “stabili”
  model.outputs.winPwm = approachPwm(model.outputs.winPwm, targetWin, dtMs, 220)
  model.outputs.lampPwm = approachPwm(model.outputs.lampPwm, targetLamp, dtMs, 320)
  model.outputs.humidPwm = approachPwm(model.outputs.humidPwm, targetHumid, dtMs, 240)
}

export function createDefaultConfig(): SimConfig {
  return {
    dayThreshold: 400,
    lMin: 300,
    lMax: 700,
    hMin: 400,
    lNight: 120,
    hNight: 120,
    lNightAlt: 200,
    hNightAlt: 200,
    // tempi reali (come firmware in code.c)
    tCheckMs: 300_000, // 5 minuti
    tHumMs: 60_000, // 1 minuto
    timeScale: 1,
  }
}

export function createDefaultModel(nowMs: number): SimModel {
  return {
    mode: 'auto',
    state: 'INIT',
    stateEnteredAtMs: nowMs,
    outputsUpdatedAtMs: nowMs,
    sensors: {
      lInt: 500,
      lExt: 800,
      hum: 500,
      isBtnPressed: false,
    },
    outputs: defaultOutputs(),
  }
}

function dayLightControl(
  sensors: Sensors,
  config: SimConfig,
  prevLampPwm: number,
): Pick<Outputs, 'winPwm' | 'lampPwm'> {
  void prevLampPwm
  // WIN dipende solo da L_ext (richiesta)
  const ext = sensors.lExt
  const int = sensors.lInt

  // Oscuramento finestre: graduale vicino a L_max (niente “step”)
  const winDeadband = 60
  const winPwm =
    ext <= config.lMax - winDeadband
      ? 0
      : ext >= config.lMax
        ? mapRangeClamped(ext, config.lMax, 1023, 80, 255)
        : mapRangeClamped(ext, config.lMax - winDeadband, config.lMax, 0, 80)

  // Lampada: regolazione morbida attorno a L_min (per vedere PWM intermedi)
  const lampFadeOff = 110
  const lampMax = 220
  const lampMin = 45
  const lampPwm =
    int <= config.lMin
      ? mapRangeClamped(int, 0, config.lMin, lampMax, lampMin)
      : int < config.lMin + lampFadeOff
        ? mapRangeClamped(int, config.lMin, config.lMin + lampFadeOff, lampMin, 0)
        : 0

  return { winPwm: clamp(Math.round(winPwm), 0, 255), lampPwm: clamp(Math.round(lampPwm), 0, 255) }
}

function nightOutputs(sensors: Sensors, config: SimConfig): Pick<Outputs, 'lampPwm' | 'humidPwm' | 'winPwm'> {
  const isAlt = sensors.isBtnPressed
  return {
    winPwm: 0,
    lampPwm: isAlt ? config.lNightAlt : config.lNight,
    humidPwm: isAlt ? config.hNightAlt : config.hNight,
  }
}

function dayHumidTarget(sensors: Sensors, config: SimConfig) {
  const h = sensors.hum
  const fadeOff = 130
  const maxPwm = 230
  const minPwm = 55

  if (h <= config.hMin) return clamp(Math.round(mapRangeClamped(h, 0, config.hMin, maxPwm, minPwm)), 0, 255)
  if (h < config.hMin + fadeOff)
    return clamp(Math.round(mapRangeClamped(h, config.hMin, config.hMin + fadeOff, minPwm, 0)), 0, 255)
  return 0
}

export function stepFsm(model: SimModel, config: SimConfig, nowMs: number) {
  const elapsed = nowMs - model.stateEnteredAtMs

  switch (model.state) {
    case 'INIT': {
      model.outputs = defaultOutputs()
      model.outputsUpdatedAtMs = nowMs
      model.state = 'CHECK_DAY_NIGHT'
      model.stateEnteredAtMs = nowMs
      return
    }

    case 'CHECK_DAY_NIGHT': {
      model.state = model.sensors.lExt > config.dayThreshold ? 'DAY_LIGHT' : 'NIGHT_LIGHT'
      model.stateEnteredAtMs = nowMs
      return
    }

    case 'DAY_LIGHT': {
      const { winPwm, lampPwm } = dayLightControl(model.sensors, config, model.outputs.lampPwm)
      smoothOutputs(model, nowMs, { winPwm, lampPwm })
      model.state = 'DAY_HUM'
      model.stateEnteredAtMs = nowMs
      return
    }

    case 'DAY_HUM': {
      const humidPwm = dayHumidTarget(model.sensors, config)
      smoothOutputs(model, nowMs, { humidPwm })
      model.state = 'WAIT'
      model.stateEnteredAtMs = nowMs
      return
    }

    case 'HUM_ON': {
      // Legacy: manteniamo graduale e non “spariamo” a 255
      const humidPwm = dayHumidTarget(model.sensors, config)
      smoothOutputs(model, nowMs, { humidPwm })
      if (elapsed >= config.tHumMs / config.timeScale) {
        model.state = 'WAIT'
        model.stateEnteredAtMs = nowMs
      }
      return
    }

    case 'NIGHT_LIGHT': {
      const night = nightOutputs(model.sensors, config)
      smoothOutputs(model, nowMs, { winPwm: night.winPwm, lampPwm: night.lampPwm })
      model.state = 'NIGHT_HUM'
      model.stateEnteredAtMs = nowMs
      return
    }

    case 'NIGHT_HUM': {
      const night = nightOutputs(model.sensors, config)
      smoothOutputs(model, nowMs, { humidPwm: night.humidPwm })
      model.state = 'WAIT'
      model.stateEnteredAtMs = nowMs
      return
    }

    case 'WAIT': {
      if (elapsed >= config.tCheckMs / config.timeScale) {
        model.state = 'CHECK_DAY_NIGHT'
        model.stateEnteredAtMs = nowMs
      }
    }
  }
}


