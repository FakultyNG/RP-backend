import path from 'node:path'
import compression from 'compression'
import express, { Request, Response } from 'express'
import cors from 'cors'
import morgan from 'morgan'
import mongoose from 'mongoose'
import swaggerUi from 'swagger-ui-express'

import { v1Router } from './routes/index'
import { ErrorMiddleware } from './middlewares/errors'
import env from './env'
import { Catch } from './utils/Catch'
import { OperationalError } from './utils/OperationalError'
import { S3 } from './services/aws/s3'
import { MediaAccess } from './services/media-access'
import { SharePageController } from './controllers/common/sharePage.controller'
import { getBuildInfo } from './utils/buildInfo'

const devTestRoute = (_: Request, res: Response) => {
  res.status(200).json({
    status: 200,
    message: 'REEPLAY API BASE_URL',
  })
}

export const reeplayApp = () => {
  const app = express()
  const openApiPath = path.join(process.cwd(), 'docs', 'openapi.json')
  const openApiDocument = JSON.parse(require('node:fs').readFileSync(openApiPath, 'utf8'))

  app.use(express.json({ limit: '10gb' }))
  app.use(express.urlencoded({ extended: true }))
  app.use(cors())
  // Catalogue, home and comment payloads are JSON-heavy. Compression was
  // imported but never enabled, so every mobile request paid the full transfer
  // cost on cellular networks.
  app.use(compression({ threshold: 1024 }))

  app.use(
    '/static/images',
    express.static(path.join(process.cwd(), 'src', 'public', 'static')),
  )

  !env.IS_PROD && app.use(morgan('dev'))

  app.get('/', devTestRoute)
  app.get('/health', (_, res) => {
    res.status(200).json({ status: 'ok', ...getBuildInfo() })
  })
  app.get('/ready', (_, res) => {
    const ready = mongoose.connection.readyState === 1
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      database: ready ? 'connected' : 'disconnected',
    })
  })
  app.get('/share/:type/:id', Catch.async(SharePageController.render))
  app.get('/.well-known/assetlinks.json', (_, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.json([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.reeplayv2',
          sha256_cert_fingerprints: [
            '68:26:D6:4A:0C:6E:4C:64:34:34:7F:13:FD:24:14:AD:36:35:0B:F0:09:09:DA:54:3D:4D:C0:C6:F3:E0:C3:96',
            'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C',
          ],
        },
      },
    ])
  })
  app.get(
    '/media/images/*',
    Catch.async(async (req, res) => {
      const key = req.params[0]
      if (!key) throw new OperationalError('Image key is required', 400)

      let image
      try {
        image = await S3.getImageObject(key)
      } catch (error: any) {
        if (
          error?.name === 'NoSuchKey' ||
          error?.name === 'NotFound' ||
          error?.$metadata?.httpStatusCode === 404
        ) {
          throw new OperationalError('Image not found', 404)
        }
        throw error
      }

      if (!image.Body) throw new OperationalError('Image data is unavailable', 404)

      if (req.headers['if-none-match'] && req.headers['if-none-match'] === image.ETag) {
        res.status(304).end()
        return
      }

      image.ContentType && res.type(image.ContentType)
      image.ContentLength && res.setHeader('Content-Length', image.ContentLength)
      image.ETag && res.setHeader('ETag', image.ETag)
      image.LastModified && res.setHeader('Last-Modified', image.LastModified.toUTCString())
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')

      const bytes = await image.Body.transformToByteArray()
      res.send(Buffer.from(bytes))
    }),
  )
  app.get(
    '/media/subtitles/:key',
    Catch.async(async (req, res) => {
      const key = req.params.key
      if (!key) throw new OperationalError('Subtitle key is required', 400)

      let subtitle
      try {
        subtitle = await S3.getImageObject(key)
      } catch (error: any) {
        if (
          error?.name === 'NoSuchKey' ||
          error?.name === 'NotFound' ||
          error?.$metadata?.httpStatusCode === 404
        ) {
          throw new OperationalError('Subtitle not found', 404)
        }
        throw error
      }

      if (!subtitle.Body) throw new OperationalError('Subtitle data is unavailable', 404)

      subtitle.ETag && res.setHeader('ETag', subtitle.ETag)
      subtitle.LastModified &&
        res.setHeader('Last-Modified', subtitle.LastModified.toUTCString())
      res.type('text/vtt; charset=utf-8')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Cache-Control', 'public, max-age=3600')

      const bytes = await subtitle.Body.transformToByteArray()
      res.send(Buffer.from(bytes))
    }),
  )
  app.get(
    '/media/hls/:token',
    Catch.async(async (req, res) => {
      const manifest = await MediaAccess.getHlsManifest(req.params.token)
      res.type('application/vnd.apple.mpegurl')
      res.setHeader('Cache-Control', 'private, no-store')
      res.send(manifest)
    }),
  )
  app.get(
    '/media/video/:token',
    Catch.async(async (req, res) => {
      const key = MediaAccess.getVideoPlaybackKey(req.params.token)
      const range = typeof req.headers.range === 'string' ? req.headers.range : undefined
      let video
      try {
        video = await S3.getVideoObject(key, range)
      } catch (error: any) {
        if (
          error?.name === 'NoSuchKey' ||
          error?.name === 'NotFound' ||
          error?.$metadata?.httpStatusCode === 404
        ) {
          throw new OperationalError('Video file not found', 404)
        }
        throw error
      }

      if (!video.Body) throw new OperationalError('Video data is unavailable', 404)

      video.ContentType && res.type(video.ContentType)
      video.ContentLength && res.setHeader('Content-Length', video.ContentLength)
      video.ContentRange && res.setHeader('Content-Range', video.ContentRange)
      video.ETag && res.setHeader('ETag', video.ETag)
      res.setHeader('Accept-Ranges', video.AcceptRanges ?? 'bytes')
      res.setHeader('Cache-Control', 'private, no-store')
      if (range && video.ContentRange) res.status(206)

      const body = video.Body as typeof video.Body & { pipe?: (target: typeof res) => void }
      if (typeof body.pipe === 'function') {
        body.pipe(res)
        return
      }

      res.send(Buffer.from(await video.Body.transformToByteArray()))
    }),
  )
  app.get('/openapi.json', (_, res) => res.sendFile(openApiPath))
  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: 'Reeplay API documentation',
      swaggerOptions: { persistAuthorization: true },
    }),
  )
  app.use('/api/v1', v1Router)
  app.use(ErrorMiddleware.wildRoute)
  app.use(ErrorMiddleware.allErrors)

  return app
}
