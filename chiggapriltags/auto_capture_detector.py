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
import requests
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
    def __init__(self, capture_dir="tagoutput1", field_config_path="field_config.json", 
                 tag_map_path="tag_map_field.json", capture_interval=2.0):
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
        
        # Initialize AprilTag detector
        self.detector = Detector(families='tag36h11')
        
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
            detections = self.detector.detect(
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
    
    def update_stats(self, detections, image_path):
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
        
        # Write latest detections to JSON file
        self.write_latest_detections(detections, image_path)
    
    def write_latest_detections(self, detections, image_path):
        """Write the latest detections to the JSON file."""
        output_path = self.capture_dir / "latest_detections.json"
        
        # Prepare data structure similar to the simulation format
        data = {
            "image": str(image_path),
            "image_size": [960, 720],  # Default size, adjust as needed
            "detections": detections,
            "timestamp": datetime.now().isoformat()
        }
        
        try:
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"Error writing detections to {output_path}: {e}")
    
    def process_new_captures(self):
        """Process any new capture files that haven't been processed yet."""
        # Find all PNG files in the capture directory
        png_files = list(self.capture_dir.glob("apriltag_frame_*.png"))
        
        # Process any new files
        for image_path in png_files:
            if str(image_path) not in self.last_processed_images:
                print(f"Processing new capture: {image_path.name}")
                
                # Detect tags in the image
                detections = self.detect_apriltags_in_image(image_path)
                
                # Validate and update stats
                self.update_stats(detections, image_path)
                
                # Mark as processed
                self.last_processed_images.add(str(image_path))
                
                # Print summary
                valid_count = sum(1 for det in detections if self.validate_detection(det)["valid"])
                print(f"  Found {len(detections)} tags, {valid_count} valid")
    
    def continuous_capture_monitor(self):
        """Monitor for new captures in a continuous loop."""
        while self.running:
            # Process any new captures
            self.process_new_captures()
            
            # Print stats periodically
            if self.stats["total_frames"] % 10 == 0 and self.stats["total_frames"] > 0:
                print(f"\nStats - Total: {self.stats['total_frames']}, "
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
    
    args = parser.parse_args()
    
    detector = AutoCaptureDetector(
        capture_dir=args.capture_dir,
        capture_interval=args.capture_interval,
        field_config_path=args.field_config,
        tag_map_path=args.tag_map
    )
    
    detector.start()


if __name__ == "__main__":
    main()