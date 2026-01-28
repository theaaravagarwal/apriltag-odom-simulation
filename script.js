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
  "3-4": {rotationY: 180, rotationZ: 180},
  1: {rotationY: 180, rotationZ: 180},
  6: {rotationY: 180, rotationZ: 180},
  "13-16": {rotationY: 180, rotationZ: 180},
  "25-26": {rotationY: 180, rotationZ: 180},
  23: {rotationY: 180, rotationZ: 180},
  5: {rotationX: 270, rotationZ: 270, rotationY: 180},
  8: {rotationX: 270, rotationZ: 270, rotationY: 180},
  2: {rotationX: 270, rotationZ: 90, rotationY: 180},
  11: {rotationX: 270, rotationZ: 90, rotationY: 180},
  21: {rotationX: 270, rotationZ: 90, rotationY: 180},
  24: {rotationX: 270, rotationZ: 90, rotationY: 180},
  18: {rotationX: 270, rotationZ: 270, rotationY: 180},
  27: {rotationX: 270, rotationZ: 270, rotationY: 180},
  28: {rotationX: 180, rotationZ: 0, rotationY: 0}
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

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.05,
  500
);
camera.position.set(10, 8, 10);
camera.lookAt(0, 0, 0);

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
let fieldModel = null;
const robotShaderMaterials = [];

const followState = {
  yaw: Math.PI * 0.25,
  pitch: Math.PI / 6,
  distance: 6,
  minDistance: 2,
  maxDistance: 30,
  minPitch: 0.15,
  maxPitch: Math.PI / 2 - 0.1,
};

const cameraModes = {
  follow: "follow",
  pov: "pov",
};

const cameraState = {
  mode: cameraModes.pov,
};

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

const tempQuat = new THREE.Quaternion();
const povLookState = {
  yaw: 0,
  pitch: 0,
  minPitch: -Math.PI / 3,
  maxPitch: Math.PI / 3,
};
const povYawQuat = new THREE.Quaternion();
const povPitchQuat = new THREE.Quaternion();
const povYawAxis = new THREE.Vector3(0, 0, 1);
const povPitchAxis = new THREE.Vector3(1, 0, 0);

const followTarget = new THREE.Vector3();
const followTargetSmooth = new THREE.Vector3();
const desiredCameraPos = new THREE.Vector3();
const cameraOffset = new THREE.Vector3();
let hasFollowTarget = false;

const moveVector = new THREE.Vector2();
const adjustedMove = new THREE.Vector2();

const robotMotion = {
  speed: 2,
  rotationSpeed: 2, // radians per second
  height: 0,
  halfSize: 0,
};

const driveSpeedScale = 3.0;
let robotHeadingOffset = 0;

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

