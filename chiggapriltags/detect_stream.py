import argparse
import json
import os
import time

import numpy as np

from tag_map_odometry import (
    build_tag_map_from_field_config,
    compute_camera_pose_from_map,
    load_tag_map,
    load_tag_overrides,
)


def load_grayscale(path):
    try:
        import cv2
    except Exception:
        cv2 = None

    if cv2 is not None:
        img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if img is None:
            raise RuntimeError(f"Failed to read image: {path}")
        return img

    try:
        from PIL import Image
    except Exception as exc:
        raise RuntimeError(
            "No image loader available. Install opencv-python or pillow."
        ) from exc

    return np.array(Image.open(path).convert("L"))


def load_json(path):
    if not path:
        return None
    if not os.path.isabs(path):
        path = os.path.join(os.path.dirname(__file__), path)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as fp:
        return json.load(fp)


def find_latest_image(directory, pattern):
    if not os.path.exists(directory):
        return None
    best_path = None
    best_time = None
    for name in os.listdir(directory):
        if not name.endswith(".png"):
            continue
        if pattern not in name and pattern != "*":
            continue
        path = os.path.join(directory, name)
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            continue
        if best_time is None or mtime > best_time:
            best_time = mtime
            best_path = path
    return best_path


def build_detector(args):
    try:
        from pupil_apriltags import Detector
    except Exception as exc:
        raise RuntimeError(
            "pupil-apriltags is required. Install with: pip install pupil-apriltags"
        ) from exc

    nthreads = args.nthreads
    if nthreads == 0:
        nthreads = max(1, (os.cpu_count() or 1) - 1)

    return Detector(
        families=args.family,
        nthreads=nthreads,
        quad_decimate=args.quad_decimate,
        quad_sigma=args.quad_sigma,
        refine_edges=args.refine_edges,
        decode_sharpening=args.decode_sharpening,
        debug=0,
    )


def parse_tag_size_from_variant(variant, fallback):
    if not variant or not isinstance(variant, str):
        return fallback
    lower = variant.lower()
    if "in" not in lower:
        return fallback
    try:
        size_str = lower.split("-")[-1].replace("in", "")
        size_in = float(size_str)
    except Exception:
        return fallback
    return float(size_in) * 0.0254


def compute_camera_intrinsics(width, height, camera_config, camera_index, fx, fy, cx, cy):
    if fx is not None and fy is not None and cx is not None and cy is not None:
        return fx, fy, cx, cy

    if camera_config and isinstance(camera_config.get("cameras"), list):
        cameras = camera_config["cameras"]
        if cameras and 0 <= camera_index < len(cameras):
            cfg = cameras[camera_index]
            fov = cfg.get("fov")
            if fov is not None:
                fov_rad = np.deg2rad(float(fov))
                focal = (width * 0.5) / np.tan(fov_rad * 0.5)
                fx = fx if fx is not None else focal
                fy = fy if fy is not None else focal
            cx = cx if cx is not None else width / 2.0
            cy = cy if cy is not None else height / 2.0
            return fx, fy, cx, cy

    fx = fx if fx is not None else float(max(width, height))
    fy = fy if fy is not None else fx
    cx = cx if cx is not None else width / 2.0
    cy = cy if cy is not None else height / 2.0
    return fx, fy, cx, cy


def enhance_image(image, clip_limit=2.0, tile_grid=8, unsharp_amount=0.6, unsharp_sigma=1.0):
    try:
        import cv2
    except Exception:
        return image

    clahe = cv2.createCLAHE(clipLimit=float(clip_limit), tileGridSize=(tile_grid, tile_grid))
    enhanced = clahe.apply(image)
    if unsharp_amount <= 0:
        return enhanced
    blurred = cv2.GaussianBlur(enhanced, (0, 0), float(unsharp_sigma))
    sharpened = cv2.addWeighted(enhanced, 1.0 + unsharp_amount, blurred, -unsharp_amount, 0)
    return sharpened


