import moment from 'moment'
import { getSignedUrl as getCFSignedUrl } from '@aws-sdk/cloudfront-signer'
import jwt from 'jsonwebtoken'
import path from 'node:path'
import env from '../env'
import { S3 } from './aws/s3'
import { OperationalError } from '../utils/OperationalError'

type HlsPlaybackToken = {
  scope: 'railway-hls'
  key: string
}

export class MediaAccess {
  static getImageAndSubtitleURL = (key: string) => `${env.CDN_IMAGES_BASE_URL}/${key}`

  static getSignedVideoURL = (key: string) => {
    const privateKey = env.CFS_PRIVATE_KEY.replace(/\\n/g, '\n')

    const URL = getCFSignedUrl({
      url: env.CFSDISTRIBUTION + '/' + key,
      keyPairId: env.KEY_PAIR_ID,
      dateLessThan: moment().add(1, 'days').toISOString(),
      privateKey,
    })

    return URL
  }

  private static createHlsToken = (key: string) =>
    jwt.sign({ scope: 'railway-hls', key } satisfies HlsPlaybackToken, env.JWT_SECRET, {
      expiresIn: '1d',
    })

  static getHlsPlaybackURL = (key: string) => {
    const token = this.createHlsToken(key)
    return `${env.PUBLIC_APP_ORIGIN}/media/hls/${encodeURIComponent(token)}`
  }

  private static verifyHlsToken = (token: string): HlsPlaybackToken => {
    let payload: string | jwt.JwtPayload
    try {
      payload = jwt.verify(token, env.JWT_SECRET)
    } catch {
      throw new OperationalError('HLS playback link is invalid or expired', 401)
    }

    if (
      typeof payload === 'string' ||
      payload.scope !== 'railway-hls' ||
      typeof payload.key !== 'string' ||
      !payload.key.startsWith('railway-hls/')
    ) {
      throw new OperationalError('Invalid HLS playback link', 401)
    }

    return { scope: 'railway-hls', key: payload.key }
  }

  static getHlsManifest = async (token: string) => {
    const { key } = this.verifyHlsToken(token)
    const object = await S3.getVideoObject(key)

    if (!object.Body) {
      throw new OperationalError('HLS manifest not found', 404)
    }

    const manifest = await object.Body.transformToString()
    const parentDirectory = path.posix.dirname(key)

    const rewritten = manifest
      .split(/\r?\n/)
      .map(line => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) return line

        const childKey = path.posix.normalize(path.posix.join(parentDirectory, trimmed))
        if (!childKey.startsWith('railway-hls/')) {
          throw new OperationalError('Invalid HLS child path', 500)
        }

        return childKey.toLowerCase().includes('.m3u8')
          ? this.getHlsPlaybackURL(childKey)
          : this.getSignedVideoURL(childKey)
      })
      .join('\n')

    return rewritten
  }
}
