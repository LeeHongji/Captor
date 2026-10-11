import fs from "node:fs/promises";
import { chromium } from "@playwright/test";

// All runtime and installer mirrors come from this editable vector source.
const svg = await fs.readFile("branding/source-assets/Captor.svg", "utf8");
const browser = await chromium.launch();
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const pngs = new Map();
try {
	const page = await browser.newPage();
	for (const size of sizes) {
		await page.setViewportSize({ width: size, height: size });
		await page.setContent(
			`<style>body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`,
		);
		const png = await page.screenshot({ omitBackground: true });
		pngs.set(size, png);
		for (const stem of ["captor", "captormac"])
			await fs.writeFile(`public/app-icons/${stem}-${size}.png`, png);
		if (size !== 24 && size !== 48) {
			await fs.writeFile(`branding/source-assets/${size}-mac.png`, png);
			await fs.writeFile(`icons/icons/png/${size}x${size}.png`, png);
		}
	}
} finally {
	await browser.close();
}
await fs.writeFile("branding/source-assets/captorgeneric.svg", svg);
await fs.writeFile("branding/source-assets/captormac.png", pngs.get(1024));
const chunks = [
	[16, "icp4"],
	[32, "icp5"],
	[64, "icp6"],
	[128, "ic07"],
	[256, "ic08"],
	[512, "ic09"],
	[1024, "ic10"],
].map(([size, type]) => {
	const png = pngs.get(size);
	const header = Buffer.alloc(8);
	header.write(type);
	header.writeUInt32BE(png.length + 8, 4);
	return Buffer.concat([header, png]);
});
const icns = Buffer.alloc(8);
icns.write("icns");
icns.writeUInt32BE(
	chunks.reduce((n, b) => n + b.length, 8),
	4,
);
await fs.writeFile("icons/icons/mac/icon.icns", Buffer.concat([icns, ...chunks]));
const icoSizes = [16, 32, 48, 64, 128, 256];
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(icoSizes.length, 4);
let offset = 6 + icoSizes.length * 16;
const entries = icoSizes.map((size) => {
	const png = pngs.get(size);
	const entry = Buffer.alloc(16);
	entry[0] = entry[1] = size === 256 ? 0 : size;
	entry.writeUInt16LE(1, 4);
	entry.writeUInt16LE(32, 6);
	entry.writeUInt32LE(png.length, 8);
	entry.writeUInt32LE(offset, 12);
	offset += png.length;
	return entry;
});
await fs.writeFile(
	"icons/icons/win/icon.ico",
	Buffer.concat([icoHeader, ...entries, ...icoSizes.map((size) => pngs.get(size))]),
);
console.log("Updated Captor icons (PNG, ICNS, ICO) from Captor.svg.");
