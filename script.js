import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import * as CANNON from 'cannon-es';

const FIELD_MODEL_URL = "./field/model.glb";
const FIELD_CONFIG_URL = "./field/config.json";
const ROBOT_MODEL_URL = "./robot/model.glb";
const ROBOT_CONFIG_URL = "./robot/config.json";

const TAG_OVERRIDES = {
  // Examples:
  // 1: { position: [-3.607, -3.39, 0.889], rotationDeg: 0 },
  // 2: { rotationOffsetDeg: 90 },
  // 3: { rotationX: 45, rotationY: 30, rotationZ: 90 },
  // "1-5": { rotationY: 180 }, // Applies to tags 1 through 5
  "3-4": { rotationY: 180, rotationZ: 180 },
  1: { rotationY: 180, rotationZ: 180 },
  6: { rotationY: 180, rotationZ: 180 },
  "13-16": { rotationY: 180, rotationZ: 180 },
  "25-26": { rotationY: 180, rotationZ: 180 },
  23: { rotationY: 180, rotationZ: 180 },
  5: { rotationX: 270, rotationZ: 270, rotationY: 180 },
  8: { rotationX: 270, rotationZ: 270, rotationY: 180 },
  2: { rotationX: 270, rotationZ: 90, rotationY: 180 },
  11: { rotationX: 270, rotationZ: 90, rotationY: 180 },
  21: { rotationX: 270, rotationZ: 90, rotationY: 180 },
  24: { rotationX: 270, rotationZ: 90, rotationY: 180 },
  18: { rotationX: 270, rotationZ: 270, rotationY: 180 },
  27: { rotationX: 270, rotationZ: 270, rotationY: 180 },
  28: { rotationX: 180, rotationZ: 0, rotationY: 0 }
};

let showField = true;
let showDebugAxes = false;
let allAxisHelpers = [];
let lastTime = 0;
let frameCount = 0;

const app = document.querySelector("#app");
if (!app) {
  throw new Error("Missing #app element.");
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const mainCamera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.05,
  500
);
mainCamera.position.set(0, 0, 20);
mainCamera.lookAt(0, 0, 0);

const povCamera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.05,
  500
);
let povCameraBaseFov = povCamera.fov;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);
renderer.domElement.style.touchAction = "none";

const hud = document.createElement("div");
hud.style.position = "absolute";
hud.style.top = "12px";
hud.style.left = "12px";
hud.style.padding = "10px 12px";
hud.style.background = "rgba(8, 12, 16, 0.72)";
hud.style.color = "#f8fafc";
hud.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";
hud.style.fontSize = "12px";
hud.style.lineHeight = "1.4";
hud.style.borderRadius = "8px";
hud.style.pointerEvents = "none";
hud.style.whiteSpace = "pre";
app.appendChild(hud);

const offsetPanel = document.createElement("div");
offsetPanel.style.position = "absolute";
offsetPanel.style.top = "12px";
offsetPanel.style.right = "12px";
offsetPanel.style.padding = "10px 12px";
offsetPanel.style.background = "rgba(8, 12, 16, 0.72)";
offsetPanel.style.color = "#f8fafc";
offsetPanel.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";
offsetPanel.style.fontSize = "12px";
offsetPanel.style.lineHeight = "1.4";
offsetPanel.style.borderRadius = "8px";
offsetPanel.style.display = "grid";
offsetPanel.style.gap = "8px";
offsetPanel.style.minWidth = "200px";
offsetPanel.style.pointerEvents = "auto"
app.appendChild(offsetPanel);

const constantsPanel = document.createElement("div");
constantsPanel.style.display = "grid";
constantsPanel.style.gap = "6px";
constantsPanel.style.paddingTop = "6px";
constantsPanel.style.borderTop = "1px solid rgba(255, 255, 255, 0.08)";
offsetPanel.appendChild(constantsPanel);

const constantsTitle = document.createElement("div");
constantsTitle.textContent = "Localization Constants";
constantsTitle.style.fontWeight = "600";
constantsPanel.appendChild(constantsTitle);

const constantsBody = document.createElement("div");
constantsBody.style.whiteSpace = "pre";
constantsBody.style.fontFamily =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";
constantsBody.style.fontSize = "11px";
constantsBody.style.color = "rgba(226, 232, 240, 0.9)";
constantsPanel.appendChild(constantsBody);

const visionPanel = document.createElement("div");
visionPanel.style.position = "absolute";
visionPanel.style.left = "250px";
visionPanel.style.bottom = "12px";
visionPanel.style.transform = "translateX(-150px)";
visionPanel.style.padding = "2px";
visionPanel.style.background = "rgba(8, 12, 16, 0.9)";
visionPanel.style.border = "0px solid rgba(255, 255, 255, 0.12)";
visionPanel.style.borderRadius = "10px";
visionPanel.style.boxShadow = "0 10px 30px rgba(0, 0, 0, 0.35)";
visionPanel.style.pointerEvents = "none";
visionPanel.style.display = "grid";
visionPanel.style.gap = "6px";
app.appendChild(visionPanel);

const mentalModelPanel = document.createElement("div");
mentalModelPanel.style.position = "absolute";
mentalModelPanel.style.left = "50%";
mentalModelPanel.style.bottom = "12px";
mentalModelPanel.style.transform = "translateX(-50%)";
mentalModelPanel.style.padding = "8px 10px 10px";
mentalModelPanel.style.background = "rgba(8, 12, 16, 0.9)";
mentalModelPanel.style.borderRadius = "12px";
mentalModelPanel.style.boxShadow = "0 10px 30px rgba(0, 0, 0, 0.35)";
mentalModelPanel.style.pointerEvents = "none";
mentalModelPanel.style.display = "grid";
mentalModelPanel.style.gap = "6px";
mentalModelPanel.style.alignItems = "center";
app.appendChild(mentalModelPanel);

const mentalModelLabel = document.createElement("div");
mentalModelLabel.textContent = "Mental Model";
mentalModelLabel.style.fontFamily =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";
mentalModelLabel.style.fontSize = "11px";
mentalModelLabel.style.color = "rgba(248, 250, 252, 0.9)";
mentalModelLabel.style.letterSpacing = "0.04em";
mentalModelLabel.style.textTransform = "uppercase";
mentalModelPanel.appendChild(mentalModelLabel);

const mentalModelCanvas = document.createElement("canvas");
mentalModelCanvas.style.display = "block";
mentalModelCanvas.style.borderRadius = "8px";
mentalModelCanvas.style.background = "#0b1118";
mentalModelPanel.appendChild(mentalModelCanvas);

const visionLabel = document.createElement("div");
visionLabel.textContent = "POV Stream";
visionLabel.style.fontFamily =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";
visionLabel.style.fontSize = "11px";
visionLabel.style.color = "rgba(248, 250, 252, 0.9)";
visionLabel.style.letterSpacing = "0.04em";
visionLabel.style.textTransform = "uppercase";
visionPanel.appendChild(visionLabel);

const detectionStatusIndicator = document.createElement("div");
detectionStatusIndicator.textContent = "Status: Waiting";
detectionStatusIndicator.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";
detectionStatusIndicator.style.fontSize = "10px";
detectionStatusIndicator.style.color = "#94a3b8";
detectionStatusIndicator.id = "detection-status";
visionPanel.appendChild(detectionStatusIndicator);

const visionCanvas = document.createElement("canvas");
visionCanvas.style.display = "block";
visionCanvas.style.borderRadius = "6px";
visionCanvas.style.background = "#0b1118";
visionPanel.appendChild(visionCanvas);

const offsetControls = [];
let offsetLocked = true;

const offsetHeader = document.createElement("div");
offsetHeader.style.display = "flex";
offsetHeader.style.alignItems = "center";
offsetHeader.style.justifyContent = "space-between";
offsetHeader.style.gap = "8px";

const offsetTitle = document.createElement("div");
offsetTitle.textContent = "Settings";
offsetTitle.style.fontWeight = "600";

const offsetLockButton = document.createElement("button");
offsetLockButton.type = "button";
offsetLockButton.style.cursor = "pointer";
offsetLockButton.style.background = "rgba(255, 255, 255, 0.08)";
offsetLockButton.style.border = "1px solid rgba(255, 255, 255, 0.15)";
offsetLockButton.style.color = "inherit";
offsetLockButton.style.borderRadius = "6px";
offsetLockButton.style.padding = "4px 8px";
offsetLockButton.style.fontFamily =
  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";
offsetLockButton.style.fontSize = "11px";

function updateOffsetLockUi() {
  offsetLockButton.textContent = offsetLocked ? "Locked" : "Unlocked";
  offsetControls.forEach((control) => {
    control.disabled = offsetLocked;
  });
}

offsetLockButton.addEventListener("click", () => {
  offsetLocked = !offsetLocked;
  updateOffsetLockUi();
});

