const { isYouTubeUrl } = require('../build/src/utils/youtube')

describe('YouTube URL classification', () => {
  test.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://m.youtube.com/shorts/dQw4w9WgXcQ',
  ])('accepts %s', url => {
    expect(isYouTubeUrl(url)).toBe(true)
  })

  test('does not classify a direct CDN video as YouTube', () => {
    expect(isYouTubeUrl('https://cdn.example.com/movie.mp4')).toBe(false)
  })
})
