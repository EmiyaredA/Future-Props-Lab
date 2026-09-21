import { initializeCanvas, writePsdBuffer, type Layer } from "ag-psd";
initializeCanvas(
  () => {
    throw new Error("Fixture must use pixel data");
  },
  (width, height) =>
    ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    }) as ImageData,
);
export function characterPsd(unsupported = false) {
  const raster = (
    width: number,
    height: number,
    color: number[],
    shape: (x: number, y: number) => boolean,
  ) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (shape(x, y)) data.set(color, (y * width + x) * 4);
    return { width, height, data };
  };
  const layers: Layer[] = [
    {
      name: "白大褂",
      left: 44,
      top: 158,
      imageData: raster(
        168,
        145,
        [231, 238, 240, 255],
        (x, y) => Math.abs(x - 84) < 55 + y * 0.18,
      ),
    },
    {
      name: "红棕发",
      left: 49,
      top: 22,
      imageData: raster(
        158,
        206,
        [150, 65, 30, 255],
        (x, y) => (x - 79) ** 2 / 6200 + (y - 108) ** 2 / 11664 < 1,
      ),
    },
    {
      name: "脸部",
      left: 76,
      top: 63,
      imageData: raster(
        104,
        115,
        [255, 223, 196, 255],
        (x, y) => (x - 52) ** 2 / 2704 + (y - 55) ** 2 / 3300 < 1,
      ),
    },
    {
      name: "双眼",
      left: 94,
      top: 111,
      imageData: raster(68, 13, [106, 83, 143, 255], (x) => x < 16 || x > 51),
    },
    {
      name: "嘴部",
      left: 110,
      top: 149,
      imageData: raster(36, 8, [176, 67, 78, 255], (_, y) => y > 2 && y < 6),
    },
    {
      name: "红领带",
      left: 121,
      top: 185,
      imageData: raster(14, 105, [184, 38, 54, 255], () => true),
    },
  ];
  if (unsupported) layers[0].blendMode = "multiply";
  return writePsdBuffer({
    width: 256,
    height: 320,
    children: [{ name: "角色图层", children: layers }],
  });
}

export function maskedPsd() {
  const red = new Uint8ClampedArray(64 * 64 * 4),
    mask = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      red.set([240, 30, 20, 255], (y * 64 + x) * 4);
      mask.set([0, 0, 0, x < 32 ? 255 : 0], (y * 64 + x) * 4);
    }
  return writePsdBuffer({
    width: 128,
    height: 128,
    children: [
      {
        name: "红色部件",
        left: 32,
        top: 32,
        imageData: { width: 64, height: 64, data: red },
      },
      {
        name: "黑色透明遮罩",
        left: 32,
        top: 32,
        hidden: true,
        imageData: { width: 64, height: 64, data: mask },
      },
    ],
  });
}