offsetHeader.appendChild(offsetTitle);
offsetHeader.appendChild(offsetLockButton);
offsetPanel.appendChild(offsetHeader);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
pmremGenerator.dispose();

const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
scene.add(ambientLight);

const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x4b5563, 0.35);
hemisphereLight.position.set(0, 0, 20);
scene.add(hemisphereLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.95);
directionalLight.position.set(10, -10, 20);
directionalLight.target.position.set(0, 0, 0);
directionalLight.castShadow = true;
directionalLight.shadow.bias = -0.0003;
directionalLight.shadow.normalBias = 0.02;
directionalLight.shadow.mapSize.set(1024, 1024);
directionalLight.shadow.camera.near = 1;
directionalLight.shadow.camera.far = 80;
directionalLight.shadow.camera.left = -15;
directionalLight.shadow.camera.right = 15;
directionalLight.shadow.camera.top = 15;
directionalLight.shadow.camera.bottom = -15;
scene.add(directionalLight);
scene.add(directionalLight.target);

const configGroup = new THREE.Group();
configGroup.rotation.x = -Math.PI / 2;
scene.add(configGroup);

const clock = new THREE.Clock();
let robot = null;
let robotVisual = null;
let robotVisualBaseRotation = null;
let fieldModel = null;
const robotShaderMaterials = [];

const autoDriveState = {
  enabled: false,
  heading: 0,
};

const robotCameraState = {
  rig: new THREE.Object3D(),
  config: null,
  ready: false,
};

const captureState = {
  index: 0,
  directoryHandle: null,
  inProgress: false,
  width: null,
  height: null,
  target: null,
  buffer: null,
  canvas: null,
  lastSaved: "",
};

const visionState = {
  enabled: true,
  width: 480,
  height: 360,
  target: null,
  buffer: null,
  imageData: null,
  ctx: visionCanvas.getContext("2d"),
};
visionCanvas.width = visionState.width;
visionCanvas.height = visionState.height;
visionCanvas.style.width = `${visionState.width}px`;
visionCanvas.style.height = `${visionState.height}px`;

const detectionState = {
  detections: [],
  imageSize: null,
  lastUpdated: 0,
  error: null,
  fusedPose: null,
  autoCaptureEnabled: true,
  autoCaptureIntervalMs: 100,
  detectionStatus: "waiting", // "waiting", "success", "error"
};

const mentalModelState = {
  canvas: mentalModelCanvas,
  ctx: mentalModelCanvas.getContext("2d"),
  fieldWidthMeters: null,
  fieldHeightMeters: null,
  tagPositions: new Map(),
  padding: 12,
  width: 0,
  height: 0,
  robotEstimate: null,
  lastRobotEstimate: null,
};

const websocketState = {
  url: "ws://localhost:5174",
  socket: null,
  connected: false,
  connecting: false,
  reconnectDelayMs: 1000,
  reconnectTimer: null,
  sendInFlight: false,
  sendInterval: null,
  lastSentAt: null,
};

const tempQuat = new THREE.Quaternion();
const mapToSimRot = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, -1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1
);
const tempMat4A = new THREE.Matrix4();
const tempMat4B = new THREE.Matrix4();
const tempVec3A = new THREE.Vector3();
const tempVec3B = new THREE.Vector3(1, 1, 1);
const tempObj3dA = new THREE.Object3D();
const povLookState = {
  yaw: 0,
  pitch: 0,
  minPitch: -Math.PI / 3,
  maxPitch: Math.PI / 3,
};
const povYawQuat = new THREE.Quaternion();
const povPitchQuat = new THREE.Quaternion();
const povOffsetYawQuat = new THREE.Quaternion();
const povOffsetPitchQuat = new THREE.Quaternion();
const povOffsetRollQuat = new THREE.Quaternion();
const povYawAxis = new THREE.Vector3(0, 0, 1);
const povPitchAxis = new THREE.Vector3(1, 0, 0);
const povRollAxis = new THREE.Vector3(0, 1, 0);

const robotMotion = {
  speed: 2,
  rotationSpeed: 2, // radians per second
  height: 0,
  halfSize: 0,
};

const driveSpeedScale = 3.0;
let robotHeadingOffset = 0;
const offsetState = {
  yawDeg: 90,
  pitchDeg: 90,
  rollDeg: 0,
};
const robotOffsetState = {
  yawDeg: 90,
  pitchDeg: -90,
  rollDeg: 0,
};

function createOffsetSlider(labelText, min, max, step, initialValue, onChange) {
  const container = document.createElement("div");
  container.style.display = "grid";
  container.style.gap = "4px";

  const label = document.createElement("label");
  label.style.display = "flex";
  label.style.justifyContent = "space-between";
  label.style.alignItems = "center";
  label.style.gap = "8px";
  label.style.fontSize = "12px";
  label.textContent = labelText;

  const value = document.createElement("span");
  value.textContent = `${initialValue}°`;
  label.appendChild(value);

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(initialValue);
  input.style.width = "100%";
  offsetControls.push(input);

  input.addEventListener("input", () => {
    const nextValue = Number(input.value);
    value.textContent = `${nextValue}°`;
    onChange(nextValue);
  });

  container.appendChild(label);
  container.appendChild(input);
  offsetPanel.appendChild(container);
}

function createSettingSlider(labelText, min, max, step, initialValue, unit, onChange) {
  const container = document.createElement("div");
  container.style.display = "grid";
  container.style.gap = "4px";

  const label = document.createElement("label");
  label.style.display = "flex";
  label.style.justifyContent = "space-between";
  label.style.alignItems = "center";
  label.style.gap = "8px";
  label.style.fontSize = "12px";
  label.textContent = labelText;

  const value = document.createElement("span");
  value.textContent = `${initialValue}${unit}`;
  label.appendChild(value);

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(initialValue);
  input.style.width = "100%";

  input.addEventListener("input", () => {
    const nextValue = Number(input.value);
    value.textContent = `${nextValue}${unit}`;
    onChange(nextValue);
  });

  container.appendChild(label);
  container.appendChild(input);
  offsetPanel.appendChild(container);
}

function applyRobotVisualOffset() {
  if (!robotVisual || !robotVisualBaseRotation) {
    return;
  }
  const yawOffset = THREE.MathUtils.degToRad(robotOffsetState.yawDeg);
  const pitchOffset = THREE.MathUtils.degToRad(robotOffsetState.pitchDeg);
  const rollOffset = THREE.MathUtils.degToRad(robotOffsetState.rollDeg);
  robotVisual.rotation.set(
    robotVisualBaseRotation.x + pitchOffset,
    robotVisualBaseRotation.y + yawOffset,
    robotVisualBaseRotation.z + rollOffset
  );
}

const physicsState = {
  world: null,
  robotBody: null,
  groundBody: null,
  wallBodies: [],
  bounds: null,
  groundHeight: 0,
  fixedTimeStep: 1 / 60,
  maxSubSteps: 3,
  isReady: false,
};

const physicsMaterials = {
  robot: new CANNON.Material("robot"),
  ground: new CANNON.Material("ground"),
};

const fieldBounds = new THREE.Vector2(0, 0);
const keyState = {
  KeyW: false,
  KeyA: false,
  KeyS: false,
  KeyD: false,
};

function inchesToMeters(inches) {
  return inches * 0.0254;
}

function applyRotations(object3d, rotations) {
  if (!Array.isArray(rotations)) {
    return;
  }

  rotations.forEach(({ axis, degrees }) => {
    const radians = THREE.MathUtils.degToRad(degrees);
    switch (axis) {
      case "x":
        object3d.rotateX(radians);
        break;
      case "y":
        object3d.rotateY(radians);
        break;
      case "z":
        object3d.rotateZ(radians);
        break;
      default:
        console.warn("Unknown rotation axis:", axis);
    }
  });
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return value.toFixed(digits);
}

function applyCameraConfigToRig() {
  const cameraConfig = robotCameraState.config;
  if (!robotCameraState.ready || !cameraConfig) {
    return;
  }
  robotCameraState.rig.position.set(
    cameraConfig.position?.[0] ?? 0,
    cameraConfig.position?.[1] ?? 0,
    cameraConfig.position?.[2] ?? 0
  );
  robotCameraState.rig.rotation.set(0, 0, 0);
  applyRotations(robotCameraState.rig, cameraConfig.rotations);

  if (typeof cameraConfig.fov === "number") {
    povCamera.fov = cameraConfig.fov;
    povCamera.updateProjectionMatrix();
    povCameraBaseFov = povCamera.fov;
  }
  updateLocalizationConstants();
}

