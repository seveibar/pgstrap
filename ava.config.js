export default {
  timeout: "2m",
  files: ["test/**/*.test.ts"],
  extensions: ["ts"],
  require: ["esbuild-register"],
  ignoredByWatcher: [".next", ".nsm"],
}
