import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { clamp } from './math'
import type { Outputs, Sensors } from './types'

export interface ThreeSim {
  canvas: HTMLCanvasElement
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  ready: Promise<void>
  dispose: () => void
  render: (time: number) => void
  setSensors: (sensors: Sensors) => void
  setOutputs: (outputs: Outputs) => void
  setDebugText: (text: string) => void
}

interface RoomParts {
  ambient: THREE.HemisphereLight
  sun: THREE.DirectionalLight
  sunMesh: THREE.Mesh
  windowLight: THREE.RectAreaLight
  centerLight: THREE.PointLight
  lampInnerLight: THREE.PointLight
  lampDiffuserMat: THREE.MeshStandardMaterial
  lampRingMat: THREE.MeshStandardMaterial
  windowMat: THREE.MeshPhysicalMaterial
  humidifierParticles: THREE.Points
  tagEls: {
    lamp: HTMLDivElement
    window: HTMLDivElement
    humidifier: HTMLDivElement
  }
}

function createTagEl(title: string) {
  const el = document.createElement('div')
  el.className = 'tag3d'
  el.innerHTML = `<div class="tag3d-title">${title}</div><div class="tag3d-value">--</div>`
  return el
}

function setTagValue(el: HTMLDivElement, value: string) {
  const valueEl = el.querySelector<HTMLDivElement>('.tag3d-value')
  if (valueEl) valueEl.textContent = value
}

function configureRenderer(renderer: THREE.WebGLRenderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
}

function createEnvironment(renderer: THREE.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  return env
}

function createMistTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0, 'rgba(255,255,255,0.8)')
  grad.addColorStop(1, 'rgba(255,255,255,0.0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 32, 32)
  return new THREE.CanvasTexture(canvas)
}