function computeCameraIntrinsics(cameraConfig) {
  const resolution = Array.isArray(cameraConfig?.resolution) ? cameraConfig.resolution : null;
  const width = resolution?.[0] ?? captureState.width ?? 0;
  const height = resolution?.[1] ?? captureState.height ?? 0;
  const fovDeg = typeof cameraConfig?.fov === "number" ? cameraConfig.fov : povCamera.fov;
  if (!width || !height || !Number.isFinite(fovDeg)) {
    return null;
  }
  const fovRad = THREE.MathUtils.degToRad(fovDeg);
  const fy = (height / 2) / Math.tan(fovRad / 2);
  const fx = fy * (width / height);
  const cx = width / 2;
  const cy = height / 2;
  return { width, height, fovDeg, fx, fy, cx, cy };
}

function updateLocalizationConstants() {
  const cameraConfig = robotCameraState.config;
  if (!cameraConfig) {
    constantsBody.textContent = "camera: n/a";
    return;
  }
  const intrinsics = computeCameraIntrinsics(cameraConfig);
  const position = cameraConfig.position || [0, 0, 0];
  const rotations = Array.isArray(cameraConfig.rotations) ? cameraConfig.rotations : [];

  const rotationLines = rotations.length
    ? rotations.map((rot) => `${rot.axis}=${formatNumber(rot.degrees, 1)}°`).join(" ")
    : "none";

  const lines = [
    `res: ${intrinsics ? `${intrinsics.width}x${intrinsics.height}` : "n/a"}`,
    `fov: ${intrinsics ? formatNumber(intrinsics.fovDeg, 1) : "n/a"}°`,
    `fx: ${intrinsics ? formatNumber(intrinsics.fx, 2) : "n/a"}`,
    `fy: ${intrinsics ? formatNumber(intrinsics.fy, 2) : "n/a"}`,
    `cx: ${intrinsics ? formatNumber(intrinsics.cx, 2) : "n/a"}`,
    `cy: ${intrinsics ? formatNumber(intrinsics.cy, 2) : "n/a"}`,
    `pos: [${formatNumber(position[0], 2)}, ${formatNumber(position[1], 2)}, ${formatNumber(position[2], 2)}]`,
    `rot: ${rotationLines}`,
  ];
  constantsBody.textContent = lines.join("\n");
}

function updateHud() {
  const autoLabel = autoDriveState.enabled ? "ON" : "OFF";
  const autoCaptureLabel = detectionState.autoCaptureEnabled ? "AUTO" : "MANUAL";
  const detectionStatusLabel = detectionState.detectionStatus.toUpperCase();
  const outputLabel = websocketState.connected ? "ws connected" : "ws disconnected";
  const savedLabel = websocketState.lastSentAt
    ? `last=${new Date(websocketState.lastSentAt).toLocaleTimeString()}`
    : "ready";
  hud.textContent =
    `Auto-drive: ${autoLabel}\n` +
    `Capture: ${autoCaptureLabel}, ${outputLabel}, ${savedLabel}\n` +
    `Detections: ${detectionStatusLabel} (${detectionState.detections.length})\n` +
    "Keys: M=drive O=output P=send K=auto-send C=center H=field\n" +
    "Move: W/S forward/back A/D turn\n" +
    "Mouse: drag to look (POV)";
}

function createTagMaterial(id) {
  if (!createTagMaterial.cache) {
    createTagMaterial.cache = new Map();
    createTagMaterial.loader = new THREE.TextureLoader();
  }

  const cached = createTagMaterial.cache.get(id);
  if (cached) {
    return cached;
  }

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#f8f8f8";
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, size - 12, size - 12);
  ctx.fillStyle = "#f8f8f8";
  ctx.font = "bold 72px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(id), size / 2, size / 2);

  const fallbackTexture = new THREE.CanvasTexture(canvas);
  fallbackTexture.generateMipmaps = false;
  fallbackTexture.minFilter = THREE.LinearFilter;
  fallbackTexture.magFilter = THREE.LinearFilter;
  fallbackTexture.anisotropy = 1;
  fallbackTexture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.MeshBasicMaterial({
    map: fallbackTexture,
    side: THREE.DoubleSide,
  });

  const texturePath = `./tags/${id}.png`;
  createTagMaterial.loader.load(
    texturePath,
    (texture) => {
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = 2;
      texture.colorSpace = THREE.SRGBColorSpace;
      material.map = texture;
      material.needsUpdate = true;
    },
    undefined,
    () => {
      console.warn(`Missing AprilTag texture: ${texturePath}`);
    }
  );

  createTagMaterial.cache.set(id, material);
  return material;
}

function getTagGeometry(variant, geometryCache) {
  if (geometryCache.has(variant)) {
    return geometryCache.get(variant);
  }

  const match = /-(\d+(\.\d+)?)in/i.exec(variant);
  const sizeInches = match ? Number(match[1]) : 6.5;
  const sizeMeters = inchesToMeters(sizeInches);
  const geometry = new THREE.PlaneGeometry(sizeMeters, sizeMeters);
  geometryCache.set(variant, geometry);
  return geometry;
}

function createRobotMaterial(baseColor, rimColor) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uBaseColor: { value: new THREE.Color(baseColor) },
      uRimColor: { value: new THREE.Color(rimColor) },
      uLightDir: { value: new THREE.Vector3(1, 1, 1) },
      uRimPower: { value: 2.2 },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uBaseColor;
      uniform vec3 uRimColor;
      uniform vec3 uLightDir;
      uniform float uRimPower;
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vec3 normal = normalize(vNormal);
        vec3 lightDir = normalize(uLightDir);
        float ndotl = max(dot(normal, lightDir), 0.0);
        float diffuse = 0.25 + 0.75 * ndotl;
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float rim = pow(1.0 - max(dot(viewDir, normal), 0.0), uRimPower);
        float pulse = 0.5 + 0.5 * sin(uTime * 0.8);
        vec3 color = uBaseColor * diffuse + uRimColor * rim * (0.35 + 0.2 * pulse);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  robotShaderMaterials.push(material);
  return material;
}

function getTagSpin(rotations) {
  if (!Array.isArray(rotations)) {
    return 0;
  }
  return rotations.reduce((acc, rotation) => {
    if (rotation.axis === "z") {
      return acc + THREE.MathUtils.degToRad(rotation.degrees);
    }
    return acc;
  }, 0);
}

function getTagOverride(tagId) {
  // Check for exact match first
  if (TAG_OVERRIDES[tagId]) {
    return TAG_OVERRIDES[tagId];
  }
  // Check for range matches
  for (const key in TAG_OVERRIDES) {
    if (key.includes('-')) {
      const [start, end] = key.split('-').map(Number);
      if (!isNaN(start) && !isNaN(end) && tagId >= start && tagId <= end) {
        return TAG_OVERRIDES[key];
      }
    }
  }
  return {};
}

function addAprilTags(config) {
  if (!Array.isArray(config.aprilTags)) {
    return;
  }

  const geometryCache = new Map();
  const tagGroup = new THREE.Group();
  mentalModelState.tagPositions.clear();

  config.aprilTags.forEach((tag) => {
    const geometry = getTagGeometry(tag.variant, geometryCache);
    const material = createTagMaterial(tag.id);
    const mesh = new THREE.Mesh(geometry, material);
    const override = getTagOverride(tag.id);
    const position = override.position || tag.position;
    mentalModelState.tagPositions.set(tag.id, {
      x: position[0],
      y: position[1],
    });
    const configSpin = getTagSpin(tag.rotations);
    const overrideSpin =
      typeof override.rotationDeg === "number"
        ? THREE.MathUtils.degToRad(override.rotationDeg) - configSpin
        : THREE.MathUtils.degToRad(override.rotationOffsetDeg || 0);

    mesh.position.set(position[0], position[1], position[2]);
    mesh.rotateX(-Math.PI / 2);
    mesh.rotateY(-Math.PI / 2);
    applyRotations(mesh, tag.rotations);
    if (overrideSpin !== 0) {
      mesh.rotateZ(overrideSpin);
    }
    // Apply additional per-axis rotations from override
    if (typeof override.rotationX === "number") {
      mesh.rotateX(THREE.MathUtils.degToRad(override.rotationX));
    }
    if (typeof override.rotationY === "number") {
      mesh.rotateY(THREE.MathUtils.degToRad(override.rotationY));
    }
    if (typeof override.rotationZ === "number") {
      mesh.rotateZ(THREE.MathUtils.degToRad(override.rotationZ));
    }
    mesh.position.z += 0.01;

    tagGroup.add(mesh);
  });

  console.log(`AprilTags added: ${config.aprilTags.length}`);
  configGroup.add(tagGroup);
  return tagGroup;
}

function upgradeFieldMaterial(material) {
  if (!material) {
    return material;
  }
  if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) {
    return material;
  }

  const upgraded = new THREE.MeshStandardMaterial({
    color: material.color ? material.color.clone() : new THREE.Color(0xffffff),
    map: material.map || null,
    normalMap: material.normalMap || null,
    roughnessMap: material.roughnessMap || null,
    metalnessMap: material.metalnessMap || null,
    emissive: material.emissive ? material.emissive.clone() : new THREE.Color(0x000000),
    emissiveMap: material.emissiveMap || null,
    emissiveIntensity: material.emissiveIntensity ?? 1,
    alphaMap: material.alphaMap || null,
    transparent: material.transparent ?? false,
    opacity: material.opacity ?? 1,
    alphaTest: material.alphaTest ?? 0,
    side: material.side ?? THREE.FrontSide,
    vertexColors: material.vertexColors ?? false,
    depthWrite: material.depthWrite ?? true,
    depthTest: material.depthTest ?? true,
  });

  upgraded.name = material.name || "";
  return upgraded;
}

