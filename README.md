# Background Effects Playground

Camera background blur and replacement in the browser, side by side: segmentation models, mask techniques, and
[`@livekit/track-processors`](https://github.com/livekit/track-processors-js) with the options added in
[#159](https://github.com/livekit/track-processors-js/pull/159) and its follow-ups.

**Try it:** https://abhinavkrin.github.io/background-effects-playground/

Everything runs on your device. The camera picture never leaves the browser tab: segmentation and rendering run
locally on the GPU through MediaPipe and WebGL, and the page has no server beyond the static files.

## What you can compare

**Engines** (per pane)

| Engine | What it runs |
| --- | --- |
| LiveKit track-processors | `@livekit/track-processors` built from livekit/track-processors-js `main` (0b32e48) with the three options below applied, vendored in `vendor/`. Driven as an app drives it: `setProcessor(BackgroundProcessor(...))` on a `LocalVideoTrack`. With the options at their defaults it renders as `main`. |
| Custom WebGL pipeline | The library's WebGL pipeline split into passes you can reorder, turn off and tune live, with debug views of the raw and refined masks. |

**BackgroundProcessor options** (set per pane)

| Option | Technique |
| --- | --- |
| `segmentationMask: 'category' \| 'confidence'` | Category mask (the default): the per-pixel class decision, 0 or 1. Confidence mask: the per-pixel probability, 0 to 1, so the edge moves by fractions of a pixel and multiclass models work. |
| `temporalSmoothing` | Motion-adaptive EMA of the mask: keeps 15% of the new mask where the frame is still, up to 90% where it moves. |
| `edgeRefinement` | Joint bilateral filter guided by the frame: each mask pixel takes the mask of nearby pixels of similar colour, so the edge snaps to the outline. |

**Techniques**

- **Category mask:** the segmenter's per-pixel decision, person or background, so 0 or 1. The edge jumps by whole
  regions when a pixel near 0.5 flips.
- **Confidence mask:** the segmenter's per-pixel probability, 0 to 1. The edge moves by fractions of a pixel, and
  multiclass models work.
- **Box blur:** softens the mask before compositing, as the library does.
- **Motion-adaptive EMA:** blends each mask with the previous one, keeping 15% of the new mask where the picture is
  still and up to 90% where it moves, by comparing the frames. Still edges hold; moving ones follow.
- **Joint bilateral filter:** each mask pixel takes the mask of nearby pixels that look like it in the camera frame,
  so the edge snaps to the outline in the picture (hair, fingers).
- **Confidence as alpha:** blends frame and background by the probability itself instead of a smoothstep around 0.5.

**Strategies** (custom pipeline) are combinations of these, named by what they run, for example
"Confidence mask + box blur + motion-adaptive EMA + joint bilateral", which matches the library with all three
options on. Every pass and parameter can be edited per pane.

**Background**: a scenery photo (the default), blur, test patterns (stripes for edge errors, flat green for
leakage), your own image, or none. Your image stays in the browser like the camera picture.

**Models**: Selfie landscape and Selfie square (250 KB each), and Selfie multiclass as Google publishes it (15.6 MB,
float32) and converted to float16 (8.3 MB), to compare the two.

**Model switching** simulates a call that starts on the small model and upgrades to the multiclass one when the
device and the network allow it, with the conditions (CPU and GPU load, download speed, a corrupt download) under
your control.

## How to use it

1. Open **Compare**, pick **Webcam** (or a video file) and start it.
2. Choose 2 or 4 panes, an engine and a model for each. Pane A runs the library with its defaults, pane B with all three options
   on and the multiclass model.
3. Hold still, then move a hand: still edges should hold, moving ones should follow without trailing.
4. Use **A/B wipe** to compare two panes in one picture, or **Snapshot** and **Record** to save the output.

Chrome or Edge on a machine with a GPU gives the intended frame rates.

## Run locally

```sh
npm install
npm run dev    # http://127.0.0.1:5199/background-effects-playground/
```

`npm run build` writes the static site to `dist/`; `.github/workflows/pages.yml` publishes it on every push to `main`.

## Models and licenses

The code is licensed under the [Apache License 2.0](LICENSE).

The models are by Google, from [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter),
licensed under the Apache License 2.0:

- [Selfie Segmentation model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf):
  `selfie_segmenter_landscape.tflite` and `selfie_segmenter_square.tflite`, unmodified.
- [Multiclass Segmentation model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf):
  `selfie_multiclass_256x256_fp32.tflite` unmodified, and `selfie_multiclass_256x256_fp16.tflite`, a modified copy
  of it. Its float32 weights
  were converted to float16 with [`tools/fp16_convert.py`](tools/fp16_convert.py), which halves the download; the
  model converts them back to float32 when it loads.

The model cards list the uses the models are not meant for, such as identifying people or surveillance.

The background photos in `public/backgrounds/` are CC0 (public domain dedication), from Wikimedia Commons, resized.
Credits are in [NOTICE](NOTICE).
