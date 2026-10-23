# Mold Template Maker

Turns an image, STL or 3MF into a 3D-printable template for making silicone molds.

1. **Image** – load a picture (PNG, JPEG, WebP, …) or an STL/3MF model. For images, check the outline and paint to fix it:
   painting adds to the object, Shift + painting removes.
2. **Object** – the piece you want to cast, as a relief.
3. **Template** – print this, then fill it with silicone.
4. **Mold** – the cured silicone, turned over, ready for resin, plaster, soap or wax.

Each 3D stage can be downloaded as an STL. The app detects the kind of picture (line art, flat cartoon, shaded
render or painting, greyscale height map) and picks its settings; everything can be fine-tuned in the sidebar.

For an STL or 3MF, the app finds a flat back and puts it down. One without a flat back is cut into two halves (front and
back, where the object is widest): each gets its own mold, and the cast halves are glued together. The halves are cut
from the model itself with [manifold-3d](https://github.com/elalish/manifold), so the model must be watertight.
Optional alignment pins line them up: a printed lid with pegs, laid on the filled mold, forms matching holes in both
halves, and the pins are printed with the templates.

3MF imports combine printable build objects with their component transforms and convert model units to millimetres.
External component meshes in Bambu Studio and OrcaSlicer projects are supported.
Colours, textures and slicer settings are not used; downloads remain STL.

Model generation and AI depth estimation run in a background worker, so the current model stays interactive
while an update builds. Sliders preview their values while dragging and rebuild on release; pending updates
use the latest committed settings.

Available in English, German and Hungarian.

Everything runs in the browser; files are never uploaded. The 3D view uses [three.js](https://threejs.org), flat parts
are filled with [earcut](https://github.com/mapbox/earcut) to keep the downloads small, and depth
comes from [Depth Anything V2](https://huggingface.co/onnx-community/depth-anything-v2-small) via
[transformers.js](https://huggingface.co/docs/transformers.js), on the graphics card (WebGPU) when there is one,
otherwise on the CPU (downloaded once, then cached by the browser). On the graphics card a second, finer pass adds
small detail such as noses, eyes and hair. The *Depth model* setting chooses between
[Depth Anything V2 (small)](https://huggingface.co/onnx-community/depth-anything-v2-small),
[Depth Anything V2](https://huggingface.co/onnx-community/depth-anything-v2-base) (base size) and
[Distill Any Depth](https://huggingface.co/Ko033/distill-any-depth-base-onnx) (base size).

## Running it locally

It needs to be served over HTTP (the modules don't load from `file://`):

```bash
python3 -m http.server 8765
```

then open <http://localhost:8765>.

## Code

- `index.html`, `styles.css` – the page
- `js/app.js` – entry point: loading files, stages, rebuilding, languages
- `js/build-client.js`, `js/build-worker.js` – queued background builds and AI depth estimation
- `js/settings.js`, `js/i18n.js`, `js/state.js` – settings panel, translations, shared state
- `js/style.js`, `js/outline.js`, `js/relief.js`, `js/stl.js`, `js/depth.js` – image and STL → height map
- `js/three-mf.js` – 3MF build → triangle mesh
- `js/exact.js` – STL halves cut from the model itself (3D booleans)
- `js/grid.js`, `js/mesh.js`, `js/model.js` – height map → object, template and mold meshes
- `js/viewer.js`, `js/editor.js`, `js/orient.js` – 3D view and STL export, outline painting, the small 3D view for
  turning an STL
- `demo-heart.png`, `demo-owl.png`, `demo-medallion.stl`, `demo-duck.stl` – the demos: a height map, a drawing, a
  flat-backed STL and a round one that gets cut in two
