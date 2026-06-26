import * as esbuild from "esbuild";
import fs from "node:fs";

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production") || !watch;

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: !production,
  minify: production,
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ["src/webview/index.tsx"],
  bundle: true,
  outfile: "dist/webview.js",
  format: "iife",
  platform: "browser",
  target: "es2021",
  sourcemap: !production,
  minify: production,
  define: { "process.env.NODE_ENV": production ? '"production"' : '"development"' },
};

fs.mkdirSync("dist", { recursive: true });
fs.copyFileSync("src/webview/webview.css", "dist/webview.css");

if (watch) {
  const ctxs = await Promise.all([
    esbuild.context(extensionConfig),
    esbuild.context(webviewConfig),
  ]);
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log("watching...");
} else {
  await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
  console.log("build done");
}