function tuneFieldMaterials(root) {
  root.traverse((child) => {
    if (!child.isMesh || !child.material) {
      return;
    }

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    const tunedMaterials = materials.map((material) => {
      const tuned = upgradeFieldMaterial(material);
      child.castShadow = true;
      child.receiveShadow = true;
      if ("envMapIntensity" in tuned) {
        tuned.envMapIntensity = 1.0; // Increased for better reflections
      }
      if ("metalness" in tuned) {
        tuned.metalness = Math.min(tuned.metalness, 0.5); // Allow higher metalness for reflections
      }
      if ("roughness" in tuned) {
        tuned.roughness = Math.max(tuned.roughness, 0.3); // Allow lower roughness for more shine
      }
      tuned.needsUpdate = true;
      return tuned;
    });

    child.material = Array.isArray(child.material)
      ? tunedMaterials
      : tunedMaterials[0];
  });
}

function createRobot(sizeMeters) {
  const group = new THREE.Group();
  const bodyMaterial = createRobotMaterial(0x1f6feb, 0x9fe7ff);
  const bodyGeometry = new THREE.BoxGeometry(
    sizeMeters,
    sizeMeters,
    sizeMeters
  );
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.z = sizeMeters / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const noseMaterial = createRobotMaterial(0xf97316, 0xffc08a);
  const noseGeometry = new THREE.BoxGeometry(
    sizeMeters * 0.2,
    sizeMeters * 0.5,
    sizeMeters * 0.2
  );
  const nose = new THREE.Mesh(noseGeometry, noseMaterial);
  nose.position.set(sizeMeters * 0.45, 0, sizeMeters * 0.55);
  nose.castShadow = true;
  nose.receiveShadow = true;
  group.add(nose);

  return group;
}

function applyRobotGroundOffset(visual, radius, root) {
  if (!visual) {
    return;
  }
  visual.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(visual);
  if (root) {
    root.updateWorldMatrix(true, true);
    const toLocal = new THREE.Matrix4().copy(root.matrixWorld).invert();
    box.applyMatrix4(toLocal);
  }
  if (!Number.isFinite(box.min.z)) {
    return;
  }
  const desiredMinZ = -radius;
  const offset = desiredMinZ - box.min.z;
  visual.position.z += offset;
}

function updateRobotHeadingOffset() {
  if (!robotVisual) {
    robotHeadingOffset = 0;
    return;
  }

  robotVisual.updateMatrixWorld(true);
  const forward = new THREE.Vector3(0, 0, -1);
  forward.applyQuaternion(robotVisual.quaternion);
  forward.z = 0;
  if (forward.lengthSq() < 1e-6) {
    robotHeadingOffset = 0;
    return;
  }
  forward.normalize();
  robotHeadingOffset = Math.atan2(forward.x, -forward.y);
}

function configureRobotCamera(robotConfig) {
  if (!robotConfig || !Array.isArray(robotConfig.cameras) || robotConfig.cameras.length === 0) {
    robotCameraState.ready = false;
    return;
  }

  const cameraConfig = robotConfig.cameras[0];
  robotCameraState.config = cameraConfig;
  if (!robotCameraState.rig.parent && robot) {
    robot.add(robotCameraState.rig);
  }
  robotCameraState.ready = true;

  applyCameraConfigToRig();

  if (Array.isArray(cameraConfig.resolution) && cameraConfig.resolution.length === 2) {
    captureState.width = cameraConfig.resolution[0];
    captureState.height = cameraConfig.resolution[1];
    const targetWidth = Math.max(240, Math.round(cameraConfig.resolution[0] * 0.4));
    const targetHeight = Math.max(180, Math.round(cameraConfig.resolution[1] * 0.4));
    ensureVisionTarget(targetWidth, targetHeight);
  }
  updateLocalizationConstants();
}

function updateRobotCamera() {
  if (!robotCameraState.ready) {
    return;
  }
  robotCameraState.rig.updateWorldMatrix(true, false);
  robotCameraState.rig.getWorldPosition(povCamera.position);
  robotCameraState.rig.getWorldQuaternion(tempQuat);
  povCamera.quaternion.copy(tempQuat);
  if (offsetState.yawDeg || offsetState.pitchDeg || offsetState.rollDeg) {
    povOffsetYawQuat.setFromAxisAngle(
      povYawAxis,
      THREE.MathUtils.degToRad(offsetState.yawDeg)
    );
    povOffsetPitchQuat.setFromAxisAngle(
      povPitchAxis,
      THREE.MathUtils.degToRad(offsetState.pitchDeg)
    );
    povOffsetRollQuat.setFromAxisAngle(
      povRollAxis,
      THREE.MathUtils.degToRad(offsetState.rollDeg)
    );
    povCamera.quaternion.multiply(povOffsetYawQuat);
    povCamera.quaternion.multiply(povOffsetPitchQuat);
    povCamera.quaternion.multiply(povOffsetRollQuat);
  }
  if (povLookState.yaw !== 0 || povLookState.pitch !== 0) {
    povYawQuat.setFromAxisAngle(povYawAxis, povLookState.yaw);
    povPitchQuat.setFromAxisAngle(povPitchAxis, povLookState.pitch);
    povCamera.quaternion.multiply(povYawQuat);
    povCamera.quaternion.multiply(povPitchQuat);
  }
  // Rotate camera 180 degrees around Y-axis to face the front of the robot (direction of movement)
  const cameraFlipQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  povCamera.quaternion.multiply(cameraFlipQuat);
}

function setAutoDriveEnabled(enabled) {
  autoDriveState.enabled = enabled;
  if (enabled && robot) {
    autoDriveState.heading = robot.rotation.z;
  }
  updateHud();
}

function resetPovLook() {
  povLookState.yaw = 0;
  povLookState.pitch = 0;
  povCamera.fov = povCameraBaseFov;
  povCamera.updateProjectionMatrix();
}

function toggleAutoDrive() {
  setAutoDriveEnabled(!autoDriveState.enabled);
}

function ensureCaptureTarget(width, height) {
  if (captureState.target && captureState.width === width && captureState.height === height) {
    return;
  }

  if (captureState.target) {
    captureState.target.dispose();
  }

  captureState.width = width;
  captureState.height = height;
  captureState.target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  captureState.buffer = new Uint8Array(width * height * 4);
}

function renderCaptureBlob() {
  const width = captureState.width || renderer.domElement.width;
  const height = captureState.height || renderer.domElement.height;
  ensureCaptureTarget(width, height);

  const prevAspect = povCamera.aspect;
  povCamera.aspect = width / height;
  povCamera.updateProjectionMatrix();

  renderer.setRenderTarget(captureState.target);
  renderer.render(scene, povCamera);
  renderer.readRenderTargetPixels(captureState.target, 0, 0, width, height, captureState.buffer);
  renderer.setRenderTarget(null);

  povCamera.aspect = prevAspect;
  povCamera.updateProjectionMatrix();

  if (!captureState.canvas) {
    captureState.canvas = document.createElement("canvas");
  }
  const canvas = captureState.canvas;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y += 1) {
    const srcStart = (height - 1 - y) * rowBytes;
    const dstStart = y * rowBytes;
    imageData.data.set(
      captureState.buffer.subarray(srcStart, srcStart + rowBytes),
      dstStart
    );
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
}

function ensureVisionTarget(width, height) {
  if (visionState.target && visionState.width === width && visionState.height === height) {
    return;
  }
  if (visionState.target) {
    visionState.target.dispose();
  }
  visionState.width = width;
  visionState.height = height;
  visionCanvas.width = width;
  visionCanvas.height = height;
  visionCanvas.style.width = `${width}px`;
  visionCanvas.style.height = `${height}px`;
  visionState.target = new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  visionState.buffer = new Uint8Array(width * height * 4);
  visionState.imageData = visionState.ctx.createImageData(width, height);
}

