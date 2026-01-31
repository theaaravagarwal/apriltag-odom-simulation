import json
import os

import numpy as np


def load_tag_map(path):
    """
    Load a JSON tag map describing each tag pose in a shared coordinate frame.
    Returns {tag_id: {"translation": np.ndarray(3), "rotation": np.ndarray((3,3))}}.
    """
    with open(path, "r", encoding="utf-8") as fp:
        data = json.load(fp)

    if isinstance(data, dict):
        entries = list(data.items())
    elif isinstance(data, list):
        entries = []
        for item in data:
            if not isinstance(item, dict):
                raise ValueError("Each tag map entry must be a dict")
            tag_id = item.get("id")
            if tag_id is None:
                raise ValueError("Each tag map entry must include an 'id'")
            entries.append((tag_id, item))
    else:
        raise ValueError("Tag map must be a dict or a list of entries")

    tag_map = {}
    for tag_id, entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Tag map entry must be a dict")
        translation = _ensure_vector3(entry.get("translation"), "translation")
        rotation = _ensure_rotation_matrix(entry.get("rotation"))
        tag_map[int(tag_id)] = {"translation": translation, "rotation": rotation}

    if not tag_map:
        raise ValueError("Tag map did not contain any tag poses")
    return tag_map


def load_tag_overrides(path):
    if not path:
        return {}
    if not os.path.isabs(path):
        path = os.path.join(os.path.dirname(__file__), path)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as fp:
            data = json.load(fp)
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    return _expand_tag_overrides(data)


def build_tag_map_from_field_config(field_config, tag_overrides=None):
    if not field_config or not isinstance(field_config.get("aprilTags"), list):
        raise ValueError("Field config missing aprilTags list")

    overrides = _expand_tag_overrides(tag_overrides or {})
    config_group_rot = _rotation_matrix_from_axis("x", -np.pi / 2.0)
    tag_map = {}

    for tag in field_config["aprilTags"]:
        if not isinstance(tag, dict):
            continue
        tag_id = tag.get("id")
        if tag_id is None:
            continue
        tag_id = int(tag_id)
        override = overrides.get(tag_id, {})

        position = np.asarray(override.get("position", tag.get("position", [0, 0, 0])), dtype=np.float64)
        if position.shape[0] != 3:
            continue
        position = position.copy()
        position[2] += 0.01  # match sim visual offset

        rotations = tag.get("rotations") if isinstance(tag.get("rotations"), list) else []
        config_spin = _get_tag_spin_deg(rotations)

        rot = np.eye(3, dtype=np.float64)
        rot = rot @ _rotation_matrix_from_axis("x", -np.pi / 2.0)
        rot = rot @ _rotation_matrix_from_axis("y", -np.pi / 2.0)
        rot = rot @ _rotation_matrix_from_rotations(rotations)

        override_spin = 0.0
        if "rotationDeg" in override:
            override_spin = float(override["rotationDeg"]) - config_spin
        elif "rotationOffsetDeg" in override:
            override_spin = float(override["rotationOffsetDeg"])
        if override_spin:
            rot = rot @ _rotation_matrix_from_axis("z", np.deg2rad(override_spin))

        for axis_key, axis in (("rotationX", "x"), ("rotationY", "y"), ("rotationZ", "z")):
            if axis_key in override:
                rot = rot @ _rotation_matrix_from_axis(axis, np.deg2rad(float(override[axis_key])))

        world_rot = config_group_rot @ rot
        world_pos = config_group_rot @ position
        tag_map[tag_id] = {"translation": world_pos, "rotation": world_rot}

    if not tag_map:
        raise ValueError("Field config did not yield any tag poses")
    return tag_map


def _ensure_vector3(value, name):
    if value is None:
        raise ValueError(f"Tag map entry missing '{name}'")
    arr = np.asarray(value, dtype=np.float64).ravel()
    if arr.shape[0] != 3:
        raise ValueError(f"'{name}' must have 3 elements")
    return arr


def _ensure_rotation_matrix(value):
    if value is None:
        raise ValueError("Tag map entry missing 'rotation'")
    arr = np.asarray(value, dtype=np.float64)
    if arr.ndim == 1 and arr.size == 9:
        arr = arr.reshape((3, 3))
    if arr.shape != (3, 3):
        raise ValueError("'rotation' must be a 3x3 matrix")
    return arr


