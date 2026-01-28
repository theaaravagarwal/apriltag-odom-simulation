#!/bin/bash
# Script to run the AprilTag detection system for the simulation
# This will monitor the tagoutput1 directory and process new frames automatically

cd "$(dirname "$0")"

# Activate the virtual environment
source env/bin/activate

# Run the detection stream - this will monitor tagoutput1/ for new frames
# and update latest_detections.json automatically
python3 detect_stream.py --dir ../tagoutput1 --write-json ../tagoutput1/latest_detections.json --poll-hz 30