function updateHud() {
  const viewLabel = cameraState.mode === cameraModes.pov ? "Robot POV" : "Follow";
  const autoLabel = autoDriveState.enabled ? "ON" : "OFF";
  const outputLabel = captureState.directoryHandle ? "dir set" : "dir not set";
  const savedLabel = captureState.lastSaved ? `last=${captureState.lastSaved}` : "ready";
  hud.textContent =
    `View: ${viewLabel}\n` +
    `Auto-drive: ${autoLabel}\n` +
    `Capture: ${outputLabel}, ${savedLabel}\n` +
    "Keys: V=view M=drive O=output P=photo C=center H=field\n" +
    "Move: W/S forward/back A/D turn\n" +
    "Mouse: drag to look (POV) / orbit (follow)";
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

  config.aprilTags.forEach((tag) => {
    const geometry = getTagGeometry(tag.variant, geometryCache);
    const material = createTagMaterial(tag.id);
    const mesh = new THREE.Mesh(geometry, material);
    const override = getTagOverride(tag.id);
    const position = override.position || tag.position;
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
  robotCameraState.rig.position.set(
    cameraConfig.position?.[0] ?? 0,
    cameraConfig.position?.[1] ?? 0,
    cameraConfig.position?.[2] ?? 0
  );
  robotCameraState.rig.rotation.set(0, 0, 0);
  applyRotations(robotCameraState.rig, cameraConfig.rotations);
  if (!robotCameraState.rig.parent && robot) {
    robot.add(robotCameraState.rig);
  }
  robotCameraState.ready = true;

  if (typeof cameraConfig.fov === "number") {
    camera.fov = cameraConfig.fov;
    camera.updateProjectionMatrix();
  }

  if (Array.isArray(cameraConfig.resolution) && cameraConfig.resolution.length === 2) {
    captureState.width = cameraConfig.resolution[0];
    captureState.height = cameraConfig.resolution[1];
  }
}

function updateRobotCamera() {
  if (cameraState.mode !== cameraModes.pov || !robotCameraState.ready) {
    return false;
  }
  robotCameraState.rig.updateWorldMatrix(true, false);
  robotCameraState.rig.getWorldPosition(camera.position);
  robotCameraState.rig.getWorldQuaternion(tempQuat);
  camera.quaternion.copy(tempQuat);
  if (povLookState.yaw !== 0 || povLookState.pitch !== 0) {
    povYawQuat.setFromAxisAngle(povYawAxis, povLookState.yaw);
    povPitchQuat.setFromAxisAngle(povPitchAxis, povLookState.pitch);
    camera.quaternion.multiply(povYawQuat);
    camera.quaternion.multiply(povPitchQuat);
  }
  return true;
}

function setAutoDriveEnabled(enabled) {
  autoDriveState.enabled = enabled;
  if (enabled && robot) {
    autoDriveState.heading = robot.rotation.z;
  }
  updateHud();
}

function toggleCameraMode() {
  cameraState.mode =
    cameraState.mode === cameraModes.pov ? cameraModes.follow : cameraModes.pov;
  updateHud();
}

function resetPovLook() {
  povLookState.yaw = 0;
  povLookState.pitch = 0;
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

  const prevAspect = camera.aspect;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setRenderTarget(captureState.target);
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(captureState.target, 0, 0, width, height, captureState.buffer);
  renderer.setRenderTarget(null);

  camera.aspect = prevAspect;
  camera.updateProjectionMatrix();

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
    const heading = robot.rotation.z + robotHeadingOffset;
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
    moveDir = 1; // forward
  }
  if (keyState.KeyS) {
    moveDir = -1; // backward
  }

  if (moveDir !== 0) {
    // Move in the direction robot is facing (Z axis rotation)
    const heading = robot.rotation.z + robotHeadingOffset;
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

function updateFollowCamera() {
  if (!robot) {
    return;
  }

  robot.getWorldPosition(followTarget);
  if (!hasFollowTarget) {
    followTargetSmooth.copy(followTarget);
    hasFollowTarget = true;
  } else {
    followTargetSmooth.lerp(followTarget, 0.2);
  }

  const polar = Math.PI / 2 - followState.pitch;
  cameraOffset.setFromSphericalCoords(
    followState.distance,
    polar,
    followState.yaw
  );
  desiredCameraPos.copy(followTargetSmooth).add(cameraOffset);
  camera.position.lerp(desiredCameraPos, 0.12);
  camera.lookAt(followTargetSmooth);
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

    if (cameraState.mode === cameraModes.pov) {
      povLookState.yaw -= dx * 0.005;
      povLookState.pitch = THREE.MathUtils.clamp(
        povLookState.pitch + dy * 0.005,
        povLookState.minPitch,
        povLookState.maxPitch
      );
    } else {
      followState.yaw -= dx * 0.005;
      followState.pitch = THREE.MathUtils.clamp(
        followState.pitch + dy * 0.005,
        followState.minPitch,
        followState.maxPitch
      );
    }
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
      if (cameraState.mode === cameraModes.pov) {
        camera.fov = THREE.MathUtils.clamp(camera.fov + event.deltaY * 0.03, 35, 110);
        camera.updateProjectionMatrix();
      } else {
        followState.distance = THREE.MathUtils.clamp(
          followState.distance + event.deltaY * 0.01,
          followState.minDistance,
          followState.maxDistance
        );
      }
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
    if (event.code === "KeyV") {
      toggleCameraMode();
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
      captureFrame();
      event.preventDefault();
      return;
    }
    if (event.code === "KeyC") {
      resetPovLook();
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
  camera.position.set(maxDim * 0.6, maxDim * 0.45, maxDim * 0.6);
  camera.lookAt(0, 0, 0);
  camera.far = maxDim * 6;
  camera.updateProjectionMatrix();
}

async function init() {
  const config = await loadConfig();
  const robotConfig = await loadRobotConfig();
  const widthMeters = inchesToMeters(config.widthInches);
  const heightMeters = inchesToMeters(config.heightInches);
  const maxDim = Math.max(widthMeters, heightMeters);
  const robotSize = inchesToMeters(24);

  frameCamera(widthMeters, heightMeters);
  followState.distance = Math.max(4, maxDim * 0.35);
  followState.minDistance = Math.max(1.5, maxDim * 0.12);
  followState.maxDistance = Math.max(followState.distance * 1.5, maxDim * 1.1);
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
  robot.add(robotVisual);
  updateRobotHeadingOffset();
  applyRobotGroundOffset(robotVisual, robotMotion.halfSize, robot);
  configureRobotCamera(robotConfig);

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
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener("resize", onResize);

setupCameraControls();
setupKeyboardControls();

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
  if (!updateRobotCamera()) {
    updateFollowCamera();
  }
  robotShaderMaterials.forEach((material) => {
    material.uniforms.uTime.value = elapsedSeconds;
    material.uniforms.uLightDir.value
      .copy(directionalLight.position)
      .normalize();
  });
  renderer.render(scene, camera);
  updateHud();
}

animate();
