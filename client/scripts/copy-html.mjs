import { readFile, writeFile } from 'node:fs/promises'

const build = new URL('../dist/index.html', import.meta.url)
const html = (await readFile(build, 'utf8')).replace(/\r\n/g, '\n').replace(/^[ \t]+$/gm, '')
await Promise.all(['dashboard.html', 'index.html'].map(name =>
  writeFile(new URL('../../' + name, import.meta.url), html)))
