# MediaPipe Tasks Vision, vendored for /cpr/

Used by the replay's photo grouping: a face detector and an image embedder,
run in the browser on the ride's own photos. Nothing is uploaded. The page
loads these only when it analyses photos; without them it falls back to its
own look hash.

| File | Source |
|------|--------|
| `vision_bundle.mjs` | npm `@mediapipe/tasks-vision@1.2.0` (source map line removed) |
| `wasm/vision_wasm_internal.{js,wasm}` | same package, `wasm/` (the SIMD build; every current browser has SIMD) |
| `blaze_face_short_range.tflite` | storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/ |
| `mobilenet_v3_small.tflite` | storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/latest/ |

Apache License 2.0, see `LICENSE-mediapipe.txt`. To update: replace the files
from a newer package and models, and keep the names.
