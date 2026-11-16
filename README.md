# Background Effects Playground

Camera background blur in the browser, side by side: segmentation models, mask strategies, and
[`@livekit/track-processors`](https://github.com/livekit/track-processors-js) as it is today next to a build
with the changes proposed upstream.

**Try it:** https://abhinavkrin.github.io/background-effects-playground/

Everything runs on your device. The camera picture never leaves the browser tab: segmentation and rendering run
locally on the GPU through MediaPipe and WebGL, and the page has no server beyond the static files.

## What you can compare

**Engines** (per pane)

| Engine | What it runs |
| --- | --- |
| Library main | `@livekit/track-processors` from upstream `main` (0.8.3 and the blend fix from [#157](https://github.com/livekit/track-processors-js/pull/157)), built into `vendor/` and driven as an app drives it: `setProcessor(BackgroundProcessor(...))` on a `LocalVideoTrack`. |
| Library, proposed | The same library with the options proposed in [livekit/track-processors-js#159](https://github.com/livekit/track-processors-js/pull/159) and two follow-ups, each a toggle on the pane: `segmentationMask` (`'category'` or `'confidence'`), `temporalSmoothing` and `edgeRefinement`. Built from those branches into `vendor/`. |
| Editable pipeline | The library's WebGL pipeline split into passes you can reorder, turn off and tune live, with debug views of the raw and refined masks. |

**Strategies** (editable pipeline)

| Strategy | What it does |
| --- | --- |
| Confidence mask, motion-adaptive blend, edge refinement | The proposed build with all three options on. |
| Category mask, box blur (current library) | The model's foreground or background decision, a hard cut at 0.5. |
| Confidence mask, box blur | The per-pixel probability in place of the decision, nothing else. |
| Confidence as opacity | Frame and background blended by the probability itself, with no cut at 0.5. |
| Confidence mask, motion-adaptive blend | Each mask blended with the previous one, more where the picture is still. |
| Confidence mask, edge refinement | A joint bilateral filter that moves the mask's edge onto the edge in the picture. |
| Confidence mask, fixed blend, edge refinement | The temporal blend at a fixed weight, for comparison with the adaptive one. |
| Confidence mask, motion-adaptive blend, edge floor (#135) | [livekit/track-processors-js#135](https://github.com/livekit/track-processors-js/pull/135) as written. |

**Models**: Selfie landscape and Selfie square (250 KB each), and Selfie multiclass (8.3 MB, float16).

**Model switching** simulates a call that starts on the small model and upgrades to the multiclass one when the
device and the network allow it, with the conditions (CPU and GPU load, download speed, a corrupt download) under
your control.

## How to use it

1. Open **Compare**, pick **Webcam** (or a video file) and start it.
2. Choose 2 or 4 panes, an engine and a model for each. Pane A runs the library as it is, pane B the proposed build.
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
  `selfie_multiclass_256x256_fp16.tflite` is a modified copy of `selfie_multiclass_256x256`. Its float32 weights
  were converted to float16 with [`tools/fp16_convert.py`](tools/fp16_convert.py), which halves the download; the
  model converts them back to float32 when it loads.

The model cards list the uses the models are not meant for, such as identifying people or surveillance. See
[NOTICE](NOTICE).
