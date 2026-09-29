#!/usr/bin/env node
/**
 * Copy pdf.js packed CMap files (`cmaps/*.bcmap`) into the served asset
 * directory (`lib/assets/cmaps/`). The PDF.js asset needs them for CJK
 * standards PDFs whose fonts reference non-embedded CMaps — 水利规程 PDF
 * 常见；缺失表现为中文乱码（spec: original-doc-viewer-spec.md §5 风险登记）。
 *
 * Runs after tsdown in the `build` script (clean.mjs wipes lib, so the copy
 * must re-run every build). Idempotent: wipes the target dir first.
 */
import { cpSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(projectRoot, 'node_modules', 'pdfjs-dist', 'cmaps')
const target = join(projectRoot, 'lib', 'assets', 'cmaps')

const files = readdirSync(source).filter(name => name.endsWith('.bcmap'))
if (files.length === 0) {
  console.error('copy-cmaps: no .bcmap files under node_modules/pdfjs-dist/cmaps — is pdfjs-dist installed?')
  process.exit(1)
}
rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
console.log(`copy-cmaps: ${files.length} bcmap files → lib/assets/cmaps/`)