function drawDetectionOutlines(ctx, width, height) {
  if (!detectionState.detections.length) {
    return;
  }

  const imageSize = detectionState.imageSize;
  const scaleX = imageSize ? width / imageSize[0] : 1;
  const scaleY = imageSize ? height / imageSize[1] : 1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";

  for (const det of detectionState.detections) {
    const corners = det.corners;
    if (!Array.isArray(corners) || corners.length !== 4) {
      continue;
    }

    // Determine color based on detection quality
    let strokeColor = "rgba(0, 255, 120, 0.9)"; // Default green for good detection
    if (det.hamming > 0) {
      strokeColor = "rgba(255, 165, 0, 0.9)"; // Orange for hamming errors
    } else if (det.decision_margin < 50) {
      strokeColor = "rgba(255, 255, 0, 0.9)"; // Yellow for low confidence
    }

    const pts = corners.map(([x, y]) => [x * scaleX, y * scaleY]);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.lineTo(pts[1][0], pts[1][1]);
    ctx.lineTo(pts[2][0], pts[2][1]);
    ctx.lineTo(pts[3][0], pts[3][1]);
    ctx.closePath();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    const cx =
      (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4;
    const cy =
      (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4;
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.fillRect(cx - 12, cy - 12, 24, 16);
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillText(String(det.id), cx - 8, cy);
  }
  ctx.restore();
}

function setDetectionStatus(status, errorMessage = null) {
  detectionState.detectionStatus = status;
  detectionState.error = errorMessage;
  updateDetectionStatusUI();
}

function handleDetectionMessage(data) {
  if (!data) {
    return;
  }
  if (data.type === "error") {
    setDetectionStatus("error", data.message || "Detection error");
    detectionState.fusedPose = null;
    return;
  }
  if (data.detections) {
    detectionState.detections = data.detections;
    detectionState.imageSize = data.image_size || data.imageSize || [960, 720];
    detectionState.fusedPose = data.fused_pose || data.fusedPose || null;
    detectionState.lastUpdated = Date.now();
    setDetectionStatus("success", null);
  }
}

function scheduleWebsocketReconnect() {
  if (websocketState.reconnectTimer) {
    return;
  }
  websocketState.reconnectTimer = setTimeout(() => {
    websocketState.reconnectTimer = null;
    connectWebsocket();
  }, websocketState.reconnectDelayMs);
}

function connectWebsocket() {
  if (websocketState.connected || websocketState.connecting) {
    return;
  }
  websocketState.connecting = true;
  try {
    const socket = new WebSocket(websocketState.url);
    socket.binaryType = "arraybuffer";
    websocketState.socket = socket;

    socket.addEventListener("open", () => {
      websocketState.connected = true;
      websocketState.connecting = false;
      setDetectionStatus("waiting", null);
      if (detectionState.autoCaptureEnabled) {
        startWebsocketSendLoop();
      }
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        try {
          const payload = JSON.parse(event.data);
          handleDetectionMessage(payload);
        } catch (error) {
          setDetectionStatus("error", "Invalid detection payload");
        }
      }
    });

    socket.addEventListener("close", () => {
      websocketState.connected = false;
      websocketState.connecting = false;
      websocketState.socket = null;
      stopWebsocketSendLoop();
      setDetectionStatus("waiting", "WebSocket closed");
      scheduleWebsocketReconnect();
    });

    socket.addEventListener("error", () => {
      websocketState.connected = false;
      websocketState.connecting = false;
      websocketState.socket = null;
      stopWebsocketSendLoop();
      setDetectionStatus("error", "WebSocket error");
      scheduleWebsocketReconnect();
    });
  } catch (error) {
    websocketState.connecting = false;
    setDetectionStatus("error", "WebSocket init failed");
    scheduleWebsocketReconnect();
  }
}

function stopWebsocketSendLoop() {
  if (websocketState.sendInterval) {
    clearInterval(websocketState.sendInterval);
    websocketState.sendInterval = null;
  }
}

function startWebsocketSendLoop() {
  stopWebsocketSendLoop();
  websocketState.sendInterval = setInterval(() => {
    if (!websocketState.connected || !detectionState.autoCaptureEnabled) {
      return;
    }
    sendPovFrame();
  }, detectionState.autoCaptureIntervalMs);
}

async function sendPovFrame() {
  if (!websocketState.connected || websocketState.sendInFlight) {
    return;
  }
  websocketState.sendInFlight = true;
  try {
    const blob = await renderCaptureBlob();
    if (!blob) {
      return;
    }
    const arrayBuffer = await blob.arrayBuffer();
    if (websocketState.socket && websocketState.socket.readyState === WebSocket.OPEN) {
      websocketState.socket.send(arrayBuffer);
      websocketState.lastSentAt = Date.now();
    }
  } catch (error) {
    setDetectionStatus("error", "Failed to send POV frame");
  } finally {
    websocketState.sendInFlight = false;
  }
}

// Function to update the detection status indicator in the UI
function updateDetectionStatusUI() {
  const statusElement = document.getElementById('detection-status');
  if (statusElement) {
    let statusText = `Status: ${detectionState.detectionStatus.toUpperCase()}`;
    if (detectionState.detectionStatus === 'success') {
      statusText += ` (${detectionState.detections.length} detections)`;
    }
    statusElement.textContent = statusText;

    // Update color based on status
    switch (detectionState.detectionStatus) {
      case 'success':
        statusElement.style.color = '#4ade80'; // Green for success
        break;
      case 'error':
        statusElement.style.color = '#f87171'; // Red for error
        break;
      default:
        statusElement.style.color = '#94a3b8'; // Gray for waiting
    }
  }
}

function updateMentalModelSize() {
  if (!mentalModelState.fieldWidthMeters || !mentalModelState.fieldHeightMeters) {
    return;
  }
  const maxWidth = Math.min(360, Math.max(220, window.innerWidth - 40));
  const aspect = mentalModelState.fieldHeightMeters / mentalModelState.fieldWidthMeters;
  const width = Math.round(maxWidth);
  const height = Math.max(120, Math.round(width * aspect));

  mentalModelState.width = width;
  mentalModelState.height = height;
  mentalModelState.canvas.width = width;
  mentalModelState.canvas.height = height;
  mentalModelState.canvas.style.width = `${width}px`;
  mentalModelState.canvas.style.height = `${height}px`;
}

function computeRobotEstimateFromDetections() {
  const fusedEstimate = computeRobotEstimateFromFusedPose();
  if (fusedEstimate) {
    return fusedEstimate;
  }

  const samples = [];
  for (const det of detectionState.detections) {
    if (!det || !Number.isFinite(det.id)) {
      continue;
    }
    const position = mentalModelState.tagPositions.get(det.id);
    if (!position) {
      continue;
    }
    const pose = det.pose;
    if (!pose || !Array.isArray(pose.translation) || pose.translation.length < 3) {
      continue;
    }
    const [tx, ty, tz] = pose.translation;
    if (![tx, ty, tz].every(Number.isFinite)) {
      continue;
    }
    const distance = Math.hypot(tx, ty, tz);
    if (!Number.isFinite(distance) || distance <= 0) {
      continue;
    }
    samples.push({
      x: position.x,
      y: position.y,
      d: distance,
    });
  }

  if (samples.length < 2) {
    return null;
  }

  if (samples.length === 2) {
    const [a, b] = samples;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const centerDist = Math.hypot(dx, dy);
    if (!Number.isFinite(centerDist) || centerDist <= 1e-6) {
      return null;
    }

    const aLen = (a.d * a.d - b.d * b.d + centerDist * centerDist) / (2 * centerDist);
    const hSq = a.d * a.d - aLen * aLen;
    const ux = dx / centerDist;
    const uy = dy / centerDist;
    const px = a.x + aLen * ux;
    const py = a.y + aLen * uy;

    if (hSq <= 0) {
      return { x: px, y: py, count: 2 };
    }

    const h = Math.sqrt(hSq);
    const perpX = -uy;
    const perpY = ux;
    const x1 = px + perpX * h;
    const y1 = py + perpY * h;
    const x2 = px - perpX * h;
    const y2 = py - perpY * h;

    const last = mentalModelState.lastRobotEstimate;
    if (last && Number.isFinite(last.x) && Number.isFinite(last.y)) {
      const d1 = Math.hypot(x1 - last.x, y1 - last.y);
      const d2 = Math.hypot(x2 - last.x, y2 - last.y);
      return d1 <= d2 ? { x: x1, y: y1, count: 2 } : { x: x2, y: y2, count: 2 };
    }

    const centerScore1 = Math.hypot(x1, y1);
    const centerScore2 = Math.hypot(x2, y2);
    return centerScore1 <= centerScore2
      ? { x: x1, y: y1, count: 2 }
      : { x: x2, y: y2, count: 2 };
  }

  const base = samples[0];
  let sumA11 = 0;
  let sumA12 = 0;
  let sumA22 = 0;
  let sumB1 = 0;
  let sumB2 = 0;

  for (let i = 1; i < samples.length; i += 1) {
    const sample = samples[i];
    const dx = sample.x - base.x;
    const dy = sample.y - base.y;
    const bi =
      sample.d * sample.d -
      base.d * base.d -
      sample.x * sample.x +
      base.x * base.x -
      sample.y * sample.y +
      base.y * base.y;

    const a1 = 2 * dx;
    const a2 = 2 * dy;

    sumA11 += a1 * a1;
    sumA12 += a1 * a2;
    sumA22 += a2 * a2;
    sumB1 += a1 * bi;
    sumB2 += a2 * bi;
  }

  const det = sumA11 * sumA22 - sumA12 * sumA12;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-6) {
    return null;
  }

  const x = (sumB1 * sumA22 - sumB2 * sumA12) / det;
  const y = (sumA11 * sumB2 - sumA12 * sumB1) / det;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y, count: samples.length };
}

