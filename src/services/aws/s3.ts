import { Upload } from '@aws-sdk/lib-storage'
import { Options } from '@aws-sdk/lib-storage/dist-types'
import { AwsUtils } from './utils'
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsCommand,
  ListObjectsV2Command,
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { VideoUploadSchema } from '../../models/videoupload.model'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export class S3 {
  static createMultipartUpload = (Key: string, ContentType: string, Bucket = AwsUtils.buckets.reeplay) =>
    AwsUtils.clients.s3.send(new CreateMultipartUploadCommand({ Bucket, Key, ContentType }))

  static getSignedUploadPartUrl = (
    Key: string,
    UploadId: string,
    PartNumber: number,
    Bucket = AwsUtils.buckets.reeplay,
  ) =>
    getSignedUrl(
      AwsUtils.clients.s3,
      new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }),
      { expiresIn: 3600 },
    )

  static listMultipartParts = async (
    Key: string,
    UploadId: string,
    Bucket = AwsUtils.buckets.reeplay,
  ) => {
    const parts: Array<{ PartNumber: number; ETag: string; Size: number }> = []
    let PartNumberMarker: string | undefined
    do {
      const response = await AwsUtils.clients.s3.send(
        new ListPartsCommand({ Bucket, Key, UploadId, PartNumberMarker }),
      )
      response.Parts?.forEach(part => {
        if (part.PartNumber && part.ETag) {
          parts.push({ PartNumber: part.PartNumber, ETag: part.ETag, Size: part.Size ?? 0 })
        }
      })
      PartNumberMarker = response.IsTruncated ? response.NextPartNumberMarker : undefined
    } while (PartNumberMarker)
    return parts
  }

  static completeMultipartUpload = (
    Key: string,
    UploadId: string,
    Parts: Array<{ PartNumber: number; ETag: string }>,
    Bucket = AwsUtils.buckets.reeplay,
  ) => AwsUtils.clients.s3.send(
    new CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts } }),
  )

  static abortMultipartUpload = (
    Key: string,
    UploadId: string,
    Bucket = AwsUtils.buckets.reeplay,
  ) => AwsUtils.clients.s3.send(new AbortMultipartUploadCommand({ Bucket, Key, UploadId }))

  static headObject = (Key: string, Bucket = AwsUtils.buckets.reeplay) =>
    AwsUtils.clients.s3.send(new HeadObjectCommand({ Bucket, Key }))

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

  static getVideoObject = async (Key: string, Range?: string) => {
    const command = new GetObjectCommand({
      Key,
      Bucket: AwsUtils.buckets.reeplay,
      Range,
    })
    return AwsUtils.clients.s3.send(command)
  }

  static getSignedVideoObjectUrl = (Key: string, expiresIn = 86400) =>
    getSignedUrl(
      AwsUtils.clients.s3,
      new GetObjectCommand({
        Key,
        Bucket: AwsUtils.buckets.reeplay,
      }),
      { expiresIn },
    )

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

  static copyObject = async (
    sourceKey: string,
    destinationKey: string,
    Bucket = AwsUtils.buckets.reeplay,
  ) =>
    AwsUtils.clients.s3.send(
      new CopyObjectCommand({
        Bucket,
        Key: destinationKey,
        CopySource: `${Bucket}/${encodeURIComponent(sourceKey).replace(/%2F/g, '/')}`,
      }),
    )

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