function createRoom(scene: THREE.Scene, onReady: () => void): RoomParts {
  RectAreaLightUniformsLib.init()

  // --- MATERIALE SMART BLINDS ---
  const blindsMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.2,
    metalness: 0.1,
    transmission: 1.0,
    transparent: true,
    opacity: 0.1,
    thickness: 0.01,
    ior: 1.5,
    side: THREE.DoubleSide,
    depthWrite: false
  })

  // --- CARICAMENTO MODELLO GLB ---
  const loader = new GLTFLoader()
  // Fallback Glass (inizialmente visibile, nascosto se troviamo il materiale nel GLB)
  const fallbackGlass = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 2.8), blindsMat)
  fallbackGlass.position.set(1.9, 1.5, -2.85) // A filo interno veneziane
  fallbackGlass.visible = true
  scene.add(fallbackGlass)

  loader.load(
    '/room.glb',
    (gltf) => {
    const model = gltf.scene
    let blindsFound = false

    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
        const name = child.name.toLowerCase()
        
        // Tentativo di trovare le veneziane/finestre nel modello
        if (name.includes('blind') || name.includes('window') || name.includes('glass') || name.includes('plane')) {
           child.material = blindsMat
           blindsFound = true
           // console.log('Applied Smart Material to:', child.name)
        } else {
           if (child.material instanceof THREE.MeshStandardMaterial) {
              child.material.envMapIntensity = 0.8
           }
        }
      }
    })

    // Se abbiamo applicato il materiale al modello, nascondiamo il fallback
    if (blindsFound) {
      fallbackGlass.visible = false
    }

    model.scale.set(1, 1, 1) 
    model.position.set(0, 0, 0)
    scene.add(model)
      onReady()
    },
    undefined,
    (error) => {
      console.error('GLB Error:', error)
      onReady()
    },
  )

  // --- LUCI & AMBIENTE ---
  const ambient = new THREE.HemisphereLight(0xbfd8ff, 0x0b1020, 0.6)
  scene.add(ambient)

  const sun = new THREE.DirectionalLight(0xffffff, 2.5)
  sun.position.set(9, 12, 6)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.00012
  scene.add(sun)

  const windowLight = new THREE.RectAreaLight(0xffffff, 18, 7.0, 3.5)
  windowLight.position.set(1.5, 2.0, -1.0) 
  windowLight.lookAt(1.5, 1.5, 2.0)
  scene.add(windowLight)

  // Esterno: niente prato (richiesto). Manteniamo solo cielo + sole mesh per feedback visivo.

  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(2, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xffddaa })
  )
  sunMesh.position.set(0, 10, -20)
  scene.add(sunMesh)

  // --- LUCE CENTRALE (Lampadario) ---
  // Sostituisce le wall lights
  const centerLight = new THREE.PointLight(0xfff1d6, 0, 18, 2) // caldo, decay più fisico
  centerLight.position.set(0, 3.35, 0) // sopra il tavolo
  centerLight.castShadow = true
  centerLight.shadow.bias = -0.0001
  centerLight.shadow.mapSize.width = 1024
  centerLight.shadow.mapSize.height = 1024
  scene.add(centerLight)

  // Mesh visibile del lampadario: solo un anello a soffitto (bordo)
  const lampGroup = new THREE.Group()
  // L'anello deve stare “attaccato” al soffitto: lo teniamo poco sopra la luce, non sopra il soffitto.
  lampGroup.position.set(centerLight.position.x, centerLight.position.y - 0.40, centerLight.position.z)
  scene.add(lampGroup)

  const ringOuterMat = new THREE.MeshStandardMaterial({ color: 0x141823, roughness: 0.85, metalness: 0.1 })
  const ringOuter = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.03, 12, 48), ringOuterMat)
  ringOuter.rotation.x = Math.PI / 2
  ringOuter.castShadow = true
  lampGroup.add(ringOuter)

  const lampRingMat = new THREE.MeshStandardMaterial({
    color: 0xfff1d6,
    emissive: 0xffb86b,
    emissiveIntensity: 0,
  })
  const ringInner = new THREE.Mesh(new THREE.RingGeometry(0.33, 0.40, 48), lampRingMat)
  ringInner.rotation.x = -Math.PI / 2
  lampGroup.add(ringInner)

  // Diffusore (“coperchio”) illuminato sotto l’anello
  const lampDiffuserMat = new THREE.MeshStandardMaterial({
    color: 0xfaf6ee,
    emissive: 0xffd19a,
    emissiveIntensity: 0,
    roughness: 0.65,
    metalness: 0,
    side: THREE.DoubleSide,
  })
  const diffuser = new THREE.Mesh(new THREE.CircleGeometry(0.315, 48), lampDiffuserMat)
  diffuser.rotation.x = -Math.PI / 2
  diffuser.position.y = -0.02
  lampGroup.add(diffuser)

  // Fonte luminosa interna (piccola, dentro il lampadario)
  const lampInnerLight = new THREE.PointLight(0xfff1d6, 0, 6.5, 2)
  lampInnerLight.position.copy(lampGroup.position)
  lampInnerLight.position.y -= 0.08
  lampInnerLight.castShadow = false
  scene.add(lampInnerLight)

  // --- TAG 3D (etichette) ---
  const lampTagEl = createTagEl('LAMP')
  const lampTag = new CSS2DObject(lampTagEl)
  // più a destra (offset locale sul lampadario)
  lampTag.position.set(0.65, -0.18, 0.0)
  lampGroup.add(lampTag)

  // Rimuovo Fill Light extra per garantire buio vero
  // const fillLight = ...

  // --- UMIDIFICATORE ---
  const humidifier = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.3, 0.5, 24),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 })
  )
  body.position.y = 0.25
  body.castShadow = true
  humidifier.add(body)
  // Spostato lontano dal tavolo (che è al centro o verso Z pos)
  // Lo mettiamo a sinistra del tavolo (nella tua inquadratura standard)
  humidifier.position.set(-1.9, 0, 0.9)
  scene.add(humidifier)

  const humidTagEl = createTagEl('HUMID')
  const humidTag = new CSS2DObject(humidTagEl)
  humidTag.position.set(0, 0.75, 0)
  humidifier.add(humidTag)

  const particleCount = 200
  const particlesGeo = new THREE.BufferGeometry()
  const positionsParticles = new Float32Array(particleCount * 3)
  const speeds = new Float32Array(particleCount)
  for(let i=0; i<particleCount; i++) {
    positionsParticles[i*3] = (Math.random() - 0.5) * 0.2
    positionsParticles[i*3+1] = Math.random() * 1.5
    positionsParticles[i*3+2] = (Math.random() - 0.5) * 0.2
    speeds[i] = 0.01 + Math.random() * 0.02
  }
  particlesGeo.setAttribute('position', new THREE.BufferAttribute(positionsParticles, 3))
  const particlesMat = new THREE.PointsMaterial({
    color: 0xaaaaaa, size: 0.4, map: createMistTexture(),
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
  })
  const humidifierParticles = new THREE.Points(particlesGeo, particlesMat)
  humidifierParticles.userData = { speeds, initialY: 0.5 }
  humidifierParticles.position.copy(humidifier.position)
  humidifierParticles.position.y += 0.5
  scene.add(humidifierParticles)

  // Il tag della finestra lo ancoriamo alla posizione “nota” del fallbackGlass (anche quando è nascosto)
  const windowTagEl = createTagEl('WINDOW')
  const windowAnchor = new THREE.Object3D()
  windowAnchor.position.copy(fallbackGlass.position)
  // più a sinistra e più in basso rispetto al centro finestra
  windowAnchor.position.x -= 1.15
  windowAnchor.position.y += 0.75
  scene.add(windowAnchor)
  const windowTag = new CSS2DObject(windowTagEl)
  windowAnchor.add(windowTag)

  return {
    ambient,
    sun,
    sunMesh,
    windowLight,
    centerLight,
    lampInnerLight,
    lampDiffuserMat,
    lampRingMat,
    windowMat: blindsMat,
    humidifierParticles,
    tagEls: { lamp: lampTagEl, window: windowTagEl, humidifier: humidTagEl },
  }
}

