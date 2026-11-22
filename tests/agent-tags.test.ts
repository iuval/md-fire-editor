// `agent/core.mjs` mantiene los tags denormalizados que la app filtra sin bajar
// cuerpos. Este test fija su comportamiento sin emulador: el caso de la lista en
// frontmatter tiraba `ReferenceError` (la variable `list` quedaba encerrada en el
// `else`), así que `vault push` fallaba con cualquier nota con `tags:` en YAML.
import { describe, expect, it } from 'vitest'
import { extractTags } from '../agent/core.mjs'

describe('extractTags del CLI', () => {
  it('encuentra tags inline y anidados, en minúsculas', () => {
    expect(extractTags('hola #Trabajo y #Clientes/Acme')).toEqual(['clientes/acme', 'trabajo'])
  })

  it('lee el array inline del frontmatter', () => {
    expect(extractTags('---\ntags: [uno, dos]\n---\n\ncuerpo')).toEqual(['dos', 'uno'])
  })

  it('lee la lista en YAML del frontmatter', () => {
    expect(extractTags('---\ntags:\n  - tres\n  - cuatro\n---\n\ncuerpo')).toEqual(['cuatro', 'tres'])
  })

  it('lee la clave `tag:` suelta', () => {
    expect(extractTags('---\ntag: cinco, seis\n---\n\ncuerpo')).toEqual(['cinco', 'seis'])
  })

  it('ignora código, headings y números sueltos', () => {
    const md = ['# Título', 'texto #real', '```js', 'const x = "#falso"', '```', 'y `#otro` fin'].join('\n')
    expect(extractTags(md)).toEqual(['real'])
    expect(extractTags('#123 #2024')).toEqual([])
  })

  it('no se rompe con un frontmatter sin tags', () => {
    expect(extractTags('---\ntitle: Hola\n---\n\n#cuerpo')).toEqual(['cuerpo'])
  })
})
