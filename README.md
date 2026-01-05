# embedded-threejs

Simulazione **web 3D** (Vite + TypeScript + Three.js) del progetto “Sistemi Embedded”: controllo di illuminazione, vetri oscuranti e umidità tramite **FSM** con temporizzazioni non bloccanti.

## Progetto originale (C / Arduino)

Il progetto originale (firmware + documentazione) è qui:
- [`rstlgu/progetto-sistemi-embedded`](https://github.com/rstlgu/progetto-sistemi-embedded.git)

## Requisiti

- **Node.js**: 20.19+ oppure 22.12+ (consigliato **22**)
- **npm**

## Avvio (dev)

```bash
npm ci
npm run dev -- --host
```

Apri l’URL mostrato da Vite (tipicamente `http://localhost:5173/`).

## Contenuti principali

- **Stanza 3D**: modello GLB in `public/room.glb`
- **Controlli**:
  - **Timelapse** giorno/notte (play/pausa, velocità, slider orario)
  - **Manual Override** per pilotare PWM (WIN/LAMP/HUMID)
- **Log**: monitor seriale simulato + overlay “gaming stats”
- **Etichette 3D**: valori live su LAMP/WINDOW/HUMID

## Note

- La simulazione usa tempi “reali” per la FSM: **T_CHECK = 5 min**, **T_HUM = 1 min**.
- Se usi Homebrew (macOS): `brew install node@22` e aggiungi `/opt/homebrew/opt/node@22/bin` al `PATH` (vedi `package.json` per `engines.node`).


