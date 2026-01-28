# AprilTag Detection and Validation for Three.js Simulation

This system provides real-time AprilTag detection and validation for the Three.js FRC field simulation.

## Components

1. **Three.js Simulation** (`script.js`): The main simulation that captures frames
2. **Frame Capture**: Simulation captures frames to `tagoutput1/` directory
3. **Python Detection System**: Processes captured frames and detects AprilTags
4. **JSON Output**: Latest detections stored in `tagoutput1/latest_detections.json`
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

### Step 1: Run the Three.js Simulation
Open `index.html` in your browser and use the simulation controls:
- Press `P` to capture frames (they'll appear in `tagoutput1/` directory)
- Move the robot around to capture different views

### Step 2: Run the Detection System
In a separate terminal, run the detection system:
```bash
cd chiggapriltags
source env/bin/activate
python3 simulation_detector.py
```

This will:
- Monitor the `tagoutput1/` directory for new captured frames
- Process each new frame with AprilTag detection
- Update `tagoutput1/latest_detections.json` with the latest results
- Provide real-time statistics

### Step 3: Run the Validation Stream (Optional)
For visual validation feedback:
```bash
cd chiggapriltags
source env/bin/activate
python3 validation_stream.py
```

This will:
- Monitor `tagoutput1/latest_detections.json`
- Display validation results in real-time
- Show detection quality metrics

## Directory Structure

```
threejs2026field/
├── index.html              # Main simulation page
├── script.js               # Three.js simulation code
├── chiggapriltags/         # AprilTag processing directory
│   ├── env/                # Virtual environment
│   ├── field_config.json   # Field configuration
│   ├── tag_map_field.json  # Tag position mapping
│   ├── simulation_detector.py  # Frame processing script
│   └── validation_stream.py    # Validation visualization
└── tagoutput1/             # Captured frames and detection results
    ├── apriltag_frame_000.png
    ├── apriltag_frame_001.png
    └── latest_detections.json
```

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