def compute_camera_pose_from_map(
    detections,
    tag_map,
    *,
    min_margin=0.0,
    max_hamming=None,
    min_inliers=1,
    robust=True,
    max_translation_dev=None,
    max_rotation_deg=None,
):
    """
    Fuse detections that correspond to known tags to compute the camera pose.
    Returns {'rotation': np.ndarray((3,3)), 'translation': np.ndarray(3)} or None.
    """
    candidates = []
    for det in detections:
        if max_hamming is not None and det.get("hamming") is not None:
            if det["hamming"] > max_hamming:
                continue
        if min_margin and det.get("decision_margin") is not None:
            if det["decision_margin"] < min_margin:
                continue
        pose = det.get("pose")
        if not pose:
            continue
        map_entry = tag_map.get(det["id"])
        if not map_entry:
            continue

        det_rot = np.asarray(pose.get("rotation"), dtype=np.float64)
        det_trans = np.asarray(pose.get("translation"), dtype=np.float64).ravel()
        if det_rot.shape != (3, 3) or det_trans.shape[0] != 3:
            continue

        cam_rot, cam_trans = _camera_pose_from_tag(det_rot, det_trans, map_entry)
        weight = max(det.get("decision_margin", 0.0), 0.0) + 1e-6
        quat = _rotation_matrix_to_quaternion(cam_rot)
        candidates.append(
            {
                "id": int(det["id"]),
                "rotation": cam_rot,
                "translation": cam_trans,
                "quat": quat,
                "weight": weight,
            }
        )

    if not candidates:
        return None

    inliers = candidates
    if robust and len(candidates) > 2:
        inliers = _select_inliers(
            candidates,
            max_translation_dev=max_translation_dev,
            max_rotation_deg=max_rotation_deg,
            min_inliers=min_inliers,
        )
    if len(inliers) < min_inliers:
        return None

    total_weight = sum(cand["weight"] for cand in inliers)
    if total_weight <= 0.0:
        return None

    mean_trans = sum(cand["weight"] * cand["translation"] for cand in inliers) / total_weight
    avg_quat = _average_quaternions(
        [cand["quat"] for cand in inliers],
        [cand["weight"] for cand in inliers],
    )
    mean_rot = _quaternion_to_rotation_matrix(avg_quat)
    return {
        "rotation": mean_rot,
        "translation": mean_trans,
        "inlier_ids": [cand["id"] for cand in inliers],
        "inlier_count": len(inliers),
    }


def _camera_pose_from_tag(det_rot, det_trans, map_entry):
    cam_tag_rot = det_rot.T
    cam_tag_trans = -cam_tag_rot @ det_trans
    cam_map_rot = map_entry["rotation"] @ cam_tag_rot
    cam_map_trans = map_entry["rotation"] @ cam_tag_trans + map_entry["translation"]
    return cam_map_rot, cam_map_trans


def _rotation_matrix_from_axis(axis, radians):
    c = float(np.cos(radians))
    s = float(np.sin(radians))
    if axis == "x":
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=np.float64)
    if axis == "y":
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=np.float64)
    if axis == "z":
        return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=np.float64)
    return np.eye(3, dtype=np.float64)


def _rotation_matrix_from_rotations(rotations):
    rot = np.eye(3, dtype=np.float64)
    if not isinstance(rotations, list):
        return rot
    for entry in rotations:
        if not isinstance(entry, dict):
            continue
        axis = entry.get("axis")
        degrees = entry.get("degrees")
        if axis not in {"x", "y", "z"} or degrees is None:
            continue
        rot = rot @ _rotation_matrix_from_axis(axis, np.deg2rad(float(degrees)))
    return rot


def _get_tag_spin_deg(rotations):
    if not isinstance(rotations, list):
        return 0.0
    total = 0.0
    for entry in rotations:
        if isinstance(entry, dict) and entry.get("axis") == "z":
            total += float(entry.get("degrees", 0.0))
    return total


def _expand_tag_overrides(overrides):
    expanded = {}
    if not isinstance(overrides, dict):
        return expanded
    for key, value in overrides.items():
        if isinstance(key, str) and "-" in key:
            parts = key.split("-", 1)
            try:
                start = int(parts[0])
                end = int(parts[1])
            except Exception:
                continue
            for tag_id in range(min(start, end), max(start, end) + 1):
                expanded[tag_id] = value
            continue
        try:
            tag_id = int(key)
        except Exception:
            continue
        expanded[tag_id] = value
    return expanded


def _angle_between_quats_rad(q1, q2):
    dot = float(np.dot(q1, q2))
    dot = abs(dot)
    dot = float(np.clip(dot, -1.0, 1.0))
    return float(2.0 * np.arccos(dot))


