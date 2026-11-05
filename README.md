# Mold Template Maker

Turns an image, STL or 3MF into a 3D-printable template for making silicone molds.

1. **Image** – load a picture (PNG, JPEG, WebP, SVG, …) or an STL/3MF model. For images, check the outline and paint to fix it:
   painting adds to the object, Shift + painting removes.
2. **Object** – the piece you want to cast, as a relief.
3. **Template** – print this, then fill it with silicone.
4. **Mold** – the cured silicone, turned over, ready for resin, plaster, soap or wax.

Each 3D stage can be downloaded as an STL. The app detects the kind of picture (photo, 3D render, painting,
flat cartoon, line art, greyscale height map) and picks its settings; everything can be fine-tuned in the sidebar.
Photos, and pictures without a plain backdrop, are cut out of their background with an AI model
([U²-Net](https://huggingface.co/BritishWerewolf/U-2-Net), edges refined with a guided filter); other pictures use the
plain background colour.

A flat-back object (a picture, or an STL that isn't cut) can get a hanger loop: a ring on a short stem from the top of
the outline, above the object's balance point so the cast hangs straight, as thick as the back plate (at least 2 mm).
Its size is the hole's diameter; the silicone fills the hole, which keeps it open in the cast. Hanger thickness sets how
wide the ring is around the hole (2.5 mm by default), and Balance offset moves it sideways, in % of the object's width.

For an STL or 3MF, the *Mold type* setting picks between three molds. Auto finds a flat back and puts it down in an
Open mold; one without a flat back but with a flat bottom (a figure on a base) gets a Two-part mold, described below,
and anything else gets Glued halves: it is cut into two halves (front and back, where the object is widest), each gets
its own mold, and the cast halves are glued together. Each kind of mold (and pictures) remembers its own mold template
settings. The halves are cut from the model itself with [manifold-3d](https://github.com/elalish/manifold), so the
model must be watertight.
Optional alignment pins line them up: a printed lid with pegs, laid on the filled mold, forms matching holes in both
halves, and the pins are cast with the halves, lying side by side in channels on a tab added to the bottom of the first
half's mold. Each channel is formed by a pin-sized rod lying on the template's floor, sunk into it by half its radius,
so the channel wraps a little past the pin's middle: the cast pin is round but for a narrow flat along its top, still
fits the round holes, and the silicone bends enough to let it out. Lids include a locating lip:
3 mm deep, 1.2 mm wall, with 0.4 mm clearance and a tapered entrance around the silicone.
The lid plate shares the Base thickness setting (2 mm by default). Each half-template and lid is fused into
one solid, so a slicer’s Split to objects keeps each template, lid and loose pin intact.
Halves can also be cast hollow, like a chocolate egg: with Hollow cast set to a wall thickness instead of Solid, each
lid carries a core in the half’s shape, shrunk by that wall, which is pressed into the filled mold. The core rises
straight from the lid, so it pulls out of the set cast; where a half curves back in, the wall is thicker there. Its
vents sit over the wall.

With “Mold type” set to Two-part mold, only the mold is cut: both halves’ molds take the whole object’s outline, and
the two silicone halves are pressed together face to face and filled as one, so the cast comes out whole. Alignment
keys line them up: balls (4 of 3 mm by default) that are bumps on one half and hollows in the other, each placed only
where the silicone has room for it (1 mm all round) and spread as far apart as they can be. A two-part mold has a 6 mm
silicone rim and a 4 mm base by default; the keys' hollows are sunk into the base, so with a base thinner than half a
key plus 0.9 mm there are no keys. A flat bottom is the
opening (within 0.3 mm of flat and at least 30 mm², the same test Auto uses): Auto lays the object down with its
largest flat bottom at the front, and the mold ends there, so it is poured through the bottom and the pour mark ends up
there. An object without such a bottom at the edge gets a pour hole instead (6 mm by default), from the lowest point of
the cut to the side of the mold, half in each face, widening into a funnel.

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
[Depth Anything V2 Small](https://huggingface.co/onnx-community/depth-anything-v2-small) and the sculpted
[MoGe-2 Small](https://huggingface.co/Ruicheng/moge-2-vits-normal-onnx) ([MoGe](https://github.com/microsoft/MoGe),
run with [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)); *Auto* picks by picture type. MoGe-2
estimates the surface itself (3D points and normals), and the picture is sculpted from it as a bas-relief:
overlapping parts get a step of their own, and the overall depth is flattened while curvature and ornament keep their
shape (*Flattening*, *Overlap steps*). On the graphics card MoGe also runs on tiles of the picture, and Depth Anything
adds the finest detail (*Fine detail*). Models that fail on the graphics card run again on the CPU.

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
- `js/sculpt.js` – MoGe-2 surface → sculpted bas-relief
- `js/matte.js` – refining the AI cut-out at full resolution
- `js/three-mf.js` – 3MF build → triangle mesh
- `js/exact.js` – STL halves cut from the model itself (3D booleans)
- `js/grid.js`, `js/mesh.js`, `js/model.js` – height map → object, template and mold meshes
- `js/viewer.js`, `js/editor.js`, `js/orient.js` – 3D view and STL export, outline painting, the small 3D view for
  turning an STL
- `demo-heart.png`, `demo-owl.png`, `demo-medallion.stl`, `demo-duck.stl` – the demos: a height map, a drawing, a
  flat-backed STL and a round one that gets cut in two
