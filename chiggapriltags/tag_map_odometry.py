import json

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


def compute_camera_pose_from_map(detections, tag_map):
    """
    Fuse detections that correspond to known tags to compute the camera pose.
    Returns {'rotation': np.ndarray((3,3)), 'translation': np.ndarray(3)} or None.
    """
    candidates = []
    for det in detections:
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
        candidates.append((cam_rot, cam_trans, quat, weight))

    if not candidates:
        return None

    total_weight = sum(weight for _, _, _, weight in candidates)
    if total_weight <= 0.0:
        return None

    mean_trans = sum(weight * trans for _, trans, _, weight in candidates) / total_weight
    avg_quat = _average_quaternions(
        [quat for _, _, quat, _ in candidates],
        [weight for _, _, _, weight in candidates],
    )
    mean_rot = _quaternion_to_rotation_matrix(avg_quat)
    return {"rotation": mean_rot, "translation": mean_trans}


def _camera_pose_from_tag(det_rot, det_trans, map_entry):
    cam_tag_rot = det_rot.T
    cam_tag_trans = -cam_tag_rot @ det_trans
    cam_map_rot = map_entry["rotation"] @ cam_tag_rot
    cam_map_trans = map_entry["rotation"] @ cam_tag_trans + map_entry["translation"]
    return cam_map_rot, cam_map_trans


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
