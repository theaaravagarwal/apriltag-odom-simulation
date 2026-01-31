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

from detect_stream import rotation_to_rpy


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


def rotation_matrix_from_rotations(rotations):
    if not isinstance(rotations, list):
        return np.eye(3, dtype=np.float64)
    rot = np.eye(3, dtype=np.float64)
    for entry in rotations:
        if not isinstance(entry, dict):
            continue
        axis = entry.get("axis")
        degrees = entry.get("degrees")
        if axis not in {"x", "y", "z"} or degrees is None:
            continue
        radians = np.deg2rad(float(degrees))
        rot = rot @ _rotation_matrix_from_axis(axis, radians)
    return rot


def _camera_pose_from_tag(det_rot, det_trans, map_entry):
    cam_tag_rot = det_rot.T
    cam_tag_trans = -cam_tag_rot @ det_trans
    map_rot = np.asarray(map_entry["rotation"], dtype=np.float64)
    map_trans = np.asarray(map_entry["translation"], dtype=np.float64).reshape(3)
    cam_map_rot = map_rot @ cam_tag_rot
    cam_map_trans = map_rot @ cam_tag_trans + map_trans
    return cam_map_rot, cam_map_trans


def compute_pose_error(det_dicts, tag_map, fused_pose):
    if not det_dicts or not tag_map or fused_pose is None:
        return None
    fused_trans = np.asarray(fused_pose.get("translation"), dtype=np.float64).reshape(3)
    inlier_ids = fused_pose.get("inlier_ids") if isinstance(fused_pose, dict) else None
    inlier_set = set(inlier_ids) if inlier_ids else None
    errors = []
    for det in det_dicts:
        if inlier_set is not None and det.get("id") not in inlier_set:
            continue
        pose = det.get("pose")
        if not pose:
            continue
        map_entry = tag_map.get(det.get("id"))
        if not map_entry:
            continue
        det_rot = np.asarray(pose.get("rotation"), dtype=np.float64)
        det_trans = np.asarray(pose.get("translation"), dtype=np.float64).reshape(-1)
        if det_rot.shape != (3, 3) or det_trans.shape[0] != 3:
            continue
        _, cam_trans = _camera_pose_from_tag(det_rot, det_trans, map_entry)
        errors.append(float(np.linalg.norm(cam_trans - fused_trans)))
    if not errors:
        return None
    rms = float(np.sqrt(np.mean(np.square(errors))))
    return {"rms_translation_m": rms, "count": len(errors)}


def compute_robot_pose_from_camera(fused_pose, camera_config, camera_index=0):
    if fused_pose is None:
        return None

    cam_rot = np.asarray(fused_pose.get("rotation"), dtype=np.float64)
    cam_trans = np.asarray(fused_pose.get("translation"), dtype=np.float64).reshape(3)
    if cam_rot.shape != (3, 3):
        return None

    cam_cfg = None
    if camera_config and isinstance(camera_config.get("cameras"), list):
        cameras = camera_config["cameras"]
        if 0 <= camera_index < len(cameras):
            cam_cfg = cameras[camera_index]

    if cam_cfg is None:
        return {
            "translation": cam_trans.tolist(),
            "rotation": cam_rot.tolist(),
            "rpy_rad": rotation_to_rpy(cam_rot),
            "label": "camera_pose",
        }

    cam_offset = np.asarray(cam_cfg.get("position", [0, 0, 0]), dtype=np.float64).reshape(3)
    cam_rot_rel = rotation_matrix_from_rotations(cam_cfg.get("rotations"))
    robot_rot = cam_rot @ cam_rot_rel.T
    robot_trans = cam_rot @ (-cam_rot_rel.T @ cam_offset) + cam_trans
    return {
        "translation": robot_trans.tolist(),
        "rotation": robot_rot.tolist(),
        "rpy_rad": rotation_to_rpy(robot_rot),
        "label": "robot_pose",
    }


