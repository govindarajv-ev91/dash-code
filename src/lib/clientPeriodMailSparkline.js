// Small, indexed PNG line charts work in both browser previews and inline email
// attachments. No remote chart service or Apps Script chart API is required.
export function clientPeriodSparklinePng(values) {
  const width = 96, height = 28, stride = width / 8
  const pixels = new Uint8Array(height * stride)
  const low = Math.min(...values), high = Math.max(...values)
  const points = values.map((value, index) => [
    Math.round(3 + index * (width - 7) / Math.max(1, values.length - 1)),
    Math.round(high === low ? height / 2 : 3 + (high - value) / (high - low) * (height - 7)),
  ])
  const plot = (x, y) => {
    if (x >= 0 && x < width && y >= 0 && y < height) pixels[y * stride + (x >> 3)] |= 128 >> (x % 8)
  }
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i], [endX, endY] = points[i + 1] || points[i]
    const steps = Math.max(Math.abs(endX - x), Math.abs(endY - y), 1)
    for (let step = 0; step <= steps; step++) {
      const px = Math.round(x + (endX - x) * step / steps), py = Math.round(y + (endY - y) * step / steps)
      plot(px, py); plot(px, py + 1)
    }
  }
  const raw = []
  for (let y = 0; y < height; y++) raw.push(0, ...pixels.slice(y * stride, (y + 1) * stride))
  const word = (value) => [value >>> 24 & 255, value >>> 16 & 255, value >>> 8 & 255, value & 255]
  const crc = (bytes) => {
    let result = 0xffffffff
    for (const byte of bytes) {
      result ^= byte
      for (let bit = 0; bit < 8; bit++) result = result >>> 1 ^ (result & 1 ? 0xedb88320 : 0)
    }
    return word((result ^ 0xffffffff) >>> 0)
  }
  const chunk = (name, data) => {
    const content = [...Array.from(name, (char) => char.charCodeAt(0)), ...data]
    return [...word(data.length), ...content, ...crc(content)]
  }
  let a = 1, b = 0
  for (const byte of raw) { a = (a + byte) % 65521; b = (b + a) % 65521 }
  const length = raw.length, inverse = length ^ 65535
  const compressed = [120, 1, 1, length & 255, length >> 8, inverse & 255, inverse >> 8, ...raw, ...word((b << 16 | a) >>> 0)]
  const png = [137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk('IHDR', [...word(width), ...word(height), 1, 3, 0, 0, 0]),
    ...chunk('PLTE', [15, 23, 42, 56, 189, 248]), ...chunk('tRNS', [0, 255]),
    ...chunk('IDAT', compressed), ...chunk('IEND', [])]
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let base64 = ''
  for (let i = 0; i < png.length; i += 3) {
    const value = png[i] << 16 | (png[i + 1] || 0) << 8 | (png[i + 2] || 0)
    base64 += alphabet[value >>> 18] + alphabet[value >>> 12 & 63] +
      (i + 1 < png.length ? alphabet[value >>> 6 & 63] : '=') + (i + 2 < png.length ? alphabet[value & 63] : '=')
  }
  return `data:image/png;base64,${base64}`
}
