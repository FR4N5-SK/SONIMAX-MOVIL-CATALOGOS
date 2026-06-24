const sharp = require("sharp")
const path = require("path")
const fs = require("fs")

const SOURCE = "logo 1024x1024.png"
const SIZES = [
  { dir: "mipmap-mdpi", size: 48 },
  { dir: "mipmap-hdpi", size: 72 },
  { dir: "mipmap-xhdpi", size: 96 },
  { dir: "mipmap-xxhdpi", size: 144 },
  { dir: "mipmap-xxxhdpi", size: 192 },
]
const BASE = path.join("android", "app", "src", "main", "res")

async function run() {
  for (const { dir, size } of SIZES) {
    const outDir = path.join(BASE, dir)
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

    // Normal
    await sharp(SOURCE)
      .resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toFile(path.join(outDir, "ic_launcher.png"))

    // Round
    const half = size / 2
    const circle = Buffer.from(
      `<svg><circle cx="${half}" cy="${half}" r="${half}"/></svg>`
    )
    await sharp(SOURCE)
      .resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .composite([{ input: circle, blend: "dest-in" }])
      .png()
      .toFile(path.join(outDir, "ic_launcher_round.png"))

    // Foreground
    await sharp(SOURCE)
      .resize(size, size, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toFile(path.join(outDir, "ic_launcher_foreground.png"))

    console.log(`✅ ${dir} ${size}px`)
  }
  console.log("🎉 Íconos generados con tu logo real")
}

run().catch((e) => {
  console.error("Error:", e)
  process.exit(1)
})
