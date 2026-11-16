import { OperationalError } from './OperationalError'

type SubtitleCue = {
  start: number
  end: number
  startText: string
  endText: string
  text: string
}

const TIMESTAMP = '(?:\\d{1,2}:)?\\d{2}:\\d{2}[,.]\\d{3}'
const TIMING_LINE = new RegExp(`^(${TIMESTAMP})\\s*-->\\s*(${TIMESTAMP})(?:\\s+.*)?$`)

const secondsFromTimestamp = (value: string) => {
  const parts = value.replace(',', '.').split(':').map(Number)
  if (parts.some(Number.isNaN)) return Number.NaN
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return Number.NaN
}

const canonicalTimestamp = (value: string) => {
  const normalized = value.replace(',', '.')
  return normalized.split(':').length === 2 ? `00:${normalized}` : normalized
}

const decodeUtf8 = (buffer: Buffer) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new OperationalError('Subtitle files must use UTF-8 text encoding', 400)
  }
}

export const normalizeSubtitleToWebVtt = (buffer: Buffer) => {
  const source = decodeUtf8(buffer).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  if (!source || source.includes('\0')) {
    throw new OperationalError('Subtitle file is empty or is not a text file', 400)
  }

  const body = source.replace(/^WEBVTT[^\n]*\n?/i, '').trim()
  const blocks = body.split(/\n{2,}/)
  const cues: SubtitleCue[] = []

  for (const block of blocks) {
    const lines = block.split('\n').map(line => line.trimEnd())
    const timingIndex = lines.findIndex(line => TIMING_LINE.test(line.trim()))
    if (timingIndex < 0) continue

    const match = lines[timingIndex].trim().match(TIMING_LINE)
    if (!match) continue
    const start = secondsFromTimestamp(match[1])
    const end = secondsFromTimestamp(match[2])
    const text = lines.slice(timingIndex + 1).join('\n').trim()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) {
      throw new OperationalError(
        'Subtitle contains an invalid cue. Each cue needs valid start/end times and text.',
        400,
      )
    }
    cues.push({
      start,
      end,
      startText: canonicalTimestamp(match[1]),
      endText: canonicalTimestamp(match[2]),
      text,
    })
  }

  if (!cues.length) {
    throw new OperationalError(
      'No valid subtitle cues were found. Use SRT or WebVTT timestamps such as 00:00:01,000 --> 00:00:04,000.',
      400,
    )
  }

  const webVtt = cues
    .map((cue, index) => `${index + 1}\n${cue.startText} --> ${cue.endText}\n${cue.text}`)
    .join('\n\n')
  return Buffer.from(`WEBVTT\n\n${webVtt}\n`, 'utf8')
}