function computeRobotEstimateFromFusedPose() {
  const fused = detectionState.fusedPose;
  if (!fused) {
    return null;
  }
  if (!Array.isArray(fused.translation) || fused.translation.length < 3) {
    return null;
  }
  const rotation = fused.rotation;
  if (
    !Array.isArray(rotation) ||
    rotation.length !== 3 ||
    !rotation.every((row) => Array.isArray(row) && row.length === 3)
  ) {
    return null;
  }

  const cameraConfig = robotCameraState.config;
  if (!cameraConfig) {
    return null;
  }

  const [cx, cy, cz] = fused.translation;
  if (![cx, cy, cz].every(Number.isFinite)) {
    return null;
  }

  tempMat4A.set(
    rotation[0][0],
    rotation[0][1],
    rotation[0][2],
    0,
    rotation[1][0],
    rotation[1][1],
    rotation[1][2],
    0,
    rotation[2][0],
    rotation[2][1],
    rotation[2][2],
    0,
    0,
    0,
    0,
    1
  );

  tempMat4B.copy(mapToSimRot).multiply(tempMat4A);
  tempQuat.setFromRotationMatrix(tempMat4B);
  tempVec3A.set(cx, cy, cz).applyMatrix4(mapToSimRot);
  tempMat4A.compose(tempVec3A, tempQuat, tempVec3B);

  tempObj3dA.position.set(
    cameraConfig.position?.[0] ?? 0,
    cameraConfig.position?.[1] ?? 0,
    cameraConfig.position?.[2] ?? 0
  );
  tempObj3dA.rotation.set(0, 0, 0);
  applyRotations(tempObj3dA, cameraConfig.rotations);
  tempObj3dA.updateMatrix();

  tempMat4B.copy(tempObj3dA.matrix).invert();
  tempMat4A.multiply(tempMat4B);
  tempVec3A.setFromMatrixPosition(tempMat4A);

  if (!Number.isFinite(tempVec3A.x) || !Number.isFinite(tempVec3A.y)) {
    return null;
  }

  return {
    x: tempVec3A.x,
    y: tempVec3A.y,
    count: detectionState.detections.length,
  };
}

function updateMentalModel() {
  const { ctx, width, height, fieldWidthMeters, fieldHeightMeters, padding } = mentalModelState;
  if (!ctx || !width || !height || !fieldWidthMeters || !fieldHeightMeters) {
    return;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0b1118";
  ctx.fillRect(0, 0, width, height);

  const scale = Math.min(
    (width - padding * 2) / fieldWidthMeters,
    (height - padding * 2) / fieldHeightMeters
  );
  const centerX = width / 2;
  const centerY = height / 2;
  const halfWidth = (fieldWidthMeters / 2) * scale;
  const halfHeight = (fieldHeightMeters / 2) * scale;

  ctx.strokeStyle = "rgba(148, 163, 184, 0.55)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(centerX - halfWidth, centerY - halfHeight, halfWidth * 2, halfHeight * 2);

  const ageMs = Date.now() - detectionState.lastUpdated;
  const hasFreshDetections =
    detectionState.detectionStatus === "success" &&
    detectionState.detections.length > 0 &&
    ageMs < 1000;

  if (!hasFreshDetections) {
    ctx.font =
      "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";
    ctx.fillStyle = "rgba(148, 163, 184, 0.8)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No current tags", centerX, centerY);
    mentalModelState.robotEstimate = null;
    return;
  }

  mentalModelState.robotEstimate = computeRobotEstimateFromDetections();
  if (mentalModelState.robotEstimate) {
    let avgX = null;
    let avgCount = 0;
    detectionState.detections.forEach((det) => {
      if (!Number.isFinite(det.id)) {
        return;
      }
      const position = mentalModelState.tagPositions.get(det.id);
      if (!position || !Number.isFinite(position.x)) {
        return;
      }
      avgX = (avgX ?? 0) + position.x;
      avgCount += 1;
    });
    if (avgCount > 0) {
      avgX /= avgCount;
      mentalModelState.robotEstimate.x = 2 * avgX - mentalModelState.robotEstimate.x;
    }
    mentalModelState.lastRobotEstimate = mentalModelState.robotEstimate;
  }

  const uniqueIds = new Set();
  detectionState.detections.forEach((det) => {
    if (Number.isFinite(det.id)) {
      uniqueIds.add(det.id);
    }
  });

  ctx.font =
    "10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  uniqueIds.forEach((id) => {
    const position = mentalModelState.tagPositions.get(id);
    if (!position) {
      return;
    }
    const x = centerX + position.x * scale;
    const y = centerY - position.y * scale;

    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(56, 189, 248, 0.95)";
    ctx.fill();

    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    ctx.fillRect(x + 4, y - 9, 18, 12);
    ctx.fillStyle = "rgba(248, 250, 252, 0.9)";
    ctx.fillText(String(id), x + 7, y - 3);
  });

  if (mentalModelState.robotEstimate) {
    const { x, y, count } = mentalModelState.robotEstimate;
    const rx = centerX + x * scale;
    const ry = centerY - y * scale;
    ctx.beginPath();
    ctx.arc(rx, ry, 6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(248, 113, 113, 0.95)";
    ctx.fill();
    ctx.strokeStyle = "rgba(15, 23, 42, 0.85)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    ctx.fillRect(rx + 6, ry - 11, 44, 14);
    ctx.fillStyle = "rgba(248, 250, 252, 0.9)";
    ctx.fillText(`R:${count}`, rx + 9, ry - 4);
  }
}

