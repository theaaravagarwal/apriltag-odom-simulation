# AprilTag Detection and Validation for Three.js Simulation

This system provides real-time AprilTag detection and validation for the Three.js FRC field simulation.

## Components

1. **Three.js Simulation** (`../index.html`): The main simulation that captures frames
2. **Frame Capture**: Simulation captures frames to `../tagoutput1/` directory
3. **Python Detection System**: Processes captured frames and detects AprilTags
4. **JSON Output**: Latest detections stored in `../tagoutput1/latest_detections.json`
5. **Validation Stream**: Real-time validation of detection quality

## Setup

1. Make sure you have the virtual environment activated:
   ```bash
   cd chiggapriltags
   source env/bin/activate
   ```

2. The virtual environment should already contain:
   - `pupil-apriltags`
   - `opencv-python`
   - `numpy`

## Usage

### Method 1: Manual Frame Capture
1. Open `../index.html` in your browser and use the simulation controls
2. Press `P` to capture frames (they'll appear in `../tagoutput1/` directory)
3. Run the detection system in another terminal:
   ```bash
   cd chiggapriltags
   source env/bin/activate
   python3 detect_stream.py --dir ../tagoutput1 --write-json ../tagoutput1/latest_detections.json
   ```
4. The system will automatically process new frames as you capture them

### Method 2: Automatic Detection with Preview
Run the detection system with a preview window:
```bash
cd chiggapriltags
source env/bin/activate
python3 detect_stream.py --dir ../tagoutput1 --write-json ../tagoutput1/latest_detections.json --show-window
```

### Method 3: Using the Run Script
Use the convenience script:
```bash
cd chiggapriltags
./run_detection.sh
```

## Validation and Monitoring

For real-time validation of the detection quality:
```bash
cd chiggapriltags
source env/bin/activate
python3 validation_stream.py
```

## Directory Structure

```
threejs2026field/
├── index.html              # Main simulation page
├── script.js               # Three.js simulation code
├── chiggapriltags/         # AprilTag processing directory
│   ├── env/                # Virtual environment
│   ├── field_config.json   # Field configuration
│   ├── tag_map_field.json  # Tag position mapping
│   ├── detect_stream.py    # Original detection system
│   ├── validation_stream.py # Validation visualization
│   ├── simulation_detector.py # Enhanced detection system
│   ├── auto_capture_detector.py # Auto-capture detection system
│   └── run_detection.sh    # Convenience script
└── tagoutput1/             # Captured frames and detection results
    ├── apriltag_frame_000.png
    ├── apriltag_frame_001.png
    └── latest_detections.json
```

## How It Works

1. The Three.js simulation renders the POV camera view
2. When you press 'P', it captures the current frame to `tagoutput1/`
3. `detect_stream.py` monitors the `tagoutput1/` directory for new frames
4. When a new frame is detected, it runs AprilTag detection on it
5. The results are written to `latest_detections.json`
6. Other tools can monitor this JSON file for real-time validation

## Detection Quality Metrics

The system validates detections based on:

- **Expected Tags**: Is the detected tag ID present in the field configuration?
- **Confidence**: Is the decision margin > 50?
- **Accuracy**: Is the hamming distance 0?

Results are color-coded in the validation stream:
- ✅ Green: Valid detection (expected, confident, accurate)
- ⚠️ Orange: Unexpected tag ID
- ⚠️ Yellow: Low confidence detection
- ❌ Red: High hamming error (inaccurate detection)

## Troubleshooting

If you get import errors, make sure to activate the virtual environment:
```bash
cd chiggapriltags
source env/bin/activate
```

If detection isn't working well, try adjusting the camera position in the simulation to get clearer views of the AprilTags.

## Automatic Frame Capture Enhancement

If you want to modify the simulation to automatically capture frames, you would need to add code to the animation loop in `../script.js` to call the capture function periodically. This would require modifying the core simulation code.