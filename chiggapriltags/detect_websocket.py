import argparse
import asyncio
import json
import os
import time

import numpy as np

from tag_map_odometry import compute_camera_pose_from_map, load_tag_map
from detect_stream import (
    build_detector,
    compute_camera_intrinsics,
    detection_to_dict,
    enhance_image,
    load_json,
    parse_tag_size_from_variant,
    rotation_to_rpy,
)


def decode_png(message):
    try:
        import cv2
    except Exception as exc:
        raise RuntimeError("OpenCV is required for decoding PNG frames.") from exc

    data = np.frombuffer(message, dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise RuntimeError("Failed to decode PNG frame")
    return image


def build_payload(det_dicts, fused_pose, width, height, elapsed_ms):
    return {
        "type": "detections",
        "image": "websocket",
        "image_size": [int(width), int(height)],
        "detections": det_dicts,
        "fused_pose": fused_pose,
        "processing_ms": float(elapsed_ms),
        "timestamp": time.time(),
    }


def build_error(message):
    return {
        "type": "error",
        "message": message,
        "timestamp": time.time(),
    }


def maybe_fuse_pose(det_dicts, tag_map):
    if not tag_map or not det_dicts:
        return None
    fused = compute_camera_pose_from_map(det_dicts, tag_map)
    if fused is None:
        return None
    return {
        "translation": np.asarray(fused["translation"], dtype=np.float64).tolist(),
        "rotation": np.asarray(fused["rotation"], dtype=np.float64).tolist(),
        "rpy_rad": rotation_to_rpy(fused["rotation"]),
    }


def detect_tags(image, detector, args, camera_config, tag_map, tag_size):
    try:
        import cv2
    except Exception as exc:
        raise RuntimeError("OpenCV is required for decoding frames.") from exc

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
        height, width = image.shape[:2]

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
        det_dicts = [det for det in det_dicts if det["decision_margin"] >= args.min_margin]

    fused_pose = maybe_fuse_pose(det_dicts, tag_map)
    return det_dicts, fused_pose, width, height


async def handle_client(websocket, args, detector, tag_map, tag_size, camera_config):
    async for message in websocket:
        if isinstance(message, str):
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue
            if payload.get("type") == "ping":
                await websocket.send(json.dumps({"type": "pong", "timestamp": time.time()}))
            continue

        start = time.time()
        try:
            image = decode_png(message)
            det_dicts, fused_pose, width, height = detect_tags(
                image, detector, args, camera_config, tag_map, tag_size
            )
            elapsed_ms = (time.time() - start) * 1000.0
            response = build_payload(det_dicts, fused_pose, width, height, elapsed_ms)
            await websocket.send(json.dumps(response))
        except Exception as exc:
            await websocket.send(json.dumps(build_error(str(exc))))


async def run_server(args):
    try:
        import websockets
    except Exception as exc:
        raise RuntimeError("websockets is required. Install with: pip install websockets") from exc

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
    tag_map_path = args.tag_map
    if tag_map_path:
        if not os.path.isabs(tag_map_path):
            tag_map_path = os.path.join(os.path.dirname(__file__), tag_map_path)
        if os.path.exists(tag_map_path):
            tag_map = load_tag_map(tag_map_path)

    detector = build_detector(args)

    async def handler(websocket):
        await handle_client(websocket, args, detector, tag_map, tag_size, camera_config)

    async with websockets.serve(
        handler,
        args.host,
        args.port,
        max_size=args.max_message_bytes,
        ping_interval=20,
        ping_timeout=20,
    ):
        print(f"WebSocket detector listening on ws://{args.host}:{args.port}")
        await asyncio.Future()


def main(argv=None):
    parser = argparse.ArgumentParser(description="AprilTag detection over WebSocket.")
    parser.add_argument("--host", default="0.0.0.0", help="Bind host")
    parser.add_argument("--port", type=int, default=5174, help="Bind port")
    parser.add_argument("--field-config", default="field_config.json", help="Field config JSON")
    parser.add_argument("--tag-map", default="tag_map_field.json", help="Tag map JSON")
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
    parser.add_argument("--no-enhance", action="store_true", help="Disable CLAHE/unsharp")
    parser.add_argument("--clahe-clip", type=float, default=2.0, help="CLAHE clip limit")
    parser.add_argument("--clahe-grid", type=int, default=8, help="CLAHE grid size")
    parser.add_argument("--unsharp", type=float, default=0.6, help="Unsharp amount")
    parser.add_argument("--unsharp-sigma", type=float, default=1.0, help="Unsharp sigma")
    parser.add_argument(
        "--max-message-bytes",
        type=int,
        default=16 * 1024 * 1024,
        help="Max websocket message size",
    )
    args = parser.parse_args(argv)

    return asyncio.run(run_server(args))


if __name__ == "__main__":
    raise SystemExit(main())
