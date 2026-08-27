import esbuild from "esbuild";

const production = process.argv.includes("--production");
const shared = {
  bundle: true,
  sourcemap: !production,
  minify: production,
  platform: "node",
  // Playwright dynamically loads optional protocol implementations; retain it as a runtime dependency.
  external: ["vscode", "playwright"],
  logLevel: "info",
};

const extension = await esbuild.context({ ...shared, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js", format: "cjs" });
const webview = await esbuild.context({ ...shared, entryPoints: ["src/webview/main.ts"], outfile: "dist/webview.js", platform: "browser", format: "iife" });
const settings = await esbuild.context({ ...shared, entryPoints: ["src/settings/main.ts"], outfile: "dist/settings.js", platform: "browser", format: "iife" });

if (production) {
  await Promise.all([extension.rebuild(), webview.rebuild(), settings.rebuild()]);
  await Promise.all([extension.dispose(), webview.dispose(), settings.dispose()]);
} else {
  await Promise.all([extension.watch(), webview.watch(), settings.watch()]);
  console.log("Watching for changes...");
}
