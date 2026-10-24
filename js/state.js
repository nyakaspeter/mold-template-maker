// What is loaded and how far it has got, shared by the modules.
export const S = {
  kind: null, img: null, geom: null, name: '', // the loaded file
  auto: null, method: 'cartoon', type: null, // detected style: preset settings, how to turn it into 3D, picture type
  scene: 0, aiCutout: false, transparent: false, // how busy the picture's edge is, whether the subject is cut out by
  // AI, and whether the picture has its own transparent outline
  gpu: false, // AI runs on the graphics card (WebGPU)
  shading: 0, // share of soft gradients inside the picture's shape (see style.js)
  edit: null, editUsed: false, editDirty: false, editVersion: 0, // painted outline edits (the version counts changes)
  building: false, // a build is pending or running
  shownSource: null, // which loaded file the model on show was built from
};
