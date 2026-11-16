import { Upload } from '@aws-sdk/lib-storage'
import { Options } from '@aws-sdk/lib-storage/dist-types'
import { AwsUtils } from './utils'
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { VideoUploadSchema } from '../../models/videoupload.model'

export class S3 {
  static upload = (params: Options['params']) => {
    return new Upload({ client: AwsUtils.clients.s3, params }).done()
  }

  static deleteObject = async (Key: string, Bucket = AwsUtils.buckets.reeplay) => {
    const command = new DeleteObjectCommand({ Key, Bucket })
    const res = await AwsUtils.clients.s3.send(command)
    return res
  }

  static getImageObject = async (Key: string) => {
    const command = new GetObjectCommand({
      Key,
      Bucket: AwsUtils.buckets.replayImages,
    })
    return AwsUtils.clients.s3.send(command)
  }

  static getVideoObject = async (Key: string) => {
    const command = new GetObjectCommand({
      Key,
      Bucket: AwsUtils.buckets.reeplay,
    })
    return AwsUtils.clients.s3.send(command)
  }

  static objectExists = async (Key: string, Bucket = AwsUtils.buckets.reeplay) => {
    try {
      await AwsUtils.clients.s3.send(new HeadObjectCommand({ Key, Bucket }))
      return true
    } catch (error: any) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') {
        return false
      }
      throw error
    }
  }

  static listKeys = async (Prefix: string, Bucket = AwsUtils.buckets.reeplay) => {
    const keys: string[] = []
    let ContinuationToken: string | undefined

    do {
      const response = await AwsUtils.clients.s3.send(
        new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }),
      )
      response.Contents?.forEach(object => object.Key && keys.push(object.Key))
      ContinuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
    } while (ContinuationToken)

    return keys
  }

  static deleteObjects = async (keys: string[], Bucket = AwsUtils.buckets.reeplay) => {
    for (let index = 0; index < keys.length; index += 1000) {
      const Objects = keys.slice(index, index + 1000).map(Key => ({ Key }))
      if (!Objects.length) continue
      await AwsUtils.clients.s3.send(
        new DeleteObjectsCommand({
          Bucket,
          Delete: { Objects, Quiet: true },
        }),
      )
    }
  }

  static getTranscodedKeysFromInputKey = async (inputKey: string) => {
    const command = new ListObjectsCommand({
      Bucket: AwsUtils.buckets.reeplay,
      Prefix: 'transcode/' + inputKey,
    })

    const { Contents } = await AwsUtils.clients.s3.send(command)

    if (Contents == null || Contents.length === 0) {
      return []
    }

    const outputKeys = Contents.reduce<string[]>((acc, content) => {
      content.Key ? acc.push(content.Key) : acc
      return acc
    }, [])

    return outputKeys
  }

  static setResolutionsPairs = async (inputKey: string) => {
    const keys = await this.getTranscodedKeysFromInputKey(inputKey)

    const pairs = keys.map(key => {
      let resolution: VideoUploadSchema['resolutions'][number]['resolution'] = '720'

      switch (true) {
        case key.includes('_1080p'):
          resolution = '1080'
          break
        case key.includes('_480p'):
          resolution = '480'
          break
        default:
          resolution = '720'
          break
      }

      return { key, resolution }
    })

    return pairs
  }
}
