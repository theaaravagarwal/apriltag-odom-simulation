#!/usr/bin/env python3
"""
Validation stream for AprilTag detection system.
Monitors latest_detections.json and provides live validation visualization.
"""

import argparse
import json
import os
import time
from datetime import datetime

try:
    import cv2
    import numpy as np
except ImportError:
    print("OpenCV and NumPy are required. Activate the virtual environment in chiggapriltags/env/")
    exit(1)


class AprilTagValidator:
    def __init__(self, detections_path, field_config_path="field_config.json", tag_map_path="tag_map_field.json"):
        self.detections_path = detections_path
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
        
        # Tracking variables
        self.last_modified_time = 0
        
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
    
    def load_detections(self):
        """Load the latest detections from JSON file."""
        if not os.path.exists(self.detections_path):
            return None
            
        try:
            stat = os.stat(self.detections_path)
            current_time = stat.st_mtime
            
            if current_time > self.last_modified_time:
                with open(self.detections_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                
                self.last_modified_time = current_time
                return data
        except Exception as e:
            print(f"Error reading detections file: {e}")
        
        return None
    
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
    
    def update_stats(self, detections_data):
        """Update statistics based on detections."""
        if not detections_data:
            return
            
        self.stats["total_frames"] += 1
        self.stats["last_update"] = datetime.now().strftime("%H:%M:%S")
        
        if "detections" in detections_data and detections_data["detections"]:
            self.stats["frames_with_detections"] += 1
            
            for det in detections_data["detections"]:
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
    
    def draw_validation_overlay(self, frame, detections_data):
        """Draw validation overlay on the frame."""
        height, width = frame.shape[:2]
        
        # Draw title
        cv2.putText(frame, "AprilTag Simulation Validation Stream", 
                   (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
        
        # Draw stats
        y_offset = 60
        stats_text = [
            f"Total Updates: {self.stats['total_frames']}",
            f"Frames w/ Detections: {self.stats['frames_with_detections']}",
            f"Valid Detections: {self.stats['valid_detections']}",
            f"Invalid Detections: {self.stats['invalid_detections']}",
            f"Avg Decision Margin: {self.stats['avg_decision_margin']:.2f}",
            f"Last Update: {self.stats['last_update'] or 'N/A'}"
        ]
        
        for i, text in enumerate(stats_text):
            cv2.putText(frame, text, (10, y_offset + i*30), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
        
        # Draw detection info
        if detections_data and "detections" in detections_data:
            detections = detections_data["detections"]
            start_y = height - 20 - len(detections) * 30
            
            for i, det in enumerate(detections):
                validation = self.validate_detection(det)
                
                # Determine color based on validation
                if validation["valid"]:
                    color = (0, 255, 0)  # Green for valid
                elif not validation["is_expected"]:
                    color = (0, 165, 255)  # Orange for unexpected
                elif not validation["is_confident"]:
                    color = (0, 255, 255)  # Yellow for low confidence
                elif not validation["is_accurate"]:
                    color = (255, 0, 0)  # Red for inaccurate
                else:
                    color = (128, 128, 128)  # Gray for other cases
                
                # Draw detection info
                text = f"ID: {validation['id']} | Conf: {validation['decision_margin']:.1f} | Ham: {validation['hamming_distance']}"
                cv2.putText(frame, text, (10, start_y + i*30), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 1)
                
                # Draw circle at detection center (scale coordinates to fit frame)
                center_x = int((validation["center"][0] / 960) * width)  # Assuming original image width of 960
                center_y = int((validation["center"][1] / 720) * height)  # Assuming original image height of 720
                center = (center_x, center_y)
                
                cv2.circle(frame, center, 15, color, 3)
                cv2.circle(frame, center, 3, (0, 0, 255), -1)  # Center point
                
                # Draw tag ID near the center
                cv2.putText(frame, str(validation['id']), (center_x + 20, center_y), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
        
        # Draw legend
        legend_y = 200
        legend_items = [
            ((0, 255, 0), "Valid Detection"),
            ((0, 165, 255), "Unexpected Tag"),
            ((0, 255, 255), "Low Confidence"),
            ((255, 0, 0), "High Hamming Error")
        ]
        
        for color, label in legend_items:
            cv2.rectangle(frame, (width - 180, legend_y), (width - 160, legend_y + 20), color, -1)
            cv2.putText(frame, label, (width - 150, legend_y + 15), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            legend_y += 25
    
    def run_validation(self):
        """Main validation loop monitoring latest_detections.json."""
        print("Starting AprilTag simulation validation stream...")
        print(f"Monitoring: {self.detections_path}")
        print("Press 'q' to quit")
        
        # Create window
        cv2.namedWindow("AprilTag Validation Stream", cv2.WINDOW_AUTOSIZE)
        
        while True:
            # Load latest detections
            detections_data = self.load_detections()
            
            if detections_data:
                # Update stats
                self.update_stats(detections_data)
                
                # Create a frame for visualization (black background)
                frame = np.zeros((720, 1280, 3), dtype=np.uint8)
                
                # Draw validation overlay
                self.draw_validation_overlay(frame, detections_data)
                
                # Show frame
                cv2.imshow("AprilTag Validation Stream", frame)
            else:
                # Show waiting message
                frame = np.zeros((720, 1280, 3), dtype=np.uint8)
                cv2.putText(frame, "Waiting for detections...", 
                           (50, 300), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (255, 255, 255), 2)
                cv2.putText(frame, f"Looking for: {self.detections_path}", 
                           (50, 350), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 1)
                cv2.imshow("AprilTag Validation Stream", frame)
            
            # Check for quit key
            key = cv2.waitKey(100) & 0xFF  # Wait 100ms between updates
            if key == ord('q'):
                break
        
        cv2.destroyAllWindows()


def main():
    parser = argparse.ArgumentParser(description="Validate AprilTag detections from latest_detections.json")
    parser.add_argument("--detections-path", default="../tagoutput1/latest_detections.json",
                       help="Path to latest_detections.json file")
    parser.add_argument("--field-config", default="field_config.json",
                       help="Path to field configuration JSON")
    parser.add_argument("--tag-map", default="tag_map_field.json",
                       help="Path to tag map JSON")
    
    args = parser.parse_args()
    
    validator = AprilTagValidator(
        detections_path=args.detections_path,
        field_config_path=args.field_config,
        tag_map_path=args.tag_map
    )
    
    try:
        validator.run_validation()
    except KeyboardInterrupt:
        print("\nValidation stream interrupted by user")
    finally:
        print("Stopping validation stream...")


if __name__ == "__main__":
    main()