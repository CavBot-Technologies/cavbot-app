import { promises as fs } from "node:fs";
import path from "node:path";

const PNG_1X1_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5n7xQAAAAASUVORK5CYII=";
const JPG_1X1_BASE64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFhUVFRUVFRUVFRUVFRUVFhUXFhUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGhAQGi0lHyYtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAEAAgMBAQAAAAAAAAAAAAAABAUBAwYCB//EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAdYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/Z";

type Args = {
  outDir: string;
  rootName: string;
  manyCount: number;
  deepLevels: number;
};

function parseArgs(argv: string[]): Args {
  let outDir = path.resolve(process.cwd(), "tmp/upload-fixture");
  let rootName = "Root";
  let manyCount = 200;
  let deepLevels = 15;

  for (const arg of argv) {
    if (arg.startsWith("--out=")) outDir = path.resolve(process.cwd(), arg.slice("--out=".length));
    if (arg.startsWith("--root=")) rootName = arg.slice("--root=".length).trim() || rootName;
    if (arg.startsWith("--many=")) {
      const n = Number(arg.slice("--many=".length));
      if (Number.isFinite(n) && Number.isInteger(n) && n > 0) manyCount = n;
    }
    if (arg.startsWith("--depth=")) {
      const n = Number(arg.slice("--depth=".length));
      if (Number.isFinite(n) && Number.isInteger(n) && n > 0) deepLevels = n;
    }
  }

  return { outDir, rootName, manyCount, deepLevels };
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeText(filePath: string, content: string) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}

async function writeBinary(filePath: string, buf: Buffer) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, buf);
}

async function findSampleMp4(): Promise<string | null> {
  const candidates = [
    path.resolve(process.cwd(), "public/cavbot-arcade/entertainment/main-preview.mp4"),
    path.resolve(process.cwd(), "public/cavbot-arcade/entertainment/catch-cavbot/v1/files/assets/preview.mp4"),
  ];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile() && stat.size > 0) return candidate;
    } catch {
      // ignore
    }
  }

  return null;
}

async function buildFixture(args: Args) {
  const root = path.join(args.outDir, args.rootName);
  await fs.rm(root, { recursive: true, force: true });
  await ensureDir(root);

  await writeText(path.join(root, "a.txt"), "CavCloud folder upload fixture.\n");

  await writeBinary(path.join(root, "images/logo.png"), Buffer.from(PNG_1X1_BASE64, "base64"));
  await writeBinary(path.join(root, "images/nested/deep.jpg"), Buffer.from(JPG_1X1_BASE64, "base64"));

  const sampleMp4 = await findSampleMp4();
  if (sampleMp4) {
    await ensureDir(path.join(root, "videos"));
    await fs.copyFile(sampleMp4, path.join(root, "videos/clip.mp4"));
  } else {
    await writeText(path.join(root, "videos/clip.mp4"), "placeholder mp4 bytes");
  }

  for (let i = 1; i <= args.manyCount; i += 1) {
    const name = `file-${String(i).padStart(4, "0")}.txt`;
    await writeText(path.join(root, "many", name), `many-${i}\n`);
  }

  let deepPath = path.join(root, "deep");
  for (let level = 1; level <= args.deepLevels; level += 1) {
    deepPath = path.join(deepPath, `level${level}`);
  }
  await writeText(path.join(deepPath, "file.txt"), "deep nested file\n");

  return root;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = await buildFixture(args);
  console.log(JSON.stringify({
    ok: true,
    fixtureRoot: root,
    manyCount: args.manyCount,
    deepLevels: args.deepLevels,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message || err) }));
  process.exitCode = 1;
});
