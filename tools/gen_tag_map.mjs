import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const FIELD_CONFIG_PATH = resolve("field/config.json");
const OUTPUT_PATH = resolve("rufiggaapriltags/tag_map_field.json");

const TAG_OVERRIDES = {
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
  28: { rotationX: 180, rotationZ: 0, rotationY: 0 },
};

const degToRad = (deg) => (deg * Math.PI) / 180;

const identity = () => [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const matMul = (a, b) => [
  [
    a[0][0] * b[0][0] + a[0][1] * b[1][0] + a[0][2] * b[2][0],
    a[0][0] * b[0][1] + a[0][1] * b[1][1] + a[0][2] * b[2][1],
    a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2] * b[2][2],
  ],
  [
    a[1][0] * b[0][0] + a[1][1] * b[1][0] + a[1][2] * b[2][0],
    a[1][0] * b[0][1] + a[1][1] * b[1][1] + a[1][2] * b[2][1],
    a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2] * b[2][2],
  ],
  [
    a[2][0] * b[0][0] + a[2][1] * b[1][0] + a[2][2] * b[2][0],
    a[2][0] * b[0][1] + a[2][1] * b[1][1] + a[2][2] * b[2][1],
    a[2][0] * b[0][2] + a[2][1] * b[1][2] + a[2][2] * b[2][2],
  ],
];

const matVec = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

const rotX = (rad) => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ];
};

const rotY = (rad) => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
};

const rotZ = (rad) => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
};

const roundValue = (value) => Number(value.toFixed(6));
const roundVec = (vec) => vec.map(roundValue);
const roundMat = (mat) => mat.map((row) => row.map(roundValue));

function getTagSpin(rotations) {
  if (!Array.isArray(rotations)) {
    return 0;
  }
  return rotations.reduce((acc, rotation) => {
    if (rotation.axis === "z") {
      return acc + degToRad(rotation.degrees);
    }
    return acc;
  }, 0);
}

function getTagOverride(tagId) {
  if (TAG_OVERRIDES[tagId]) {
    return TAG_OVERRIDES[tagId];
  }
  for (const key of Object.keys(TAG_OVERRIDES)) {
    if (key.includes("-")) {
      const [start, end] = key.split("-").map(Number);
      if (!Number.isNaN(start) && !Number.isNaN(end) && tagId >= start && tagId <= end) {
        return TAG_OVERRIDES[key];
      }
    }
  }
  return {};
}

function buildTagRotation(tag) {
  let rotation = identity();
  rotation = matMul(rotation, rotX(-Math.PI / 2));
  rotation = matMul(rotation, rotY(-Math.PI / 2));

  if (Array.isArray(tag.rotations)) {
    for (const rot of tag.rotations) {
      const angle = degToRad(rot.degrees);
      if (rot.axis === "x") {
        rotation = matMul(rotation, rotX(angle));
      } else if (rot.axis === "y") {
        rotation = matMul(rotation, rotY(angle));
      } else if (rot.axis === "z") {
        rotation = matMul(rotation, rotZ(angle));
      }
    }
  }

  const override = getTagOverride(tag.id);
  const configSpin = getTagSpin(tag.rotations);
  const overrideSpin =
    typeof override.rotationDeg === "number"
      ? degToRad(override.rotationDeg) - configSpin
      : degToRad(override.rotationOffsetDeg || 0);
  if (overrideSpin !== 0) {
    rotation = matMul(rotation, rotZ(overrideSpin));
  }
  if (typeof override.rotationX === "number") {
    rotation = matMul(rotation, rotX(degToRad(override.rotationX)));
  }
  if (typeof override.rotationY === "number") {
    rotation = matMul(rotation, rotY(degToRad(override.rotationY)));
  }
  if (typeof override.rotationZ === "number") {
    rotation = matMul(rotation, rotZ(degToRad(override.rotationZ)));
  }

  return rotation;
}

function main() {
  const config = JSON.parse(readFileSync(FIELD_CONFIG_PATH, "utf8"));
  if (!Array.isArray(config.aprilTags)) {
    throw new Error("Field config is missing aprilTags.");
  }

  const configRotation = rotX(-Math.PI / 2);
  const output = {};

  for (const tag of config.aprilTags) {
    const override = getTagOverride(tag.id);
    const position = (override.position || tag.position).slice();
    position[2] += 0.01;

    const rotation = buildTagRotation(tag);
    const worldRotation = matMul(configRotation, rotation);
    const worldTranslation = matVec(configRotation, position);

    output[String(tag.id)] = {
      translation: roundVec(worldTranslation),
      rotation: roundMat(worldRotation),
    };
  }

  writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${Object.keys(output).length} tags to ${OUTPUT_PATH}`);
}

main();
