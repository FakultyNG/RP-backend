const { selectVideoResolution } = require('../build/src/utils/selectVideoResolution')

const upload = {
  resolutions: [
    { resolution: '480', key: 'movie_480p.mp4' },
    { resolution: '720', key: 'movie_720p.mp4' },
    { resolution: '1080', key: 'movie_1080p.mp4' },
  ],
}

const resolveKey = quality => selectVideoResolution(upload.resolutions, quality)?.key

describe('video quality resolution selection', () => {
  test('uses 720p as the balanced automatic default', () => {
    expect(resolveKey('automatic')).toBe('movie_720p.mp4')
  })

  test('uses the explicitly selected rendition', () => {
    expect(resolveKey('1080p')).toBe('movie_1080p.mp4')
    expect(resolveKey('480p')).toBe('movie_480p.mp4')
  })

  test('falls back to the closest lower rendition', () => {
    const without1080 = {
      resolutions: upload.resolutions.filter(item => item.resolution !== '1080'),
    }

    expect(selectVideoResolution(without1080.resolutions, '1080p')?.key).toBe(
      'movie_720p.mp4',
    )
  })
})