export function createThreeSim(canvas: HTMLCanvasElement): ThreeSim {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  configureRenderer(renderer)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#87CEEB')
  scene.fog = new THREE.FogExp2('#87CEEB', 0.002)
  scene.environment = createEnvironment(renderer)

  // Inquadratura “standard” (bloccata) — impostata da coordinate fornite
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200)
  camera.position.set(-5.69, 2.092, 3.106)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.target.set(0.008, 0.785, 0.03)
  // Camera LIBERA di default (come freeCam), con limiti soft solo per evitare flip/sottopavimento
  controls.enablePan = true
  controls.panSpeed = 0.6
  controls.minDistance = 2.5
  controls.maxDistance = 22
  controls.enableZoom = true
  controls.zoomSpeed = 0.9
  controls.enableRotate = true
  controls.rotateSpeed = 0.75
  controls.minPolarAngle = 0.25
  controls.maxPolarAngle = Math.PI * 0.49
  controls.minAzimuthAngle = -Math.PI
  controls.maxAzimuthAngle = Math.PI
  controls.update()

  // DEV: “libera” la camera e stampa coordinate quando premi 'p'
  // - 'f' toggla free/fixed
  if (import.meta.env.DEV) {
    // Ora la freecam è il default; 'f' toggla verso una modalità "locked"
    let isFreeCamEnabled = true

    function applyControlsPreset() {
      if (isFreeCamEnabled) {
        controls.enablePan = true
        controls.panSpeed = 0.6
        controls.minDistance = 2.5
        controls.maxDistance = 22
        controls.minPolarAngle = 0.25
        controls.maxPolarAngle = Math.PI * 0.49
        // OrbitControls digerisce male Infinity in alcuni casi: usiamo range molto ampio ma finito
        controls.minAzimuthAngle = -Math.PI
        controls.maxAzimuthAngle = Math.PI
        controls.rotateSpeed = 0.75
        controls.zoomSpeed = 0.9
        controls.update()
        return
      }

      // locked (modalità “presentazione”)
      controls.enablePan = false
      controls.minDistance = 5.8
      controls.maxDistance = 7.4
      controls.enableZoom = true
      controls.zoomSpeed = 0.55
      controls.enableRotate = true
      controls.rotateSpeed = 0.35
      controls.minPolarAngle = 0.95
      controls.maxPolarAngle = 1.68
      controls.minAzimuthAngle = -1.10
      controls.maxAzimuthAngle = -1.10
      controls.update()
    }

    applyControlsPreset()

    function printCam() {
      const p = camera.position
      const t = controls.target
      // eslint-disable-next-line no-console
      console.log(
        `[camera] position=(${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}) target=(${t.x.toFixed(3)}, ${t.y.toFixed(3)}, ${t.z.toFixed(3)})`,
      )
    }

    function toggleFreeCam(next?: boolean) {
      isFreeCamEnabled = typeof next === 'boolean' ? next : !isFreeCamEnabled
      applyControlsPreset()
      // eslint-disable-next-line no-console
      console.log(`[camera] freeCam=${isFreeCamEnabled ? 'ON' : 'OFF'} (premi 'p' per stampare pos/target)`)
    }

    // API globale: funziona anche se il focus è su slider/UI
    ;(window as any).__cam = { toggleFreeCam, printCam }
    // eslint-disable-next-line no-console
    console.log(`[camera] hotkeys: 'f' toggle freecam, 'p' print. Oppure console: __cam.toggleFreeCam(true) / __cam.printCam()`)

    window.addEventListener('keydown', (e) => {
      if (e.key === 'p') printCam()
      if (e.key === 'f') toggleFreeCam()
    })

    // Doppio click sul canvas per toggle freecam (utile se i tasti non arrivano)
    canvas.addEventListener('dblclick', () => toggleFreeCam())
  }

  let resolveReady: (() => void) | null = null
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })
  const room = createRoom(scene, () => resolveReady?.())

  const composer = new EffectComposer(renderer)
  const renderPass = new RenderPass(scene, camera)
  composer.addPass(renderPass)

  const ssaoPass = new SSAOPass(scene, camera, 1, 1)
  ssaoPass.kernelRadius = 8; ssaoPass.minDistance = 0.001; ssaoPass.maxDistance = 0.1
  composer.addPass(ssaoPass)

  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.15, 0.5, 0.9)
  composer.addPass(bloomPass)

  // Labels renderer (DOM)
  const labelRenderer = new CSS2DRenderer()
  labelRenderer.domElement.style.position = 'absolute'
  labelRenderer.domElement.style.left = '0'
  labelRenderer.domElement.style.top = '0'
  labelRenderer.domElement.style.pointerEvents = 'none'
  // Deve stare dietro alla UI (control center / HUD)
  labelRenderer.domElement.style.zIndex = '2'
  canvas.parentElement?.appendChild(labelRenderer.domElement)

  function resize() {
    const parent = canvas.parentElement
    if (!parent) return
    const { width, height } = parent.getBoundingClientRect()
    const w = Math.max(1, Math.floor(width)); const h = Math.max(1, Math.floor(height))
    camera.aspect = w / h; camera.updateProjectionMatrix()
    renderer.setSize(w, h, false); composer.setSize(w, h)
    ssaoPass.setSize(w, h); bloomPass.setSize(w, h)
    labelRenderer.setSize(w, h)
  }
  const onResize = () => resize()
  window.addEventListener('resize', onResize); resize()

  let lastSensors: Sensors | null = null
  let lastLampFactor = 0

  function setSensors(sensors: Sensors) {
    lastSensors = sensors
    const dayFactor = clamp(sensors.lExt / 1023, 0, 1)
    
    const skyColorDay = new THREE.Color('#87CEEB')
    const skyColorNight = new THREE.Color('#05070a')
    const currentSky = skyColorNight.clone().lerp(skyColorDay, dayFactor)
    scene.background = currentSky
    scene.fog = new THREE.FogExp2(currentSky, 0.005 + (1-dayFactor)*0.005)

    // Gestione Environment (IBL) per buio vero
    // Se è notte, abbassiamo drasticamente l'intensità della mappa ambientale
    // Anche di giorno, teniamo più basso per evitare soffitto “bruciato”
    scene.environmentIntensity = 0.01 + (dayFactor * 0.55) // Notte ~0, Giorno ~0.56

    room.sun.intensity = dayFactor * 1.6 // meno aggressivo sul soffitto
    room.sun.position.set(5 + dayFactor * 5, 2 + dayFactor * 10, -10 + dayFactor * 5)
    room.sunMesh.position.copy(room.sun.position.clone().multiplyScalar(2))
    room.sunMesh.visible = dayFactor > 0.05
    
    room.ambient.intensity = dayFactor * 0.08 // notte ~0
    room.ambient.color.setHSL(0.6, 0.35, 0.42 * dayFactor + 0.02)

    room.windowLight.intensity = dayFactor * 3.2
    room.windowLight.color.setHSL(0.6, 0.2, 0.8)

    // esposizione: più buio di notte se lampada spenta
    renderer.toneMappingExposure = 0.65 + dayFactor * 0.25 + lastLampFactor * 0.22
  }

  function setOutputs(outputs: Outputs) {
    const lampFactor = clamp(outputs.lampPwm / 255, 0, 1)
    lastLampFactor = lampFactor
    
    // Lampada centrale
    room.centerLight.intensity = lampFactor * 80 // Molto luminosa quando accesa
    room.lampInnerLight.intensity = lampFactor * 18
    room.lampRingMat.emissiveIntensity = lampFactor * 6.5
    room.lampDiffuserMat.emissiveIntensity = lampFactor * 4.5
    bloomPass.strength = 0.1 + lampFactor * 0.4
    setTagValue(room.tagEls.lamp, `${outputs.lampPwm}/255`)

    const winFactor = clamp(outputs.winPwm / 255, 0, 1)
    const blindsColorOpen = new THREE.Color(0xffffff)
    const blindsColorClosed = new THREE.Color(0x050505)
    room.windowMat.color.copy(blindsColorOpen).lerp(blindsColorClosed, winFactor)
    room.windowMat.transmission = 1.0 - winFactor
    room.windowMat.opacity = 0.1 + (winFactor * 0.9)
    room.windowMat.roughness = 0.2 + (winFactor * 0.6)
    setTagValue(room.tagEls.window, `${outputs.winPwm}/255`)
    
    const currentSun = clamp((lastSensors?.lExt ?? 0) / 1023, 0, 1)
    room.windowLight.intensity = (currentSun * 3.2) * (1 - winFactor * 0.95)

    const humidFactor = clamp(outputs.humidPwm / 255, 0, 1)
    ;(room.humidifierParticles.material as THREE.PointsMaterial).opacity = humidFactor * 0.5
    setTagValue(room.tagEls.humidifier, `${outputs.humidPwm}/255`)
  }

  function setDebugText(text: string) {
    void text
  }

  function render(time: number) {
    void time
    controls.update()
    const parts = room.humidifierParticles
    const positions = parts.geometry.attributes.position.array as Float32Array
    const speeds = parts.userData.speeds as Float32Array
    const count = speeds.length
    if ((parts.material as THREE.PointsMaterial).opacity > 0.01) {
       for(let i=0; i<count; i++) {
         positions[i*3 + 1] += speeds[i]
         if (positions[i*3 + 1] > 2.0) {
            positions[i*3 + 1] = 0; positions[i*3] = (Math.random()-0.5)*0.25; positions[i*3+2] = (Math.random()-0.5)*0.25
         }
       }
       parts.geometry.attributes.position.needsUpdate = true
    }
    composer.render()
    labelRenderer.render(scene, camera)
  }

  function dispose() {
    window.removeEventListener('resize', onResize)
    controls.dispose(); renderer.dispose(); composer.dispose()
    labelRenderer.domElement.remove()
  }

  return { canvas, renderer, scene, camera, controls, ready, dispose, render, setSensors, setOutputs, setDebugText }
}
