import { OperationalError } from './OperationalError'

const decodeSubtitleText = (buffer: Buffer) => {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer)
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buffer.length - 2)
    for (let index = 2; index + 1 < buffer.length; index += 2) {
      swapped[index - 2] = buffer[index + 1]
      swapped[index - 1] = buffer[index]
    }
    return new TextDecoder('utf-16le').decode(swapped)
  }

  // Decode UTF-8 permissively. If replacement characters indicate a legacy
  // single-byte caption, Windows-1252 preserves that text more accurately.
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  return utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(buffer) : utf8
}

export const normalizeSubtitleToWebVtt = (buffer: Buffer) => {
  const source = decodeSubtitleText(buffer).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  if (!source || source.includes('\0')) {
    throw new OperationalError('Subtitle file is empty or is not a text file', 400)
  }

  const lines = source.split('\n')
  const timingPattern = /^\s*((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{1,3})(.*)$/

  const timestampToMilliseconds = (value: string) => {
    const pieces = value.replace(',', '.').split(':')
    const seconds = Number(pieces.pop())
    const minutes = Number(pieces.pop())
    const hours = Number(pieces.pop() || 0)
    return ((hours * 60 + minutes) * 60 + seconds) * 1000
  }

  const normalizeTimestamp = (value: string) => {
    const pieces = value.replace(',', '.').split(':')
    const seconds = pieces.pop() as string
    const minutes = pieces.pop() as string
    const hours = pieces.pop() || '0'
    const [wholeSeconds, fraction = '0'] = seconds.split('.')
    return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:${wholeSeconds.padStart(2, '0')}.${fraction.padEnd(3, '0').slice(0, 3)}`
  }

  const cues: string[] = []
  for (let index = /^WEBVTT(?:\s|$)/i.test(lines[0]) ? 1 : 0; index < lines.length; index += 1) {
    const match = lines[index].match(timingPattern)
    if (!match) continue

    if (timestampToMilliseconds(match[2]) <= timestampToMilliseconds(match[1])) {
      throw new OperationalError('Subtitle contains an invalid cue time range', 400)
    }

    const text: string[] = []
    for (index += 1; index < lines.length && lines[index].trim(); index += 1) {
      // Some exporters omit the blank line between cues. Stop before the next
      // cue identifier/timestamp instead of swallowing it into the prior text.
      if (timingPattern.test(lines[index])) {
        index -= 1
        break
      }
      if (/^\d+$/.test(lines[index].trim()) && timingPattern.test(lines[index + 1] || '')) {
        index -= 1
        break
      }
      text.push(lines[index])
    }

    if (text.some(line => line.trim())) {
      const settings = match[3].trim()
      cues.push(
        `${normalizeTimestamp(match[1])} --> ${normalizeTimestamp(match[2])}${settings ? ` ${settings}` : ''}\n${text.join('\n')}`,
      )
    }
  }

  if (!cues.length) {
    throw new OperationalError('No valid subtitle cues were found', 400)
  }

  return Buffer.from(`WEBVTT\n\n${cues.join('\n\n')}\n`, 'utf8')
}