function updateVisionStream() {
  if (!visionState.enabled) {
    return;
  }
  const width = visionState.width;
  const height = visionState.height;
  ensureVisionTarget(width, height);

  const prevAspect = povCamera.aspect;
  povCamera.aspect = width / height;
  povCamera.updateProjectionMatrix();

  renderer.setRenderTarget(visionState.target);
  renderer.render(scene, povCamera);
  renderer.readRenderTargetPixels(visionState.target, 0, 0, width, height, visionState.buffer);
  renderer.setRenderTarget(null);

  povCamera.aspect = prevAspect;
  povCamera.updateProjectionMatrix();

  const imageData = visionState.imageData;
  const rowBytes = width * 4;
  for (let y = 0; y < height; y += 1) {
    const srcStart = (height - 1 - y) * rowBytes;
    const dstStart = y * rowBytes;
    imageData.data.set(
      visionState.buffer.subarray(srcStart, srcStart + rowBytes),
      dstStart
    );
  }
  visionState.ctx.putImageData(imageData, 0, 0);
  drawDetectionOutlines(visionState.ctx, width, height);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function chooseCaptureDirectory() {
  if (!("showDirectoryPicker" in window)) {
    console.warn("Directory picker not supported in this browser.");
    return;
  }
  try {
    captureState.directoryHandle = await window.showDirectoryPicker({
      id: "apriltag-capture",
      mode: "readwrite",
    });
    updateHud();
  } catch (error) {
    console.warn("Directory selection canceled or failed.", error);
  }
}

async function saveCaptureBlob(blob, filename) {
  if (!captureState.directoryHandle) {
    return false;
  }
  try {
    const fileHandle = await captureState.directoryHandle.getFileHandle(filename, {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch (error) {
    console.warn("Failed to write capture file.", error);
    return false;
  }
}

async function captureFrame() {
  if (captureState.inProgress) {
    return;
  }
  captureState.inProgress = true;
  try {
    const blob = await renderCaptureBlob();
    if (!blob) {
      return;
    }
    const filename = `apriltag_frame_${String(captureState.index).padStart(3, "0")}.png`;
    captureState.index += 1;
    const saved = await saveCaptureBlob(blob, filename);
    if (!saved) {
      downloadBlob(blob, filename);
    }
    captureState.lastSaved = filename;
  } finally {
    captureState.inProgress = false;
    updateHud();
  }
}

function toggleAutoCapture() {
  if (detectionState.autoCaptureEnabled) {
    // Disable auto capture
    detectionState.autoCaptureEnabled = false;
    stopWebsocketSendLoop();
    console.log("Auto capture disabled");
  } else {
    // Enable auto capture
    detectionState.autoCaptureEnabled = true;
    startWebsocketSendLoop();
    console.log("Auto capture enabled");
  }
  updateHud();
}

function initPhysicsWorld(widthMeters, heightMeters) {
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, 0, -9.82),
  });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;

  const contactMaterial = new CANNON.ContactMaterial(
    physicsMaterials.robot,
    physicsMaterials.ground,
    {
      friction: 0.15,
      restitution: 0.0,
    }
  );
  world.addContactMaterial(contactMaterial);

  const groundBody = new CANNON.Body({
    mass: 0,
    material: physicsMaterials.ground,
  });
  groundBody.addShape(new CANNON.Plane());
  world.addBody(groundBody);

  const wallThickness = Math.max(0.1, Math.min(widthMeters, heightMeters) * 0.02);
  const wallHeight = Math.max(1, Math.min(widthMeters, heightMeters) * 0.2);
  const halfWidth = widthMeters / 2;
  const halfHeight = heightMeters / 2;
  const halfThickness = wallThickness / 2;
  const halfWallHeight = wallHeight / 2;

  const northSouthShape = new CANNON.Box(
    new CANNON.Vec3(halfWidth + wallThickness, halfThickness, halfWallHeight)
  );
  const eastWestShape = new CANNON.Box(
    new CANNON.Vec3(halfThickness, halfHeight + wallThickness, halfWallHeight)
  );

  const northWall = new CANNON.Body({ mass: 0, material: physicsMaterials.ground });
  northWall.addShape(northSouthShape);
  northWall.position.set(0, halfHeight + halfThickness, halfWallHeight);
  world.addBody(northWall);

  const southWall = new CANNON.Body({ mass: 0, material: physicsMaterials.ground });
  southWall.addShape(northSouthShape);
  southWall.position.set(0, -halfHeight - halfThickness, halfWallHeight);
  world.addBody(southWall);

  const eastWall = new CANNON.Body({ mass: 0, material: physicsMaterials.ground });
  eastWall.addShape(eastWestShape);
  eastWall.position.set(halfWidth + halfThickness, 0, halfWallHeight);
  world.addBody(eastWall);

  const westWall = new CANNON.Body({ mass: 0, material: physicsMaterials.ground });
  westWall.addShape(eastWestShape);
  westWall.position.set(-halfWidth - halfThickness, 0, halfWallHeight);
  world.addBody(westWall);

  physicsState.world = world;
  physicsState.groundBody = groundBody;
  physicsState.wallBodies = [northWall, southWall, eastWall, westWall];
  physicsState.bounds = {
    widthMeters,
    heightMeters,
    wallThickness,
    wallHeight,
  };
}

function updatePhysicsFieldHeight(groundHeight) {
  if (!physicsState.groundBody || !physicsState.bounds) {
    return;
  }

  const { widthMeters, heightMeters, wallThickness, wallHeight } = physicsState.bounds;
  const halfWidth = widthMeters / 2;
  const halfHeight = heightMeters / 2;
  const halfThickness = wallThickness / 2;
  const halfWallHeight = wallHeight / 2;

  physicsState.groundBody.position.set(0, 0, groundHeight);

  const [northWall, southWall, eastWall, westWall] = physicsState.wallBodies;
  if (northWall) {
    northWall.position.set(0, halfHeight + halfThickness, groundHeight + halfWallHeight);
  }
  if (southWall) {
    southWall.position.set(0, -halfHeight - halfThickness, groundHeight + halfWallHeight);
  }
  if (eastWall) {
    eastWall.position.set(halfWidth + halfThickness, 0, groundHeight + halfWallHeight);
  }
  if (westWall) {
    westWall.position.set(-halfWidth - halfThickness, 0, groundHeight + halfWallHeight);
  }

  physicsState.groundHeight = groundHeight;

  if (physicsState.robotBody) {
    const minRobotZ = groundHeight + robotMotion.halfSize;
    if (physicsState.robotBody.position.z < minRobotZ) {
      physicsState.robotBody.position.z = minRobotZ;
      physicsState.robotBody.velocity.z = 0;
    }
  }
}

function createRobotBody(radius, startPosition) {
  if (!physicsState.world) {
    return;
  }

  const groundHeight = physicsState.groundHeight || 0;
  const body = new CANNON.Body({
    mass: 45,
    material: physicsMaterials.robot,
  });
  body.addShape(new CANNON.Sphere(radius));
  body.position.set(
    startPosition.x,
    startPosition.y,
    Math.max(radius + groundHeight, startPosition.z)
  );
  body.linearDamping = 0.02;
  body.angularDamping = 0.9;
  body.fixedRotation = true;
  body.updateMassProperties();

  physicsState.world.addBody(body);
  physicsState.robotBody = body;
  physicsState.isReady = true;
}

function stepPhysics(deltaSeconds) {
  if (!physicsState.world || !physicsState.robotBody || !robot) {
    return;
  }

  physicsState.world.step(
    physicsState.fixedTimeStep,
    deltaSeconds,
    physicsState.maxSubSteps
  );

  robot.position.set(
    physicsState.robotBody.position.x,
    physicsState.robotBody.position.y,
    physicsState.robotBody.position.z
  );
}

function updateRobot(deltaSeconds) {
  if (!robot || !physicsState.robotBody) {
    return;
  }

  if (autoDriveState.enabled) {
    robot.rotation.z = autoDriveState.heading;
    const heading =
      robot.rotation.z +
      robotHeadingOffset +
      THREE.MathUtils.degToRad(robotOffsetState.yawDeg) +
      Math.PI; // Add 180 degree offset to fix direction
    const dirX = Math.sin(heading);
    const dirY = -Math.cos(heading);
    const driveSpeed = robotMotion.speed * driveSpeedScale;
    physicsState.robotBody.wakeUp();
    physicsState.robotBody.velocity.x = dirX * driveSpeed;
    physicsState.robotBody.velocity.y = dirY * driveSpeed;
    return;
  }

  // Handle rotation (Z axis, up)
  if (keyState.KeyA) {
    robot.rotation.z += robotMotion.rotationSpeed * deltaSeconds;
  }
  if (keyState.KeyD) {
    robot.rotation.z -= robotMotion.rotationSpeed * deltaSeconds;
  }

  // Handle movement (forward/backward)
  let moveDir = 0;
  if (keyState.KeyW) {
    moveDir = -1; // backward (swap to fix direction)
  }
  if (keyState.KeyS) {
    moveDir = 1; // forward (swap to fix direction)
  }

  if (moveDir !== 0) {
    // Move in the direction robot is facing (Z axis rotation)
    const heading =
      robot.rotation.z +
      robotHeadingOffset +
      THREE.MathUtils.degToRad(robotOffsetState.yawDeg) +
      Math.PI; // Add 180 degree offset to fix direction
    const dirX = Math.sin(heading);
    const dirY = -Math.cos(heading);
    const driveSpeed = robotMotion.speed * driveSpeedScale;
    physicsState.robotBody.wakeUp();
    physicsState.robotBody.velocity.x = dirX * moveDir * driveSpeed;
    physicsState.robotBody.velocity.y = dirY * moveDir * driveSpeed;
  } else {
    physicsState.robotBody.velocity.x = 0;
    physicsState.robotBody.velocity.y = 0;
  }
}

function setupCameraControls() {
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  const releasePointer = (event) => {
    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId);
    }
  };

  renderer.domElement.addEventListener("pointerdown", (event) => {
    isDragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
  });

  renderer.domElement.addEventListener("pointermove", (event) => {
    if (!isDragging) {
      return;
    }

    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    povLookState.yaw -= dx * 0.005;
    povLookState.pitch = THREE.MathUtils.clamp(
      povLookState.pitch + dy * 0.005,
      povLookState.minPitch,
      povLookState.maxPitch
    );
  });

  renderer.domElement.addEventListener("pointerup", (event) => {
    if (!isDragging) {
      return;
    }
    isDragging = false;
    releasePointer(event);
  });

  renderer.domElement.addEventListener("pointerleave", (event) => {
    if (!isDragging) {
      return;
    }
    isDragging = false;
    releasePointer(event);
  });

  renderer.domElement.addEventListener("pointercancel", (event) => {
    if (!isDragging) {
      return;
    }
    isDragging = false;
    releasePointer(event);
  });

  renderer.domElement.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      povCamera.fov = THREE.MathUtils.clamp(povCamera.fov + event.deltaY * 0.03, 35, 110);
      povCamera.updateProjectionMatrix();
    },
    { passive: false }
  );
}

function setupKeyboardControls() {
  window.addEventListener("keydown", (event) => {
    if (event.repeat) {
      return;
    }
    if (event.code === "KeyH") {
      showField = !showField;
      if (fieldModel) {
        fieldModel.visible = showField;
      }
      showDebugAxes = !showField;
      // Toggle all axis helpers visibility
      allAxisHelpers.forEach(helper => {
        helper.visible = showDebugAxes;
      });
      event.preventDefault();
      return;
    }
    if (event.code === "KeyM") {
      toggleAutoDrive();
      event.preventDefault();
      return;
    }
    if (event.code === "KeyO") {
      chooseCaptureDirectory();
      event.preventDefault();
      return;
    }
    if (event.code === "KeyP") {
      sendPovFrame();
      event.preventDefault();
      return;
    }
    if (event.code === "KeyC") {
      resetPovLook();
      event.preventDefault();
      return;
    }
    if (event.code === "KeyK") {
      // Toggle auto capture on 'K' key
      toggleAutoCapture();
      event.preventDefault();
      return;
    }
    if (!(event.code in keyState)) {
      return;
    }
    keyState[event.code] = true;
    event.preventDefault();
  });

  window.addEventListener("keyup", (event) => {
    if (!(event.code in keyState)) {
      return;
    }
    keyState[event.code] = false;
    event.preventDefault();
  });
}

