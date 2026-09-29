/**
 * PDF.js worker asset-bundle entry: `lib/assets/pdfjs-worker.js`, served by
 * the plugin's node-half route and referenced as
 * `GlobalWorkerOptions.workerSrc` by the viewer (NOT script-injected —
 * pdf.js instantiates it as a Worker script itself). Bundled as an IIFE so
 * the module-syntax worker source runs in a classic Worker.
 * @module @changfenhuang/dsh-genui/client/asset-pdfjs-worker
 */
import 'pdfjs-dist/build/pdf.worker.mjs'
