import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import crypto from 'node:crypto'
import sharp from 'sharp'

import { OperationalError } from '../utils/OperationalError'
import { S3 } from './aws/s3'
import { AwsUtils } from './aws/utils'
import { rimraf } from 'rimraf'
import { MediaConvert } from './aws/mediaConvert'
import { MulterFile } from '../types'

export type UploadAndTranscodeConfig = UploadVideoInput

type UploadVideoInput = {
  file: Express.Multer.File
  expire: Date | undefined
}

export type StoreResponse = Awaited<ReturnType<typeof MediaManagement.storeImageAndSubtitle>>
export type ImageOptimizationPreset = 'portrait-poster' | 'landscape-poster' | 'generic'

export class MediaManagement {
  private static _genUniqueKey = () => crypto.randomBytes(8).toString('hex') + Date.now()

  private static _deleteFile = async (file: MulterFile) => {
    if (file.path == null) return

    try {
      await rimraf(file.path)
    } catch {
      console.error('🛑 error deleting ', +file.filename, 'after upload')
    }
  }

  static uploadAndInitiateMediaConvert = async (
    file: MulterFile,
    expire?: Date,
    transcoder = MediaConvert.transcode,
  ) => {
    const upload = await this._storeObjectFile(file, AwsUtils.buckets.reeplay, expire)
    const transcodeJob = await transcoder(upload.Key)

    return {
      ...upload,
      isTranscoded: false,
      hlsStatus: 'processing' as const,
      hlsJobId: transcodeJob.Job?.Id ?? null,
      hlsKey: MediaConvert.getHlsMasterKey(upload.Key),
    }
  }

  static upload480pAndInitiateMediaConvert = async (file: MulterFile, expire?: Date) =>
    this.uploadAndInitiateMediaConvert(file, expire, MediaConvert.transcode480p)

  static storeNotificationSound = (file: MulterFile) =>
    this._storeObjectFile(file, AwsUtils.buckets.replayImages)

  protected static _storeObjectFile = async (
    file: MulterFile,
    bucket: string,
    expire?: Date,
    optimized?: { buffer: Buffer; mimetype: string },
  ) => {
    try {
      const { Key, Bucket, $metadata } = await S3.upload({
        Body: optimized?.buffer ?? (file.path ? createReadStream(file.path) : file.buffer),
        Bucket: bucket,
        Key: this._genUniqueKey(),
        ContentType: optimized?.mimetype ?? file.mimetype,
        Expires: expire,
      })

      if ($metadata.httpStatusCode !== 200 || !Key || !Bucket) {
        throw new OperationalError('Upload failed. Please try again', 500)
      }

      return {
        Bucket,
        Key,
        mimetype: optimized?.mimetype ?? file.mimetype,
        size: optimized?.buffer.length ?? file.size,
      }
    } catch (e) {
      throw e
    } finally {
      this._deleteFile(file)
    }
  }

  // static storeSubtitle = async (file: MulterFile, expire?: Date) => {
  //   return await this._storeObjectFile(file, AwsUtils.buckets.replayImages, expire)
  // }

  static storeImageAndSubtitle = async (
    file: MulterFile,
    expire?: Date,
    preset: ImageOptimizationPreset = 'generic',
  ) => {
    if (!file.mimetype.startsWith('image/')) {
      return await this._storeObjectFile(file, AwsUtils.buckets.replayImages, expire)
    }

    if (file.size > 25 * 1024 * 1024) {
      await this._deleteFile(file)
      throw new OperationalError('Image uploads must not exceed 25 MB', 400)
    }

    const dimensions =
      preset === 'portrait-poster'
        ? { width: 1200, height: 1600 }
        : preset === 'landscape-poster'
          ? { width: 1920, height: 1080 }
          : { width: 1600, height: 1600 }

    let buffer: Buffer
    try {
      const input = file.buffer?.length
        ? file.buffer
        : file.path
          ? await readFile(file.path)
          : null
      if (!input) throw new OperationalError('Uploaded image is empty', 400)

      buffer = await sharp(input, { failOn: 'error' })
        .rotate()
        .resize({
          ...dimensions,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({
          quality: 76,
          alphaQuality: 80,
          effort: 5,
          smartSubsample: true,
        })
        .toBuffer()
    } catch (error) {
      await this._deleteFile(file)
      throw error
    }

    return await this._storeObjectFile(file, AwsUtils.buckets.replayImages, expire, {
      buffer,
      mimetype: 'image/webp',
    })
  }

  static storeSubtitle = async (file: MulterFile, webVtt: Buffer) => {
    return await this._storeObjectFile(file, AwsUtils.buckets.replayImages, undefined, {
      buffer: webVtt,
      mimetype: 'text/vtt; charset=utf-8',
    })
  }

  static deleteObject = async (key: string, bucket: string) => {
    try {
      const response = await S3.deleteObject(key, bucket)
      return response.$metadata.httpStatusCode === 200
    } catch (e: any) {
      console.error(`🛑🛑 S3 Object delete error. KEY: ${key} | BUCKET: ${bucket}`)
      console.error('Reason', e.message || e)
      return false
    }
  }
}
