/** A WebAssembly file imported by the Worker (wrangler bundles it as a compiled module). */
declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}
