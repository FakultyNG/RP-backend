const express = require('express')
const request = require('supertest')
const { Multer } = require('../build/src/utils/Multer')
const { normalizeSubtitleToWebVtt } = require('../build/src/utils/subtitle')

const createApp = () => {
  const app = express()

  app.post('/subtitle', Multer.uploadSingleSubtitle, (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: 'No subtitle file was received.' })
    }

    const normalized = normalizeSubtitleToWebVtt(req.file.buffer)
    return res.status(200).json({
      fieldname: req.file.fieldname,
      filename: req.file.originalname,
      text: normalized.toString('utf8'),
    })
  })

  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 400).json({ message: error.message })
  })

  return app
}

describe('subtitle multipart upload contract', () => {
  test('accepts the subtitle field and produces player-ready WebVTT', async () => {
    const response = await request(createApp())
      .post('/subtitle')
      .field('parentId', 'video-id')
      .field('parentType', 'vod')
      .field('language', 'English')
      .attach(
        'subtitle',
        Buffer.from('1\n00:00:01,000 --> 00:00:03,500\nHello world\n'),
        { filename: 'captions.srt', contentType: 'application/x-subrip' },
      )

    expect(response.status).toBe(200)
    expect(response.body.fieldname).toBe('subtitle')
    expect(response.body.filename).toBe('captions.srt')
    expect(response.body.text).toContain('WEBVTT\n\n')
    expect(response.body.text).toContain('00:00:01.000 --> 00:00:03.500')
    expect(response.body.text).toContain('Hello world')
  })

  test('returns a useful error when the multipart request has no file', async () => {
    const response = await request(createApp())
      .post('/subtitle')
      .field('parentId', 'video-id')
      .field('parentType', 'vod')
      .field('language', 'English')

    expect(response.status).toBe(400)
    expect(response.body.message).toBe('No subtitle file was received.')
  })

  test('rejects a subtitle sent under the wrong multipart field', async () => {
    const response = await request(createApp())
      .post('/subtitle')
      .attach('file', Buffer.from('subtitle'), 'captions.srt')

    expect(response.status).toBe(400)
    expect(response.body.message).toMatch(/Unexpected (file )?field/i)
  })
})