def detection_to_dict(det):
    pose = None
    if det.pose_R is not None and det.pose_t is not None:
        pose = {
            "rotation": det.pose_R.tolist(),
            "translation": det.pose_t.reshape(-1).tolist(),
        }

    return {
        "id": int(det.tag_id),
        "hamming": int(det.hamming),
        "decision_margin": float(det.decision_margin),
        "center": [float(det.center[0]), float(det.center[1])],
        "corners": [[float(x), float(y)] for x, y in det.corners],
        "pose": pose,
    }


def rotation_to_rpy(rot):
    rot = np.asarray(rot, dtype=np.float64)
    if rot.shape != (3, 3):
        return None
    roll = np.arctan2(rot[2, 1], rot[2, 2])
    pitch = np.arctan2(-rot[2, 0], np.sqrt(rot[2, 1] ** 2 + rot[2, 2] ** 2))
    yaw = np.arctan2(rot[1, 0], rot[0, 0])
    return [float(roll), float(pitch), float(yaw)]


def get_screen_size():
    try:
        import tkinter  # type: ignore
    except Exception:
        return None
    root = tkinter.Tk()
    root.withdraw()
    width = root.winfo_screenwidth()
    height = root.winfo_screenheight()
    root.destroy()
    return width, height


def move_window(name, width, height, offset_x, offset_y):
    try:
        import cv2
    except Exception:
        return

    screen = get_screen_size()
    if screen:
        screen_w, screen_h = screen
        x = 0 + offset_x
        y = screen_h - height + offset_y
    else:
        x = offset_x
        y = offset_y
    try:
        cv2.moveWindow(name, int(x), int(y))
    except Exception:
        pass


def draw_overlay(frame, dets, fused_pose, fps):
    try:
        import cv2
    except Exception:
        return frame

    for det in dets:
        corners = np.array(det["corners"], dtype=np.int32).reshape((-1, 1, 2))
        cv2.polylines(frame, [corners], isClosed=True, color=(0, 255, 0), thickness=2)
        cx, cy = det["center"]
        cv2.circle(frame, (int(cx), int(cy)), 3, (0, 0, 255), -1)
        label = f"id={det['id']} m={det['decision_margin']:.1f}"
        cv2.putText(
            frame,
            label,
            (int(cx) + 6, int(cy) - 6),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )

    if fused_pose:
        text_lines = [
            f"pose t={np.array(fused_pose['translation']).round(3).tolist()}",
            f"pose rpy={np.array(fused_pose['rpy_rad']).round(3).tolist()}",
        ]
    else:
        text_lines = ["pose: none"]

    text_lines.append(f"tags={len(dets)} fps={fps:.1f}")
    y = 18
    for line in text_lines:
        cv2.putText(
            frame,
            line,
            (8, y),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (255, 255, 255),
            1,
            cv2.LINE_AA,
        )
        y += 18

    return frame


