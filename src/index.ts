import { promises as fs, existsSync } from 'fs'
import { join, resolve } from 'path'
import type { Plugin, ResolvedConfig } from 'vite'
import fg from 'fast-glob'
import Windicss from 'windicss'
import { StyleSheet } from 'windicss/utils/style'
import { CSSParser } from 'windicss/utils/parser'
import { Config as WindiCssOptions } from 'windicss/types/interfaces'
import { htmlTags, MODULE_ID, MODULE_ID_VIRTUAL, preflightTags } from './constants'
import { debug } from './debug'
import { Options } from './types'

function VitePluginWindicss(options: Options = {}): Plugin[] {
  const {
    windicssOptions = 'tailwind.config.js',
    searchExtensions = ['html', 'vue', 'pug', 'jsx', 'tsx', 'svelte'],
    searchDirs = ['src'],
    preflight = true,
    transformCSS = true,
  } = options

  let config: ResolvedConfig
  let windi: Windicss
  let windiConfigFile: string | undefined
  const extensionRegex = new RegExp(`\\.(?:${searchExtensions.join('|')})$`, 'i')

  const classes = new Set<string>()
  const classesPending = new Set<string>()

  const tags = new Set<string>()
  const tagsPending = new Set<string>()
  const tagsAvaliable = new Set<string>()

  const preflightOptions = Object.assign({
    includeBase: true,
    includeGlobal: true,
    includePlugin: true,
  }, typeof preflight === 'boolean' ? {} : preflight)

  function initWindicss() {
    let options: WindiCssOptions = {}
    if (typeof windicssOptions === 'string') {
      const path = resolve(config.root, windicssOptions)
      if (!existsSync(path)) {
        console.warn(`[vite-plugin-windicss] config file "${windicssOptions}" not found, ignored`)
      }
      else {
        try {
          delete require.cache[require.resolve(path)]
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          options = require(path)
          windiConfigFile = path
        }
        catch (e) {
          console.error(`[vite-plugin-windicss] failed to load config "${windicssOptions}"`)
          console.error(`[vite-plugin-windicss] ${e.toString()}`)
          process.exit(1)
        }
      }
    }
    else {
      options = windicssOptions
    }

    debug.config(JSON.stringify(options, null, 2))
    return new Windicss(options)
  }

  let _searching: Promise<void> | null

  async function search() {
    if (!_searching) {
      _searching = (async() => {
        const globs = searchDirs.map(i => join(i, `**/*.{${searchExtensions.join(',')}}`).replace(/\\/g, '/'))
        debug.glob(globs)

        const files = await fg(
          globs,
          {
            onlyFiles: true,
            cwd: config.root,
            absolute: true,
          },
        )

        debug.glob('files', files)

        await Promise.all(files.map(async(id) => {
          const content = await fs.readFile(id, 'utf-8')
          detectFile(content, id)
        }))
      })()
    }

    return _searching
  }

  function isDetectTarget(id: string) {
    return id.match(extensionRegex)
  }

  function detectFile(code: string, id: string) {
    if (!isDetectTarget(id))
      return

    const regQuotedString = /(["'`])((?:\\\1|(?:(?!\1)).)*?)\1/g
    const regClassCheck = /^[a-z\-]+[a-z0-9:\-/\\]*\.?[a-z0-9]$/

    debug.detect(id)
    Array.from(code.matchAll(regQuotedString))
      .flatMap(m => m[2]?.split(' ') || [])
      .filter(i => i.match(regClassCheck))
      .forEach((i) => {
        if (!i || classes.has(i))
          return
        classesPending.add(i)
      })

    Array.from(code.matchAll(/<([a-z]+)/g))
      .flatMap(([, i]) => i)
      .forEach((i) => {
        if (!tagsAvaliable.has(i))
          return
        tagsPending.add(i)
        tagsAvaliable.delete(i)
      })

    debug.detect('classes', classesPending)
    debug.detect('tags', tagsPending)
  }

  function add<T>(set: Set<T>, v: T[] | Set<T>) {
    for (const i of v)
      set.add(i)
  }

  function convertCSS(css: string) {
    const style = new CSSParser(css, windi).parse()
    return style.build()
  }

  let style: StyleSheet = new StyleSheet()

  async function generateCSS() {
    await search()

    if (classesPending.size) {
      const result = windi.interpret(Array.from(classesPending).join(' '))
      if (result.success.length) {
        add(classes, result.success)
        classesPending.clear()
        debug.compile(`compiled ${result.success.length} classes`)
        debug.compile(result.success)

        style = style.extend(result.styleSheet)
      }
    }

    if (preflight && tagsPending.size) {
      const preflightStyle = windi.preflight(
        Array.from(tagsPending).map(i => `<${i}`).join(' '),
        preflightOptions.includeBase,
        preflightOptions.includeGlobal,
        preflightOptions.includePlugin,
      )
      style = style.extend(preflightStyle, true)
      add(tags, tagsPending)
      tagsPending.clear()
    }

    const css = style.build()
    return css
  }

  function reset() {
    windi = initWindicss()
    style = new StyleSheet()
    add(classesPending, classes)
    add(tagsPending, tags)
    add(tagsPending, preflightTags)
    add(tagsAvaliable, htmlTags)
    classes.clear()
    tags.clear()
  }

  const plugins: Plugin[] = [
    {
      name: 'vite-plugin-windicss:pre',
      enforce: 'pre',

      configResolved(_config) {
        config = _config
        reset()
      },

      resolveId(id): string | null {
        return id.startsWith(MODULE_ID) || id === MODULE_ID_VIRTUAL
          ? MODULE_ID_VIRTUAL
          : null
      },

      async load(id) {
        if (id === MODULE_ID_VIRTUAL)
          return generateCSS()
      },
    },
    {
      name: 'vite-plugin-windicss:hmr',
      apply: 'serve',
      enforce: 'post',

      configureServer(server) {
        if (windiConfigFile)
          server.watcher.add(windiConfigFile)
      },

      async handleHotUpdate({ server, file, read, modules }) {
        if (windiConfigFile && file === windiConfigFile) {
          debug.hmr(`config file changed: ${file}`)
          reset()
          setTimeout(() => {
            console.log('[vite-plugin-windicss] configure file changed, reloading')
            server.ws.send({ type: 'full-reload' })
          }, 0)
          return [server.moduleGraph.getModuleById(MODULE_ID_VIRTUAL)!]
        }

        if (!isDetectTarget(file))
          return

        debug.hmr(`refreshed by ${file}`)

        detectFile(await read(), file)

        const module = server.moduleGraph.getModuleById(MODULE_ID_VIRTUAL)
        return [module!, ...modules]
      },
    },
  ]

  if (transformCSS) {
    plugins.push({
      name: 'vite-plugin-windicss:css',
      transform(code, id) {
        if (id.match(/\.(post)?css(?:$|\?)/)) {
          debug.css(id)
          return convertCSS(code)
        }
      },
    })
  }

  return plugins
}

export default VitePluginWindicss