def compute_rotation_error_rad(rot_a, rot_b):
    rot_a = np.asarray(rot_a, dtype=np.float64)
    rot_b = np.asarray(rot_b, dtype=np.float64)
    if rot_a.shape != (3, 3) or rot_b.shape != (3, 3):
        return None
    rot_err = rot_a.T @ rot_b
    trace = float(np.trace(rot_err))
    cos_theta = (trace - 1.0) / 2.0
    cos_theta = float(np.clip(cos_theta, -1.0, 1.0))
    return float(np.arccos(cos_theta))


def compute_ground_truth_error(pred_pose, ground_truth_pose):
    if not pred_pose or not ground_truth_pose:
        return None
    pred_trans = np.asarray(pred_pose.get("translation"), dtype=np.float64).reshape(3)
    gt_trans = np.asarray(ground_truth_pose.get("translation"), dtype=np.float64).reshape(3)
    delta = pred_trans - gt_trans
    trans_err = float(np.linalg.norm(delta))
    rot_err = None
    pred_rpy = None
    gt_rpy = None
    yaw_err = None
    if pred_pose.get("rotation") is not None and ground_truth_pose.get("rotation") is not None:
        pred_rpy = rotation_to_rpy(pred_pose["rotation"])
        gt_rpy = rotation_to_rpy(ground_truth_pose["rotation"])
        rot_err = compute_rotation_error_rad(pred_pose["rotation"], ground_truth_pose["rotation"])
        if pred_rpy is not None and gt_rpy is not None:
            yaw_err = _wrap_angle_rad(pred_rpy[2] - gt_rpy[2])
    return {
        "translation_m": trans_err,
        "delta_m": delta,
        "rotation_rad": rot_err,
        "pred_rpy_rad": pred_rpy,
        "gt_rpy_rad": gt_rpy,
        "yaw_error_rad": yaw_err,
    }


def _wrap_angle_rad(angle):
    return float((angle + np.pi) % (2.0 * np.pi) - np.pi)


def _rad_to_deg(value):
    return float(np.rad2deg(value))


def _vec3_to_list(value):
    return np.asarray(value, dtype=np.float64).reshape(3).tolist()


def format_pose_line(robot_pose, tag_error=None, ground_truth_error=None, inlier_ids=None):
    if not robot_pose:
        return "pose: none"
    meters_to_feet = 3.28084
    trans_m = np.asarray(robot_pose.get("translation"), dtype=np.float64)
    trans = (trans_m * meters_to_feet).round(3).tolist()
    rpy = robot_pose.get("rpy_rad")
    yaw_deg = None
    if rpy is not None:
        yaw_deg = _rad_to_deg(rpy[2])
    parts = []
    if ground_truth_error:
        gt_delta_ft = _vec3_to_list(ground_truth_error["delta_m"] * meters_to_feet)
        gt_pos_ft = ground_truth_error["translation_m"] * meters_to_feet
        parts.append(f"err={gt_pos_ft:.3f}ft d={np.round(gt_delta_ft, 3).tolist()}ft")
        if ground_truth_error.get("yaw_error_rad") is not None:
            parts.append(f"yaw_err={_rad_to_deg(ground_truth_error['yaw_error_rad']):.1f}deg")
        if ground_truth_error.get("rotation_rad") is not None:
            parts.append(f"rot_err={_rad_to_deg(ground_truth_error['rotation_rad']):.1f}deg")
        if ground_truth_error.get("gt_rpy_rad") is not None:
            gt_yaw_deg = _rad_to_deg(ground_truth_error["gt_rpy_rad"][2])
            parts.append(f"gt_yaw={gt_yaw_deg:.1f}deg")
    if tag_error:
        tag_rms_ft = tag_error["rms_translation_m"] * meters_to_feet
        tag_text = f"tag_rms={tag_rms_ft:.3f}ft"
        if tag_error.get("count"):
            tag_text += f" ({tag_error['count']} tags)"
        parts.append(tag_text)
    if inlier_ids:
        parts.append(f"inliers={sorted(inlier_ids)}")
    error_text = ""
    if parts:
        error_text = " | " + " ".join(parts)
    label = robot_pose.get("label", "pose")
    yaw_text = f" yaw={yaw_deg:.1f}deg" if yaw_deg is not None else ""
    return f"{label} t={trans}ft{yaw_text}{error_text}"


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
