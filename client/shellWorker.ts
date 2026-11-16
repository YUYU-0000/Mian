import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

// 在产物落盘后收集全部分块和字体，未打开过的页面也能离线进入。
export function shellWorker(): Plugin {
  let output: string;
  return {
    name: "mian-offline-shell",
    apply: "build",
    enforce: "post",
    configResolved(config) { output = path.resolve(config.root, config.build.outDir); },
    generateBundle(_options, bundle) {
      const html = bundle["index.html"];
      if (html.type !== "asset") return;
      // CSS 引用的分片字体会带构建哈希，preload 必须指向同一份文件。
      for (const asset of Object.values(bundle)) {
        if (asset.type !== "asset" || !asset.fileName.endsWith(".woff2")) continue;
        for (const original of asset.originalFileNames) {
          const font = original.replaceAll("\\", "/").match(/fonts\/.+\.woff2$/)?.[0];
          if (font) html.source = String(html.source).replaceAll(`href="/${font}"`, `href="/${asset.fileName}"`);
        }
      }
    },
    async closeBundle() {
      const files = (await readdir(output, { recursive: true, withFileTypes: true }))
        .filter(entry => entry.isFile() && entry.name !== "sw.js")
        .map(entry => path.relative(output, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
        .sort();
      const hash = createHash("sha256");
      for (const file of files) hash.update(await readFile(path.join(output, file)));
      const source = await readFile(new URL("./sw.js", import.meta.url), "utf8");
      hash.update(source);
      await writeFile(path.join(output, "sw.js"), source
        .replace("__MIAN_VERSION__", hash.digest("hex").slice(0, 16))
        .replace("__MIAN_ASSETS__", JSON.stringify(files.map(file => `/${file}`))));
    },
  };
}
