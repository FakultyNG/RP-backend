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

  app.use(
    '/static/images',
    express.static(path.join(process.cwd(), 'src', 'public', 'static')),
  )

  !env.IS_PROD && app.use(morgan('dev'))

  app.get('/', devTestRoute)
  app.get('/health', (_, res) => {
    res.status(200).json({ status: 'ok', service: 'reeplay-backend-typescript' })
  })
  app.get('/ready', (_, res) => {
    const ready = mongoose.connection.readyState === 1
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      database: ready ? 'connected' : 'disconnected',
    })
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
    '/media/hls/:token',
    Catch.async(async (req, res) => {
      const manifest = await MediaAccess.getHlsManifest(req.params.token)
      res.type('application/vnd.apple.mpegurl')
      res.setHeader('Cache-Control', 'private, no-store')
      res.send(manifest)
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