def _mad_threshold(values, scale=3.0):
    arr = np.asarray(values, dtype=np.float64)
    if arr.size == 0:
        return None
    median = float(np.median(arr))
    mad = float(np.median(np.abs(arr - median)))
    return median + scale * mad


def _select_inliers(candidates, *, max_translation_dev=None, max_rotation_deg=None, min_inliers=1):
    if len(candidates) <= 2:
        return candidates

    translations = np.stack([cand["translation"] for cand in candidates], axis=0)
    median_trans = np.median(translations, axis=0)
    trans_residuals = np.linalg.norm(translations - median_trans, axis=1)
    trans_thresh = _mad_threshold(trans_residuals)
    if trans_thresh is None:
        return candidates
    if max_translation_dev is not None:
        trans_thresh = min(trans_thresh, float(max_translation_dev))

    quats = [cand["quat"] for cand in candidates]
    weights = [cand["weight"] for cand in candidates]
    avg_quat = _average_quaternions(quats, weights)
    rot_residuals = np.array([_angle_between_quats_rad(q, avg_quat) for q in quats], dtype=np.float64)
    rot_thresh = _mad_threshold(rot_residuals)
    if rot_thresh is None:
        rot_thresh = float("inf")
    if max_rotation_deg is not None:
        rot_thresh = min(rot_thresh, np.deg2rad(float(max_rotation_deg)))

    inliers = [
        cand
        for cand, trans_err, rot_err in zip(candidates, trans_residuals, rot_residuals)
        if trans_err <= trans_thresh and rot_err <= rot_thresh
    ]
    if len(inliers) < min_inliers:
        return candidates
    return inliers


def _rotation_matrix_to_quaternion(mat):
    trace = mat[0, 0] + mat[1, 1] + mat[2, 2]
    if trace > 0:
        s = 0.5 / np.sqrt(trace + 1.0)
        w = 0.25 / s
        x = (mat[2, 1] - mat[1, 2]) * s
        y = (mat[0, 2] - mat[2, 0]) * s
        z = (mat[1, 0] - mat[0, 1]) * s
    elif mat[0, 0] > mat[1, 1] and mat[0, 0] > mat[2, 2]:
        s = 2.0 * np.sqrt(1.0 + mat[0, 0] - mat[1, 1] - mat[2, 2])
        w = (mat[2, 1] - mat[1, 2]) / s
        x = 0.25 * s
        y = (mat[0, 1] + mat[1, 0]) / s
        z = (mat[0, 2] + mat[2, 0]) / s
    elif mat[1, 1] > mat[2, 2]:
        s = 2.0 * np.sqrt(1.0 + mat[1, 1] - mat[0, 0] - mat[2, 2])
        w = (mat[0, 2] - mat[2, 0]) / s
        x = (mat[0, 1] + mat[1, 0]) / s
        y = 0.25 * s
        z = (mat[1, 2] + mat[2, 1]) / s
    else:
        s = 2.0 * np.sqrt(1.0 + mat[2, 2] - mat[0, 0] - mat[1, 1])
        w = (mat[1, 0] - mat[0, 1]) / s
        x = (mat[0, 2] + mat[2, 0]) / s
        y = (mat[1, 2] + mat[2, 1]) / s
        z = 0.25 * s

    quat = np.array([w, x, y, z], dtype=np.float64)
    if quat[0] < 0:
        quat = -quat
    norm = np.linalg.norm(quat)
    if norm == 0.0:
        return np.array([1.0, 0.0, 0.0, 0.0], dtype=np.float64)
    return quat / norm


def _quaternion_to_rotation_matrix(quat):
    q = np.asarray(quat, dtype=np.float64)
    if q.shape != (4,):
        raise ValueError("Quaternion must have 4 elements")
    norm = np.linalg.norm(q)
    if norm == 0.0:
        raise ValueError("Quaternion must not be zero")
    q /= norm
    w, x, y, z = q
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    wx, wy, wz = w * x, w * y, w * z
    return np.array(
        [
            [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy)],
            [2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx)],
            [2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy)],
        ],
        dtype=np.float64,
    )


def _average_quaternions(quats, weights):
    accum = np.zeros(4, dtype=np.float64)
    for quat, weight in zip(quats, weights):
        q = quat / max(1e-12, np.linalg.norm(quat))
        if q[0] < 0:
            q = -q
        accum += q * weight
    norm = np.linalg.norm(accum)
    if norm == 0.0:
        return quats[0]
    return accum / norm