def main(argv=None):
    parser = argparse.ArgumentParser(description="Live AprilTag stream from capture frames.")
    parser.add_argument("--dir", default="tagoutput1", help="Directory with captures")
    parser.add_argument("--pattern", default="apriltag_frame_", help="Filename contains pattern")
    parser.add_argument("--field-config", default="field_config.json", help="Field config JSON")
    parser.add_argument("--tag-map", default="tag_map_field.json", help="Tag map JSON")
    parser.add_argument(
        "--tag-map-mode",
        choices=("auto", "file"),
        default="auto",
        help="Build tag map from field config/overrides or load from file",
    )
    parser.add_argument(
        "--tag-overrides",
        default="../tag_overrides.json",
        help="Path to tag overrides JSON for auto tag map",
    )
    parser.add_argument("--camera-config", default="../robot/config.json", help="Robot camera config")
    parser.add_argument("--camera-index", type=int, default=0, help="Camera index in robot config")
    parser.add_argument("--family", default="tag36h11", help="Tag family")
    parser.add_argument("--invert", action="store_true", help="Invert grayscale image")
    parser.add_argument("--scale", type=float, default=1.0, help="Scale factor")
    parser.add_argument("--tag-size", type=float, default=None, help="Tag size in meters")
    parser.add_argument("--fx", type=float, default=None, help="Focal length x in pixels")
    parser.add_argument("--fy", type=float, default=None, help="Focal length y in pixels")
    parser.add_argument("--cx", type=float, default=None, help="Principal point x in pixels")
    parser.add_argument("--cy", type=float, default=None, help="Principal point y in pixels")
    parser.add_argument("--nthreads", type=int, default=0, help="Detector threads (0=auto)")
    parser.add_argument("--quad-decimate", type=float, default=1.0, help="Quad decimate")
    parser.add_argument("--quad-sigma", type=float, default=0.8, help="Quad sigma")
    parser.add_argument("--refine-edges", type=int, default=1, help="Refine edges (0/1)")
    parser.add_argument("--decode-sharpening", type=float, default=0.35, help="Decode sharpening")
    parser.add_argument("--min-margin", type=float, default=0.0, help="Min decision margin")
    parser.add_argument("--max-hamming", type=int, default=0, help="Max allowed hamming distance")
    parser.add_argument("--min-pose-tags", type=int, default=2, help="Min tag count to accept pose")
    parser.add_argument(
        "--pose-max-translation-dev",
        type=float,
        default=None,
        help="Max translation deviation for pose inliers (meters)",
    )
    parser.add_argument(
        "--pose-max-rotation-deg",
        type=float,
        default=None,
        help="Max rotation deviation for pose inliers (degrees)",
    )
    parser.add_argument("--no-pose-robust", action="store_true", help="Disable robust pose fusion")
    parser.add_argument("--no-enhance", action="store_true", help="Disable CLAHE/unsharp")
    parser.add_argument("--clahe-clip", type=float, default=2.0, help="CLAHE clip limit")
    parser.add_argument("--clahe-grid", type=int, default=8, help="CLAHE grid size")
    parser.add_argument("--unsharp", type=float, default=0.6, help="Unsharp amount")
    parser.add_argument("--unsharp-sigma", type=float, default=1.0, help="Unsharp sigma")
    parser.add_argument("--window-name", default="Tag Stream", help="Window title")
    parser.add_argument("--offset-x", type=int, default=-150, help="Window offset x")
    parser.add_argument("--offset-y", type=int, default=0, help="Window offset y")
    parser.add_argument("--poll-hz", type=float, default=30.0, help="Poll rate")
    parser.add_argument("--write-json", default=None, help="Optional JSON output path")
    parser.add_argument("--show-window", action="store_true", help="Show OpenCV preview window")
    args = parser.parse_args(argv)

    field_config = load_json(args.field_config)
    camera_config = load_json(args.camera_config)

    tag_size = args.tag_size
    if tag_size is None and field_config:
        april_tags = field_config.get("aprilTags")
        if isinstance(april_tags, list) and april_tags:
            tag_size = parse_tag_size_from_variant(april_tags[0].get("variant"), None)
    if tag_size is None:
        tag_size = 0.1651

    tag_map = None
    if args.tag_map_mode == "auto":
        overrides = load_tag_overrides(args.tag_overrides)
        try:
            tag_map = build_tag_map_from_field_config(field_config, overrides)
        except Exception as exc:
            print(f"Tag map auto-build failed: {exc}")

    tag_map_path = args.tag_map
    if tag_map is None and tag_map_path:
        if not os.path.isabs(tag_map_path):
            tag_map_path = os.path.join(os.path.dirname(__file__), tag_map_path)
        if os.path.exists(tag_map_path):
            tag_map = load_tag_map(tag_map_path)

    detector = build_detector(args)

    last_path = None
    last_frame = None
    last_data = None
    last_time = 0.0
    fps = 0.0
    period = 1.0 / max(1.0, args.poll_hz)

    try:
        import cv2
    except Exception as exc:
        raise RuntimeError("OpenCV is required for decoding frames.") from exc

    if args.show_window:
        cv2.namedWindow(args.window_name, cv2.WINDOW_NORMAL)

    while True:
        start = time.time()
        image_path = find_latest_image(args.dir, args.pattern)
        if image_path and image_path != last_path:
            try:
                image = load_grayscale(image_path)
                height, width = image.shape[:2]
                fx, fy, cx, cy = compute_camera_intrinsics(
                    width,
                    height,
                    camera_config,
                    args.camera_index,
                    args.fx,
                    args.fy,
                    args.cx,
                    args.cy,
                )

                if args.scale and args.scale != 1.0:
                    image = cv2.resize(
                        image,
                        (
                            max(1, int(width * args.scale)),
                            max(1, int(height * args.scale)),
                        ),
                        interpolation=cv2.INTER_LINEAR,
                    )
                    fx *= args.scale
                    fy *= args.scale
                    cx *= args.scale
                    cy *= args.scale

                if args.invert:
                    image = 255 - image

                if not args.no_enhance:
                    image = enhance_image(
                        image,
                        clip_limit=args.clahe_clip,
                        tile_grid=args.clahe_grid,
                        unsharp_amount=args.unsharp,
                        unsharp_sigma=args.unsharp_sigma,
                    )

                detections = detector.detect(
                    image,
                    estimate_tag_pose=True,
                    camera_params=(fx, fy, cx, cy),
                    tag_size=tag_size,
                )
                det_dicts = [detection_to_dict(det) for det in detections]
                if args.min_margin > 0:
                    det_dicts = [
                        det for det in det_dicts if det["decision_margin"] >= args.min_margin
                    ]

                fused_pose = None
                if tag_map and det_dicts:
                    fused = compute_camera_pose_from_map(
                        det_dicts,
                        tag_map,
                        min_margin=args.min_margin,
                        max_hamming=args.max_hamming,
                        min_inliers=args.min_pose_tags,
                        robust=not args.no_pose_robust,
                        max_translation_dev=args.pose_max_translation_dev,
                        max_rotation_deg=args.pose_max_rotation_deg,
                    )
                    if fused is not None:
                        fused_pose = {
                            "translation": np.asarray(fused["translation"], dtype=np.float64).tolist(),
                            "rotation": np.asarray(fused["rotation"], dtype=np.float64).tolist(),
                            "rpy_rad": rotation_to_rpy(fused["rotation"]),
                            "inlier_ids": fused.get("inlier_ids"),
                            "inlier_count": fused.get("inlier_count"),
                        }

                frame = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
                frame = draw_overlay(frame, det_dicts, fused_pose, fps)
                last_frame = frame
                last_data = {
                    "image": image_path,
                    "image_size": [int(frame.shape[1]), int(frame.shape[0])],
                    "detections": det_dicts,
                    "fused_pose": fused_pose,
                }
                last_path = image_path
            except Exception as exc:
                last_frame = None
                last_data = None
                print(f"Failed to process {image_path}: {exc}")

        if last_frame is not None:
            if args.show_window:
                cv2.imshow(args.window_name, last_frame)
                move_window(
                    args.window_name,
                    last_frame.shape[1],
                    last_frame.shape[0],
                    args.offset_x,
                    args.offset_y,
                )
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    break
            if args.write_json and last_data:
                out_path = args.write_json
                if not os.path.isabs(out_path):
                    out_path = os.path.join(os.path.dirname(__file__), out_path)
                with open(out_path, "w", encoding="utf-8") as fp:
                    json.dump(last_data, fp, indent=2)

        elapsed = time.time() - start
        if elapsed > 0:
            fps = 1.0 / elapsed

        sleep_time = period - elapsed
        if sleep_time > 0:
            time.sleep(sleep_time)

    if args.show_window:
        cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
