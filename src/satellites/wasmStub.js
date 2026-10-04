/**
 * Stub for satellite.js' optional WASM runtimes (#wasm-single-thread / #wasm-multi-thread).
 * OrbitStudio uses only the pure-JS SGP4 API. The emscripten pthread build references itself via
 * `new Worker(new URL("index.js", import.meta.url))`, which makes Turbopack's production build
 * recurse; aliasing both imports here keeps them out of the bundle. Calling them fails loudly.
 */
export default function wasmRuntimeDisabled() {
  throw new Error('satellite.js WASM runtimes are disabled in OrbitStudio (pure-JS SGP4 is used).');
}
