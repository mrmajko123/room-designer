/* Entry for the bundled 3D engine (js/vendor/three.bundle.js). Rebuild with `npm run vendor`. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { USDZLoader } from 'three/addons/loaders/USDZLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as fflate from 'three/addons/libs/fflate.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import qrcode from 'qrcode-generator';
import { dracoWrapper, dracoWasm } from './.draco-embed.js';

// The Draco decoder is embedded so compressed scans open without loading extra files (also from file://).
function makeDracoLoader() {
  const d = new DRACOLoader();
  d._loadLibrary = (url, type) => {
    if (type === 'arraybuffer') {
      const bin = atob(dracoWasm);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return Promise.resolve(out.buffer);
    }
    return Promise.resolve(dracoWrapper);
  };
  return d;
}

window.THREE = Object.assign({}, THREE, {
  OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, RoomEnvironment,
  RoundedBoxGeometry, GLTFExporter, GLTFLoader, OBJLoader, MTLLoader, PLYLoader, STLLoader, USDZLoader,
  MeshoptDecoder, makeDracoLoader, mergeGeometries, fflate,
});
window.qrcode = qrcode;
