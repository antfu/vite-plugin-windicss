import { createUtils } from '../src'

describe('transfrom', () => {
  it('group basic', async() => {
    const utils = createUtils()
    expect(
      utils.transformGroups('bg-white font-light sm:hover:(bg-gray-100 font-medium)'),
    ).toMatchSnapshot()
  })
})
