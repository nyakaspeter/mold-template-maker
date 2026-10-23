# Mold Template Maker

Turns an image or an STL into a 3D-printable template for making silicone molds.

1. **Image** – load a picture (PNG, JPEG, WebP, …) or an STL. For images, check the outline and paint to fix it:
   painting adds to the object, Shift + painting removes.
2. **Object** – the piece you want to cast, as a relief.
3. **Template** – print this, then fill it with silicone.
4. **Mold** – the cured silicone, turned over, ready for resin, plaster, soap or wax.

Each 3D stage can be downloaded as an STL. The app detects the kind of picture (line art, flat cartoon, shaded
render or painting, greyscale height map) and picks its settings; everything can be fine-tuned in the sidebar.
Available in English, German and Hungarian.

Everything runs in the browser; files are never uploaded. The 3D view uses [three.js](https://threejs.org), and depth
comes from [Depth Anything V2](https://huggingface.co/onnx-community/depth-anything-v2-small) via
[transformers.js](https://huggingface.co/docs/transformers.js), on the graphics card (WebGPU) when there is one,
otherwise on the CPU (downloaded once, then cached by the browser). On the graphics card a second, finer pass adds
small detail such as noses, eyes and hair. The *Depth model* setting chooses between
1: [Depth Anything V2 small](https://huggingface.co/onnx-community/depth-anything-v2-small) (default),
2: [Depth Anything V2 base](https://huggingface.co/onnx-community/depth-anything-v2-base) and
3: [Distill Any Depth base](https://huggingface.co/Ko033/distill-any-depth-base-onnx).

## Running it locally

It needs to be served over HTTP (the modules don't load from `file://`):

```bash
python3 -m http.server 8765
```

then open <http://localhost:8765>.

## Code

- `index.html`, `styles.css` – the page
- `js/app.js` – entry point: loading files, stages, rebuilding, languages
- `js/settings.js`, `js/i18n.js`, `js/state.js` – settings panel, translations, shared state
- `js/style.js`, `js/outline.js`, `js/relief.js`, `js/stl.js`, `js/depth.js` – image and STL → height map
- `js/grid.js`, `js/mesh.js`, `js/model.js` – height map → object, template and mold meshes
- `js/viewer.js`, `js/editor.js` – 3D view and STL export, outline painting
