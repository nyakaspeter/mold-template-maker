// What is loaded and how far it has got, shared by the modules.
export const S = {
  kind: null, img: null, geom: null, name: '', // the loaded file
  ai: null, aiFailed: false, // AI depth map for the image, worked out once per image
  auto: null, method: 'cartoon', // detected style: preset settings and how to turn it into 3D
  edit: null, editUsed: false, editDirty: false, // painted outline edits
  building: false, // a build is pending or running
};
