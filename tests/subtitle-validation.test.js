const { normalizeSubtitleToWebVtt } = require('../build/src/utils/subtitle')

describe('subtitle validation and normalization', () => {
  test('normalizes valid SRT into UTF-8 WebVTT', () => {
    const result = normalizeSubtitleToWebVtt(
      Buffer.from('1\r\n00:00:01,000 --> 00:00:03,500\r\nHello world\r\n'),
    ).toString('utf8')

    expect(result).toContain('WEBVTT\n\n')
    expect(result).toContain('00:00:01.000 --> 00:00:03.500')
    expect(result).toContain('Hello world')
  })

  test('accepts valid WebVTT', () => {
    expect(() =>
      normalizeSubtitleToWebVtt(
        Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nCaption'),
      ),
    ).not.toThrow()
  })

  test.each([
    ['', 'empty'],
    ['This is not a subtitle', 'No valid subtitle cues'],
    ['1\n00:00:04,000 --> 00:00:02,000\nBackwards', 'invalid cue'],
  ])('rejects malformed subtitle text', (input, expected) => {
    expect(() => normalizeSubtitleToWebVtt(Buffer.from(input))).toThrow(expected)
  })
})
