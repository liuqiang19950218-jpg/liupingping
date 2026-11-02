export const DIRECT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export function optimizationSteps(width, height) {
  const longSide = Math.max(width, height);
  return [4096, 3200, 2560].map((maxSide, index) => {
    const scale = Math.min(1, maxSide / longSide);
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: [0.96, 0.92, 0.88][index] };
  });
}

function browserAdapter(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({
      width: image.naturalWidth,
      height: image.naturalHeight,
      encode: ({ width, height, quality }) => new Promise((done) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) return done(null);
        context.fillStyle = "#fff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        canvas.toBlob(done, "image/webp", quality);
      }),
      dispose: () => URL.revokeObjectURL(url),
    });
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("图片无法解码，请选择正常图片文件。")); };
    image.src = url;
  });
}

export async function prepareAttachmentImage(file, decode = browserAdapter) {
  if (!file.size) throw new Error("图片文件不能为空。");
  if (file.size <= DIRECT_IMAGE_BYTES) return { file, optimized: false };
  if (file.size > MAX_IMAGE_BYTES) throw new Error("图片文件过大，请选择20MB以内的图片。");
  const image = await decode(file);
  try {
    let last = null;
    for (const step of optimizationSteps(image.width, image.height)) {
      const blob = await image.encode(step);
      if (!blob || !blob.size) throw new Error("图片优化失败，请重新选择图片。");
      last = blob;
      if (blob.size <= DIRECT_IMAGE_BYTES) break;
    }
    if (!last || last.size > MAX_IMAGE_BYTES) throw new Error("图片优化后仍超过20MB，请选择20MB以内的图片。");
    return { file: new File([last], "optimized-image.webp", { type: "image/webp" }), optimized: true };
  } finally {
    image.dispose?.();
  }
}
