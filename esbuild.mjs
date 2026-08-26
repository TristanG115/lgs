import esbuild from "esbuild";

const production = process.argv.includes("--production");
const shared = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  platform: "node",
  external: ["vscode"],
  logLevel: "info",
};

const extension = await esbuild.context({ ...shared, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js", format: "cjs" });
const webview = await esbuild.context({ ...shared, entryPoints: ["src/webview/main.ts"], outfile: "dist/webview.js", platform: "browser", format: "iife" });

if (production) {
  await Promise.all([extension.rebuild(), webview.rebuild()]);
  await Promise.all([extension.dispose(), webview.dispose()]);
} else {
  await Promise.all([extension.watch(), webview.watch()]);
  console.log("Watching for changes...");
}
