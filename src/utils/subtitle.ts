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

  if (/^WEBVTT(?:\s|$)/i.test(source)) {
    return Buffer.from(`${source}\n`, 'utf8')
  }

  // Best-effort SRT/SBV-style conversion only. Upload acceptance deliberately
  // does not depend on strict timestamps so legacy caption exports can be kept.
  const body = source
    .replace(/(^|\s)(\d{1,2}:\d{2}(?::\d{2})?),([0-9]{1,3})(?=\s*-->)/gm, '$1$2.$3')
    .replace(/(--?>\s*\d{1,2}:\d{2}(?::\d{2})?),([0-9]{1,3})/gm, '$1.$2')

  return Buffer.from(`WEBVTT\n\n${body}\n`, 'utf8')
}
