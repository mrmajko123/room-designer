# Room Designer

Design your room in 3D: set your room's real size, build the walls from photos, paint them, add LEDs,
shelves, closets and furniture, and scan your own things with your phone so the room looks like yours.

**[Download the latest version](https://github.com/mrmajko123/room-designer/releases/latest)** for
Windows, Mac, Linux, Android or iPhone (or the web version, no install).

## What you can do

- **Real sizes.** Rectangle, L-shaped or any shape room. Type the wall lengths (`3.5m`, `350`, `11' 6"`)
  or drag the corners in the plan view. Set the ceiling height, add doors and windows.
- **Build the room from photos.** Take a photo of each wall, drag four dots onto the wall's corners and
  Room Designer straightens the photo, works out how long the wall is (from the ceiling height and the
  perspective in the photo) and puts it on the 3D wall. Or just copy the wall's colour.
- **Paint and decorate.** Tap a wall to paint it. Brick, panelling, wood slats and stripes. Wood,
  herringbone, carpet, tile or concrete floors.
- **LEDs.** LED strips with effects, an LED strip around the whole room, neon signs with your own text,
  hexagon lights, fairy lights and lamps. Switch to night (moon button) to see them glow.
- **Furniture and storage.** Beds, desks, chairs, sofas, closets, drawers, shelves, TVs, gaming PCs,
  rugs, plants, posters with your own pictures and more. Every size and colour can be changed.
- **Your own stuff, scanned with your phone.** See below.
- **Look around.** 3D view (the walls in front hide themselves), a plan view with measurements, and a
  walk-around view. Drag things to move them; they snap against walls and stand on desks and shelves.
- Undo/redo, several rooms, save a picture, export a 3D model (`.glb`), save and open room files.

## Scanning your things with your phone

1. In the **desktop app**, open **Add → My stuff → Scan my stuff → Scan with your phone**. A QR code appears.
2. Scan it with your phone's camera (the phone must be on the same Wi-Fi as the computer). A scan page
   opens on the phone. It talks straight to your computer over Wi-Fi; nothing goes through the internet.
3. Choose **3D scan**: scan the item with a free 3D scanner app such as
   [Scaniverse](https://scaniverse.com), [Polycam](https://poly.cam) or
   [KIRI Engine](https://www.kiriengine.app), export it as GLB (or OBJ / USDZ / PLY / STL) and send it.
   Or choose **Quick scan with photos** and take a photo of the front, side and top.
4. On the computer, check the scan: set its real width, depth and height, stand it the right way up and
   name it. Then it goes into **My stuff** and into your room.

On a phone (the Android/iPhone app or the web version) you can open a 3D scan file or take the photos
directly, no QR code needed. In a desktop browser, open a 3D scan file you copied to the computer.

Your rooms, photos and scans are saved on your device only.

## Making a new release

Every push to GitHub runs `.github/workflows/release.yml`. When the version in `package.json` has not
been released yet, it runs the tests, builds the Windows installer, Mac disk images, Linux AppImage and
.deb, Android APK, iPhone IPA (unsigned) and a web zip, and publishes them as a GitHub Release.

```bash
node scripts/bump.js patch
```

Then describe the changes in `CHANGELOG.md` (that text becomes the release notes), commit and push.
Use `minor` instead of `patch` for big updates.

## Running it yourself

No build step: it's plain HTML, CSS and JavaScript.

```bash
npm install
npm start
```

Then open http://localhost:8080. Tests (needs Playwright's Chromium):

```bash
npm test
```

The desktop app (with the phone link) runs with:

```bash
cd desktop && npm install && npm start
```

`js/vendor/three.bundle.js` contains [three.js](https://threejs.org), its loaders, the Draco decoder and
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), bundled by `npm run vendor`.

## License

MIT
