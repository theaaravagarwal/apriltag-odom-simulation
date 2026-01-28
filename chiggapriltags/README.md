# chiggapriltags stream

Live stream viewer for `tagoutput1/` captures with AprilTag overlays and fused pose.

Run (headless JSON writer):
```
python3 chiggapriltags/detect_stream.py --dir tagoutput1 --write-json ../tagoutput1/latest_detections.json
```

Notes:
- Press `q` to quit.
- Add `--show-window` if you want the OpenCV preview window.
