export default {
  timeout: "2m",
  files: ["tests/**/*.test.ts"],
  extensions: ["ts"],
  require: ["esbuild-register"],
  ignoredByWatcher: [".next", ".nsm"],
}
