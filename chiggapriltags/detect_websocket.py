import argparse
import asyncio
import json
import os
import time
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from tag_map_odometry import compute_camera_pose_from_map, load_tag_map
from detect_stream import (
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


def resolve_worker_threads(worker_threads):
    cpu_count = os.cpu_count() or 1
    if worker_threads and worker_threads > 0:
        return int(worker_threads)
    return max(1, cpu_count - 1)


def resolve_detector_threads(detector_threads, worker_threads):
    cpu_count = os.cpu_count() or 1
    if detector_threads and detector_threads > 0:
        return int(detector_threads)
    if worker_threads > 1:
        return 1
    return max(1, cpu_count - 1)


def build_detector_with_threads(args, detector_threads):
    try:
        from pupil_apriltags import Detector
    except Exception as exc:
        raise RuntimeError(
            "pupil-apriltags is required. Install with: pip install pupil-apriltags"
        ) from exc

    return Detector(
        families=args.family,
        nthreads=detector_threads,
        quad_decimate=args.quad_decimate,
        quad_sigma=args.quad_sigma,
        refine_edges=args.refine_edges,
        decode_sharpening=args.decode_sharpening,
        debug=0,
    )


def make_detector_provider(args, detector_threads):
    detector_local = threading.local()

    def get_detector():
        detector = getattr(detector_local, "detector", None)
        if detector is None:
            detector = build_detector_with_threads(args, detector_threads)
            detector_local.detector = detector
        return detector

    return get_detector


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


def detect_tags_worker(image, detector_provider, args, camera_config, tag_map, tag_size):
    detector = detector_provider()
    return detect_tags(image, detector, args, camera_config, tag_map, tag_size)


def process_message_worker(message, detector_provider, args, camera_config, tag_map, tag_size):
    image = decode_png(message)
    return detect_tags_worker(image, detector_provider, args, camera_config, tag_map, tag_size)


async def handle_client(websocket, args, detector_provider, tag_map, tag_size, camera_config, executor):
    loop = asyncio.get_running_loop()
    latest_message = None
    processing = False
    def is_ws_closed():
        return getattr(websocket, "closed", False) or getattr(websocket, "close_code", None) is not None

    async def process_latest():
        nonlocal latest_message, processing
        while latest_message is not None:
            message = latest_message
            latest_message = None
            start = time.time()
            try:
                det_dicts, fused_pose, width, height = await loop.run_in_executor(
                    executor,
                    process_message_worker,
                    message,
                    detector_provider,
                    args,
                    camera_config,
                    tag_map,
                    tag_size,
                )
                elapsed_ms = (time.time() - start) * 1000.0
                response = build_payload(det_dicts, fused_pose, width, height, elapsed_ms)
                if is_ws_closed():
                    break
                await websocket.send(json.dumps(response))
            except Exception as exc:
                if is_ws_closed():
                    break
                await websocket.send(json.dumps(build_error(str(exc))))
        processing = False
    async for message in websocket:
        if isinstance(message, str):
            try:
                payload = json.loads(message)
            except json.JSONDecodeError:
                continue
            if payload.get("type") == "ping":
                await websocket.send(json.dumps({"type": "pong", "timestamp": time.time()}))
            continue

        latest_message = message
        if not processing:
            processing = True
            asyncio.create_task(process_latest())


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

    worker_threads = resolve_worker_threads(args.worker_threads)
    detector_threads = resolve_detector_threads(args.nthreads, worker_threads)
    detector_provider = make_detector_provider(args, detector_threads)
    executor = ThreadPoolExecutor(max_workers=worker_threads)

    async def handler(websocket):
        await handle_client(websocket, args, detector_provider, tag_map, tag_size, camera_config, executor)

    try:
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
    finally:
        executor.shutdown(wait=True)


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
    parser.add_argument("--worker-threads", type=int, default=0, help="Worker threads (0=auto)")
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
