/* Room Designer: ready-made rooms you can start from (Your rooms → New room). Plain data, so the same file
 * also builds the downloadable .room files (scripts/make-rooms.js). */
(function (root) {
  const T = {};

  /**
   * Attic room, from the owner's measurements (looking at wall 1 you face 135° SE):
   * - left wall (wall 4): 152 cm from the back-left corner to the door, door 96.5 cm, then 338 cm to the
   *   front-left corner = 586.5 cm; the right wall (wall 2) is the same length; front and back 418 cm
   * - front and back walls are 107 cm high; the ceiling rises from them to 262 cm, reaching the top 179 cm
   *   (measured along the floor) from each of them, with a flat strip in the middle
   * - right wall: two 99 cm windows with 32.5 cm of wall between them, starting about 173-179 cm from the
   *   front and the back (the two measurements differ by 4 cm, so the windows sit half way between them)
   * Not measured, so typical values are used: door 205 cm high; windows 130 cm high, 90 cm off the floor.
   */
  T.attic = {
    title: 'My attic room',
    description: '418 × 586.5 cm, ceiling sloping from 107 cm walls up to 262 cm, door and 2 windows',
    project: {
      name: 'My attic room',
      version: 1,
      room: {
        shape: 'rect',
        points: [[0, 0], [418, 0], [418, 586.5], [0, 586.5]],
        height: 262,
        thickness: 12,
        facing: 135,
        walls: [
          { finish: 'paint', color: '#f4f1ea', slope: { knee: 107, run: 179 } }, // 1: front (low wall)
          { finish: 'paint', color: '#f4f1ea' }, // 2: right, with the windows
          { finish: 'paint', color: '#f4f1ea', slope: { knee: 107, run: 179 } }, // 3: back (low wall)
          { finish: 'paint', color: '#f4f1ea' }, // 4: left, with the door
        ],
        floor: { type: 'wood', color: '#b98a5a' },
        ceiling: { color: '#ffffff' },
        led: { on: false, color: '#9b5cff', mode: 'solid', where: 'ceiling', brightness: 1 },
      },
      openings: [
        // door: starts 152 cm from the back-left corner
        { id: 'attic-door', type: 'door', wall: 3, along: 152 + 96.5 / 2, width: 96.5, height: 205, sill: 0, color: '#f4f1ea' },
        // windows: 99 cm, 32.5 cm of wall between them, from 175 cm after the front corner
        { id: 'attic-win-1', type: 'window', wall: 1, along: 175 + 99 / 2, width: 99, height: 130, sill: 90, color: '#ffffff' },
        { id: 'attic-win-2', type: 'window', wall: 1, along: 175 + 99 + 32.5 + 99 / 2, width: 99, height: 130, sill: 90, color: '#ffffff' },
      ],
      items: [
        { id: 'attic-light', type: 'ceilingLight', name: 'Ceiling light', w: 40, d: 40, h: 10, color: '#ffffff', color2: '#ffffff', mount: 'ceiling', x: 209, z: 293.25, rot: 0, y: 0, opts: { on: true } },
      ],
      photos: [],
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = T;
  else (root.RD = root.RD || {}).templates = T;
})(typeof window !== 'undefined' ? window : globalThis);
