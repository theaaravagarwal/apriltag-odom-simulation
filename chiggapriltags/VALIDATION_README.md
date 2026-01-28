# AprilTag Validation Stream

This script provides a live validation view of AprilTag detections from the simulation. It monitors the `latest_detections.json` file and displays validation information in real-time.

## Features

- Monitors `latest_detections.json` for updates
- Visualizes detected AprilTag positions on screen
- Color-coded validation status:
  - Green: Valid detection (expected tag, high confidence, accurate)
  - Orange: Unexpected tag ID
  - Yellow: Low confidence detection
  - Red: High hamming error (inaccurate detection)
- Real-time statistics display
- Validation against expected field configuration

## Usage

Make sure you have the virtual environment activated:

```bash
cd chiggapriltags
source env/bin/activate
python3 validation_stream.py
```

### Options

- `--detections-path`: Path to latest_detections.json file (default: `../tagoutput1/latest_detections.json`)
- `--field-config`: Path to field configuration JSON (default: `field_config.json`)
- `--tag-map`: Path to tag map JSON (default: `tag_map_field.json`)

Example with custom paths:

```bash
python3 validation_stream.py --detections-path /path/to/detections.json
```

## Controls

- Press `q` to quit the validation stream

## Requirements

- Python 3.x
- OpenCV (`cv2`)
- NumPy
- pupil-apriltags

All dependencies are included in the `env` virtual environment in this directory.