async function loadConfig() {
  const response = await fetch(FIELD_CONFIG_URL);
  if (!response.ok) {
    throw new Error(`Failed to load config: ${response.status}`);
  }
  return response.json();
}

async function loadRobotConfig() {
  const response = await fetch(ROBOT_CONFIG_URL);
  if (!response.ok) {
    console.warn(`Failed to load robot config: ${response.status}`);
    return { rotations: [] };
  }
  return response.json();
}

function loadModel() {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(FIELD_MODEL_URL, resolve, undefined, reject);
  });
}

function loadRobotModel() {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(ROBOT_MODEL_URL, resolve, undefined, reject);
  });
}

function logModelStats(model, name) {
  let vertexCount = 0;
  let meshCount = 0;
  let materialCount = 0;
  const materials = new Set();

  model.traverse((child) => {
    if (child.isMesh) {
      meshCount++;
      if (child.geometry) {
        if (child.geometry.attributes.position) {
          vertexCount += child.geometry.attributes.position.count;
        }
      }
      if (child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((mat) => materials.add(mat));
      }
    }
  });

  materialCount = materials.size;

  console.log(`${name} loaded: ${meshCount} meshes, ${vertexCount} vertices, ${materialCount} materials`);
}

function frameCamera(widthMeters, heightMeters) {
  const maxDim = Math.max(widthMeters, heightMeters);
  mainCamera.position.set(0, maxDim * 0.85, maxDim * 1.1);
  mainCamera.lookAt(0, 0, 0);
  mainCamera.far = maxDim * 6;
  mainCamera.updateProjectionMatrix();
}

async function init() {
  const config = await loadConfig();
  const robotConfig = await loadRobotConfig();
  const widthMeters = inchesToMeters(config.widthInches);
  const heightMeters = inchesToMeters(config.heightInches);
  const maxDim = Math.max(widthMeters, heightMeters);
  const robotSize = inchesToMeters(24);
  mentalModelState.fieldWidthMeters = widthMeters;
  mentalModelState.fieldHeightMeters = heightMeters;
  updateMentalModelSize();

  frameCamera(widthMeters, heightMeters);
  robotMotion.speed = Math.max(1.2, maxDim * 0.14);
  robotMotion.height = robotSize / 2;
  robotMotion.halfSize = robotSize / 2;
  fieldBounds.set(
    Math.max(0.5, widthMeters / 2 - robotMotion.halfSize),
    Math.max(0.5, heightMeters / 2 - robotMotion.halfSize)
  );
  const shadowExtent = Math.max(widthMeters, heightMeters) * 0.7;
  directionalLight.shadow.camera.left = -shadowExtent;
  directionalLight.shadow.camera.right = shadowExtent;
  directionalLight.shadow.camera.top = shadowExtent;
  directionalLight.shadow.camera.bottom = -shadowExtent;
  directionalLight.shadow.camera.updateProjectionMatrix();

  initPhysicsWorld(widthMeters, heightMeters);

  robot = new THREE.Group();
  robot.rotation.set(0, 0, 0);
  configGroup.add(robot);

  try {
    const robotGltf = await loadRobotModel();
    robotVisual = robotGltf.scene;
    logModelStats(robotVisual, "Robot");
    robotVisual.position.set(0, 0, -2);
    robotVisual.rotation.set(0, 0, 0);
  } catch (error) {
    console.warn("Robot model not found, using procedural robot:", error);
    robotVisual = createRobot(robotSize);
    robotVisual.rotation.set(0, 0, 0);
  }
  applyRotations(robotVisual, robotConfig.rotations);
  robotVisualBaseRotation = robotVisual.rotation.clone();
  robot.add(robotVisual);
  updateRobotHeadingOffset();
  applyRobotGroundOffset(robotVisual, robotMotion.halfSize, robot);
  configureRobotCamera(robotConfig);
  applyRobotVisualOffset();

  robot.position.set(0, 0, robotMotion.halfSize);
  autoDriveState.heading = robot.rotation.z;
  createRobotBody(robotMotion.halfSize, robot.position);
  if (physicsState.robotBody) {
    robot.position.set(
      physicsState.robotBody.position.x,
      physicsState.robotBody.position.y,
      physicsState.robotBody.position.z
    );
  }

  const gltf = await loadModel();
  const model = gltf.scene;
  logModelStats(model, "Field");
  applyRotations(model, config.rotations);
  tuneFieldMaterials(model);
  configGroup.add(model);
  fieldModel = model;
  model.visible = showField;

  configGroup.updateWorldMatrix(true, true);
  model.updateWorldMatrix(true, true);
  const fieldBox = new THREE.Box3().setFromObject(model);
  const toLocal = new THREE.Matrix4().copy(configGroup.matrixWorld).invert();
  fieldBox.applyMatrix4(toLocal);
  if (Number.isFinite(fieldBox.min.z)) {
    updatePhysicsFieldHeight(fieldBox.min.z);
  }

  const tagGroup = addAprilTags(config);

  // Add axis helpers only to robot and AprilTags
  allAxisHelpers = [];
  if (robot) {
    const axisHelper = new THREE.AxesHelper(0.5);
    axisHelper.position.y += 0.1;
    axisHelper.visible = false;
    robot.add(axisHelper);
    allAxisHelpers.push(axisHelper);
  }
  tagGroup.traverse((obj) => {
    if (obj.isMesh) {
      const axisHelper = new THREE.AxesHelper(0.5);
      axisHelper.position.y += 0.1;
      axisHelper.visible = false;
      obj.add(axisHelper);
      allAxisHelpers.push(axisHelper);
    }
  });

  // Log total scene stats
  let totalMeshes = 0;
  let totalVertices = 0;
  scene.traverse((child) => {
    if (child.isMesh) {
      totalMeshes++;
      if (child.geometry && child.geometry.attributes.position) {
        totalVertices += child.geometry.attributes.position.count;
      }
    }
  });
  console.log(`Scene total: ${totalMeshes} meshes, ${totalVertices} vertices`);

  connectWebsocket();
}

function onResize() {
  mainCamera.aspect = window.innerWidth / window.innerHeight;
  mainCamera.updateProjectionMatrix();
  povCamera.aspect = window.innerWidth / window.innerHeight;
  povCamera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateMentalModelSize();
  updateLocalizationConstants();
}

window.addEventListener("resize", onResize);

setupCameraControls();
setupKeyboardControls();

createSettingSlider("WS interval", 30, 500, 10, detectionState.autoCaptureIntervalMs, "ms", (value) => {
  detectionState.autoCaptureIntervalMs = value;
  if (detectionState.autoCaptureEnabled && websocketState.connected) {
    startWebsocketSendLoop();
  }
});

createOffsetSlider("Camera yaw", -180, 180, 1, 90, (value) => {
  offsetState.yawDeg = value;
});
createOffsetSlider("Pitch offset", -90, 90, 1, 90, (value) => {
  offsetState.pitchDeg = value;
});
createOffsetSlider("Roll offset", -180, 180, 1, 0, (value) => {
  offsetState.rollDeg = value;
});
createOffsetSlider("Robot yaw", -180, 180, 1, 90, (value) => {
  robotOffsetState.yawDeg = value;
  applyRobotVisualOffset();
});
createOffsetSlider("Robot roll", -180, 180, 1, 0, (value) => {
  robotOffsetState.rollDeg = value;
  applyRobotVisualOffset();
});
updateOffsetLockUi();

init().catch((error) => {
  console.error("Failed to initialize scene:", error);
});

function animate() {
  requestAnimationFrame(animate);
  const deltaSeconds = clock.getDelta();
  const elapsedSeconds = clock.elapsedTime;

  // FPS calculation
  frameCount++;
  if (elapsedSeconds - lastTime >= 1) {
    console.log(`FPS: ${frameCount}`);
    frameCount = 0;
    lastTime = elapsedSeconds;
  }

  updateRobot(deltaSeconds);
  stepPhysics(deltaSeconds);
  updateRobotCamera();
  robotShaderMaterials.forEach((material) => {
    material.uniforms.uTime.value = elapsedSeconds;
    material.uniforms.uLightDir.value
      .copy(directionalLight.position)
      .normalize();
  });
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.render(scene, mainCamera);
  updateVisionStream();
  updateMentalModel();
  updateHud();
}

animate();
