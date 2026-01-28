#!/usr/bin/env python3
"""
Automatic frame capture and detection system for the Three.js simulation.
Automatically captures frames at a specified interval and processes them.
"""

import argparse
import json
import os
import time
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from datetime import datetime

try:
    import cv2
    import numpy as np
except ImportError:
    print("OpenCV and NumPy are required. Activate the virtual environment in chiggapriltags/env/")
    exit(1)

try:
    from pupil_apriltags import Detector
except ImportError:
    print("pupil-apriltags is required. Activate the virtual environment in chiggapriltags/env/")
    exit(1)


class AutoCaptureDetector:
    def __init__(
        self,
        capture_dir="tagoutput1",
        field_config_path="field_config.json",
        tag_map_path="tag_map_field.json",
        capture_interval=2.0,
        worker_threads=0,
        detector_threads=0,
    ):
        self.capture_dir = Path(capture_dir)
        self.capture_dir.mkdir(exist_ok=True)
        self.capture_interval = capture_interval  # seconds between captures
        self.field_config_path = field_config_path
        self.tag_map_path = tag_map_path
        
        # Load configurations
        self.field_config = self.load_json(field_config_path)
        self.tag_map = self.load_json(tag_map_path)
        
        # Expected tag IDs from field config
        self.expected_tags = {}
        if self.field_config and "aprilTags" in self.field_config:
            for tag in self.field_config["aprilTags"]:
                self.expected_tags[tag["id"]] = tag
        
        # Threading configuration
        self.worker_threads = self.resolve_worker_threads(worker_threads)
        self.detector_threads = self.resolve_detector_threads(detector_threads, self.worker_threads)
        self._detector_local = threading.local()
        self._executor = None
        self._lock = threading.Lock()
        self._inflight_images = set()
        self._latest_output_mtime = 0.0
        self._last_stats_report = 0
        
        # Tracking variables
        self.last_processed_images = set()
        self.running = False
        self.capture_thread = None
        
        # Stats tracking
        self.stats = {
            "total_frames": 0,
            "frames_with_detections": 0,
            "valid_detections": 0,
            "invalid_detections": 0,
            "avg_decision_margin": 0,
            "last_update": None
        }
    
    def load_json(self, path):
        """Load JSON file."""
        if not os.path.exists(path):
            print(f"Warning: {path} not found")
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading {path}: {e}")
            return None

    def resolve_worker_threads(self, worker_threads):
        cpu_count = os.cpu_count() or 1
        if worker_threads and worker_threads > 0:
            return int(worker_threads)
        return max(1, cpu_count - 1)

    def resolve_detector_threads(self, detector_threads, worker_threads):
        cpu_count = os.cpu_count() or 1
        if detector_threads and detector_threads > 0:
            return int(detector_threads)
        if worker_threads > 1:
            return 1
        return max(1, cpu_count - 1)

    def get_detector(self):
        detector = getattr(self._detector_local, "detector", None)
        if detector is None:
            detector = Detector(families="tag36h11", nthreads=self.detector_threads)
            self._detector_local.detector = detector
        return detector
    
    def detect_apriltags_in_image(self, image_path):
        """Detect AprilTags in a single image file."""
        try:
            # Load image
            image = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
            if image is None:
                print(f"Could not load image: {image_path}")
                return []
            
            # Get camera intrinsics from image dimensions (approximate values)
            height, width = image.shape
            fx = fy = max(width, height)  # Approximate focal length
            cx, cy = width / 2, height / 2  # Principal point at center
            
            # Detect tags
            detector = self.get_detector()
            detections = detector.detect(
                image,
                estimate_tag_pose=True,
                camera_params=(fx, fy, cx, cy),
                tag_size=0.1651  # Default tag size (0.1651m = 6.5 inches)
            )
            
            # Convert detections to dictionary format
            detection_dicts = []
            for det in detections:
                pose = None
                if det.pose_R is not None and det.pose_t is not None:
                    pose = {
                        "rotation": det.pose_R.tolist(),
                        "translation": det.pose_t.reshape(-1).tolist(),
                    }
                
                detection_dict = {
                    "id": int(det.tag_id),
                    "hamming": int(det.hamming),
                    "decision_margin": float(det.decision_margin),
                    "center": [float(det.center[0]), float(det.center[1])],
                    "corners": [[float(x), float(y)] for x, y in det.corners],
                    "pose": pose,
                }
                detection_dicts.append(detection_dict)
            
            return detection_dicts
        except Exception as e:
            print(f"Error detecting tags in {image_path}: {e}")
            return []
    
    def validate_detection(self, detection):
        """Validate a single detection against expected tags."""
        tag_id = detection["id"]
        
        # Check if tag ID is expected
        is_expected = tag_id in self.expected_tags
        
        # Check decision margin (confidence)
        decision_margin = detection["decision_margin"]
        is_confident = decision_margin > 50  # Threshold for confidence
        
        # Check hamming distance (error correction)
        hamming_distance = detection["hamming"]
        is_accurate = hamming_distance == 0  # Perfect detection
        
        return {
            "id": tag_id,
            "is_expected": is_expected,
            "is_confident": is_confident,
            "is_accurate": is_accurate,
            "decision_margin": decision_margin,
            "hamming_distance": hamming_distance,
            "center": detection["center"],
            "valid": is_expected and is_confident and is_accurate
        }
    
    def update_stats(self, detections, image_path, image_mtime):
        """Update statistics based on detections."""
        self.stats["total_frames"] += 1
        self.stats["last_update"] = datetime.now().strftime("%H:%M:%S")
        
        if detections:
            self.stats["frames_with_detections"] += 1
            
            for det in detections:
                validation_result = self.validate_detection(det)
                
                if validation_result["valid"]:
                    self.stats["valid_detections"] += 1
                else:
                    self.stats["invalid_detections"] += 1
                
                # Update average decision margin
                total_margin = self.stats["avg_decision_margin"] * (self.stats["valid_detections"] + self.stats["invalid_detections"] - 1)
                total_margin += validation_result["decision_margin"]
                count = self.stats["valid_detections"] + self.stats["invalid_detections"]
                if count > 0:
                    self.stats["avg_decision_margin"] = total_margin / count
        
        # Write latest detections to JSON file if newer than current output
        if image_mtime >= self._latest_output_mtime:
            self._latest_output_mtime = image_mtime
            self.write_latest_detections(detections, image_path)
    
    def write_latest_detections(self, detections, image_path):
        """Write the latest detections to the JSON file."""
        output_path = self.capture_dir / "latest_detections.json"
        tmp_path = output_path.with_suffix(output_path.suffix + ".tmp")
        
        # Prepare data structure similar to the simulation format
        data = {
            "image": str(image_path),
            "image_size": [960, 720],  # Default size, adjust as needed
            "detections": detections,
            "timestamp": datetime.now().isoformat()
        }
        
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp_path, output_path)
        except Exception as e:
            print(f"Error writing detections to {output_path}: {e}")
            try:
                if tmp_path.exists():
                    tmp_path.unlink()
            except Exception:
                pass
    
    def process_new_captures(self):
        """Process any new capture files that haven't been processed yet."""
        # Find all PNG files in the capture directory
        png_files = list(self.capture_dir.glob("apriltag_frame_*.png"))
        png_files.sort(key=lambda path: path.stat().st_mtime if path.exists() else 0)

        new_paths = []
        with self._lock:
            for image_path in png_files:
                path_str = str(image_path)
                if path_str in self.last_processed_images or path_str in self._inflight_images:
                    continue
                self._inflight_images.add(path_str)
                new_paths.append(image_path)

        for image_path in new_paths:
            print(f"Processing new capture: {image_path.name}")
            self._executor.submit(self._process_single_image, image_path)

    def _process_single_image(self, image_path):
        try:
            image_mtime = image_path.stat().st_mtime
        except Exception:
            image_mtime = time.time()

        detections = self.detect_apriltags_in_image(image_path)
        valid_count = sum(1 for det in detections if self.validate_detection(det)["valid"])

        with self._lock:
            self.update_stats(detections, image_path, image_mtime)
            self.last_processed_images.add(str(image_path))
            self._inflight_images.discard(str(image_path))

        print(f"  Found {len(detections)} tags, {valid_count} valid")
    
    def continuous_capture_monitor(self):
        """Monitor for new captures in a continuous loop."""
        while self.running:
            # Process any new captures
            self.process_new_captures()
            
            # Print stats periodically
            with self._lock:
                total_frames = self.stats["total_frames"]
                if total_frames > 0 and total_frames % 10 == 0 and total_frames != self._last_stats_report:
                    self._last_stats_report = total_frames
                    print(f"\nStats - Total: {total_frames}, "
                          f"Detections: {self.stats['frames_with_detections']}, "
                          f"Valid: {self.stats['valid_detections']}, "
                          f"Avg Margin: {self.stats['avg_decision_margin']:.2f}")
            
            # Wait a bit before checking again
            time.sleep(0.5)
    
    def start(self):
        """Start the continuous detection system."""
        print("Starting automatic capture and detection system...")
        print(f"Monitoring: {self.capture_dir}/")
        print(f"Capture interval: {self.capture_interval}s")
        print("Press Ctrl+C to stop")
        
        self._executor = ThreadPoolExecutor(max_workers=self.worker_threads)
        self.running = True
        self.capture_thread = threading.Thread(target=self.continuous_capture_monitor)
        self.capture_thread.daemon = True
        self.capture_thread.start()
        
        try:
            while self.running:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nStopping detection system...")
        finally:
            self.stop()
    
    def stop(self):
        """Stop the detection system."""
        self.running = False
        if self.capture_thread:
            self.capture_thread.join(timeout=2)
        if self._executor:
            self._executor.shutdown(wait=True)


def main():
    parser = argparse.ArgumentParser(description="Automatic capture and detection system for Three.js simulation")
    parser.add_argument("--capture-dir", default="tagoutput1",
                       help="Directory containing captured frames (default: tagoutput1)")
    parser.add_argument("--capture-interval", type=float, default=2.0,
                       help="Interval between captures in seconds (default: 2.0)")
    parser.add_argument("--field-config", default="field_config.json",
                       help="Path to field configuration JSON")
    parser.add_argument("--tag-map", default="tag_map_field.json",
                       help="Path to tag map JSON")
    parser.add_argument("--worker-threads", type=int, default=0,
                       help="Worker threads for processing (0=auto)")
    parser.add_argument("--detector-threads", type=int, default=0,
                       help="Threads per detector (0=auto)")
    
    args = parser.parse_args()
    
    detector = AutoCaptureDetector(
        capture_dir=args.capture_dir,
        capture_interval=args.capture_interval,
        field_config_path=args.field_config,
        tag_map_path=args.tag_map,
        worker_threads=args.worker_threads,
        detector_threads=args.detector_threads,
    )
    
    detector.start()


if __name__ == "__main__":
    main()
