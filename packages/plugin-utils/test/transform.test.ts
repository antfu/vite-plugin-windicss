import { createUtils } from '../src'

describe('transfrom', () => {
  it('groups', async() => {
    const cases = [
      'bg-white font-light sm:hover:(bg-gray-100 font-medium)',
      '-sm:hover:(p-1 p-2)',
      '+sm:(p-1 p-2)',
      'dark:+lg:(p-1 p-2)',
    ]
    const utils = createUtils()

    for (const c of cases) {
      const transformed = utils.transformGroups(c)
      expect(transformed).toMatchSnapshot(`"${c}"`)
      const transformedSourceMap = utils.transformGroupsWithSourcemap(c)?.code
      expect(transformedSourceMap).toBe(transformed)
    }
  })

  it('css directives', async() => {
    const utils = createUtils({
      preflight: false,
      scan: false,
    })

    await utils.init()

    expect(await utils.generateCSS()).toBe('')

    expect(utils.transformCSS(`
      .rounded-box {
        border-radius: var(--rounded-box, 1rem);
      }
      .card {
        color: black;
        @apply rounded-box shadow hover:shadow-xl;
      }
      .artboard {
        @apply rounded-box;
      }
    `)).toMatchSnapshot('basic @apply')

    expect(await utils.generateCSS()).toBe('')

    expect(utils.transformCSS(`
      .btn {
        padding: 5px;
      }
      @layer utilities {
        .btn-utilities {
          @apply text-red-200;
          font-size: 2rem;
        }
      }
      @layer base {
        .btn-base {
          @apply text-red-300;
          font-size: 1.5rem;
        }
      }
      @layer components {
        .btn-components {
          @apply text-red-400;
          font-size: 1rem;
        }
      }
    `)).toMatchSnapshot('basic @layer')

    // should merge with utilities
    utils.addClasses(['p-4'])

    expect(await utils.generateCSS()).toMatchSnapshot('@layer all')
    expect(await utils.generateCSS('base')).toMatchSnapshot('@layer base')
    expect(await utils.generateCSS('components')).toMatchSnapshot('@layer components')
    expect(await utils.generateCSS('utilities')).toMatchSnapshot('@layer utilities')
  })
})
