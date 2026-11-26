import crypto from 'node:crypto'
import path from 'node:path'
import { ClientSession, Types } from 'mongoose'
import { MultipartUploadModel } from '../../models/multipartUpload.model'
import { VideoUploadModel } from '../../models/videoupload.model'
import { OperationalError } from '../../utils/OperationalError'
import { AwsUtils } from '../aws/utils'
import { MediaConvert } from '../aws/mediaConvert'
import { S3 } from '../aws/s3'

const MIB = 1024 * 1024
const GIB = 1024 * MIB
const DEFAULT_PART_SIZE = 16 * MIB
const MAX_PARTS = 10_000
const ACTIVE_SESSION_HOURS = 24
const COMPLETED_SESSION_DAYS = 7

type MediaKind = 'main' | 'trailer'
type UploadTarget = 'vod' | 'episode'

type InitiateInput = {
  adminId: string
  fileName: string
  contentType: string
  size: number
  mediaKind: MediaKind
  target: UploadTarget
}

const allowedExtensions = new Set(['.mp4', '.mov', '.m4v', '.mxf'])

export class MultipartUploadService {
  private static getSession = async (sessionId: string, adminId: string) => {
    if (!Types.ObjectId.isValid(sessionId)) throw new OperationalError('Invalid upload session', 400)
    const session = await MultipartUploadModel.findOne({ _id: sessionId, adminId })
    if (!session) throw new OperationalError('Upload session not found', 404)
    return session
  }

  static initiate = async (input: InitiateInput) => {
    const extension = path.extname(input.fileName).toLowerCase()
    if (!allowedExtensions.has(extension)) {
      throw new OperationalError('Use an MP4, MOV, M4V, or MXF source file', 400)
    }
    if (!Number.isSafeInteger(input.size) || input.size <= 0) {
      throw new OperationalError('File size must be a positive integer', 400)
    }
    const maxSize = input.mediaKind === 'trailer' ? GIB : input.target === 'episode' ? 10 * GIB : 25 * GIB
    if (input.size > maxSize) {
      const limit = Math.round(maxSize / GIB)
      throw new OperationalError(`${input.mediaKind === 'trailer' ? 'Trailer' : 'Video'} must not exceed ${limit} GB`, 400)
    }

    const contentType = input.contentType?.startsWith('video/')
      ? input.contentType
      : 'application/octet-stream'
    const partSize = Math.max(DEFAULT_PART_SIZE, Math.ceil(input.size / MAX_PARTS))
    const totalParts = Math.ceil(input.size / partSize)
    const key = `railway-uploads/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${extension}`
    const bucket = AwsUtils.buckets.reeplay
    const created = await S3.createMultipartUpload(key, contentType, bucket)
    if (!created.UploadId) throw new OperationalError('Could not start multipart upload', 502)

    const session = await MultipartUploadModel.create({
      adminId: input.adminId,
      uploadId: created.UploadId,
      bucket,
      key,
      fileName: input.fileName,
      contentType,
      size: input.size,
      partSize,
      totalParts,
      mediaKind: input.mediaKind,
      target: input.target,
      expiresAt: new Date(Date.now() + ACTIVE_SESSION_HOURS * 60 * 60 * 1000),
    })

    return { sessionId: session._id, partSize, totalParts, expiresAt: session.expiresAt }
  }

  static signParts = async (sessionId: string, adminId: string, partNumbers: number[]) => {
    const session = await this.getSession(sessionId, adminId)
    if (session.status !== 'active' || session.expiresAt <= new Date()) {
      throw new OperationalError('Upload session has expired or is no longer active', 409)
    }
    const uniqueParts = [...new Set(partNumbers)]
    if (!uniqueParts.length || uniqueParts.length > 25 || uniqueParts.some(n => !Number.isInteger(n) || n < 1 || n > session.totalParts)) {
      throw new OperationalError('Request between 1 and 25 valid part numbers', 400)
    }
    return Promise.all(uniqueParts.map(async partNumber => ({
      partNumber,
      url: await S3.getSignedUploadPartUrl(session.key, session.uploadId, partNumber, session.bucket),
    })))
  }

  static status = async (sessionId: string, adminId: string) => {
    const session = await this.getSession(sessionId, adminId)
    const parts = session.status === 'active'
      ? await S3.listMultipartParts(session.key, session.uploadId, session.bucket)
      : []
    return {
      sessionId: session._id,
      status: session.status,
      partSize: session.partSize,
      totalParts: session.totalParts,
      uploadedParts: parts,
      videoUploadId: session.videoUploadId ?? null,
      expiresAt: session.expiresAt,
    }
  }

  static complete = async (sessionId: string, adminId: string) => {
    const session = await this.getSession(sessionId, adminId)
    if (session.status === 'completed' && session.videoUploadId) {
      return { videoUploadId: session.videoUploadId, status: 'processing' }
    }
    if (session.status !== 'active') throw new OperationalError('Upload session is not active', 409)

    if (session.status === 'active') {
      const parts = await S3.listMultipartParts(session.key, session.uploadId, session.bucket)
      if (parts.length !== session.totalParts || parts.some((part, index) => part.PartNumber !== index + 1)) {
        throw new OperationalError(`Upload is incomplete (${parts.length}/${session.totalParts} parts)`, 409)
      }
      await S3.completeMultipartUpload(session.key, session.uploadId, parts, session.bucket)
      const head = await S3.headObject(session.key, session.bucket)
      if (head.ContentLength !== session.size) {
        await S3.deleteObject(session.key, session.bucket)
        throw new OperationalError('Uploaded file size did not match the selected file', 400)
      }
      session.status = 'uploaded'
      session.expiresAt = new Date(Date.now() + ACTIVE_SESSION_HOURS * 60 * 60 * 1000)
      await session.save()
    }
    if (session.status !== 'uploaded') throw new OperationalError('Upload session cannot be completed', 409)

    const job = session.mediaKind === 'trailer'
      ? await MediaConvert.transcode720p(session.key)
      : await MediaConvert.transcode(session.key)
    const videoUpload = await VideoUploadModel.create({
      bucket: session.bucket,
      key: session.key,
      mimetype: session.contentType,
      size: session.size,
      isTranscoded: false,
      hlsStatus: 'processing',
      hlsJobId: job.Job?.Id ?? null,
      hlsKey: MediaConvert.getHlsMasterKey(session.key),
    })
    session.status = 'completed'
    session.videoUploadId = videoUpload._id
    session.expiresAt = new Date(Date.now() + COMPLETED_SESSION_DAYS * 24 * 60 * 60 * 1000)
    await session.save()
    return { videoUploadId: videoUpload._id, status: 'processing' }
  }

  static abort = async (sessionId: string, adminId: string) => {
    const session = await this.getSession(sessionId, adminId)
    if (session.status === 'active') {
      await S3.abortMultipartUpload(session.key, session.uploadId, session.bucket)
      session.status = 'aborted'
      session.expiresAt = new Date(Date.now() + 60 * 60 * 1000)
      await session.save()
    }
  }

  static cleanupAbandoned = async () => {
    // Run shortly before Mongo's TTL cleanup so S3 multipart parts and
    // unclaimed completed uploads are removed instead of becoming orphans.
    const sessions = await MultipartUploadModel.find({
      claimedAt: null,
      expiresAt: { $lte: new Date(Date.now() + 15 * 60 * 1000) },
      status: { $in: ['active', 'uploaded', 'completed', 'aborted'] },
    }).limit(100)

    let cleaned = 0
    for (const session of sessions) {
      try {
        if (session.status === 'active') {
          await S3.abortMultipartUpload(session.key, session.uploadId, session.bucket).catch(() => undefined)
        }
        if (session.status === 'uploaded') {
          await S3.deleteObject(session.key, session.bucket).catch(() => undefined)
        }
        if (session.status === 'completed' && session.videoUploadId) {
          const upload = await VideoUploadModel.findById(session.videoUploadId)
          if (upload) {
            if (upload.hlsJobId && upload.hlsStatus === 'processing') {
              await MediaConvert.cancelJob(upload.hlsJobId).catch(() => undefined)
            }
            const [legacyKeys, hlsKeys] = await Promise.all([
              S3.listKeys(`transcode/${upload.key}`),
              S3.listKeys(`railway-hls/${upload.key}/`),
            ])
            await S3.deleteObjects([...new Set([upload.key, ...legacyKeys, ...hlsKeys])], upload.bucket)
            await upload.deleteOne()
          }
        }
        await session.deleteOne()
        cleaned += 1
      } catch (error: any) {
        console.error('Could not clean abandoned multipart upload', session._id, error?.message ?? error)
      }
    }
    return cleaned
  }

  static claim = async ({
    videoUploadId,
    adminId,
    mediaKind,
    target,
    parentId,
    parentType,
    session,
  }: {
    videoUploadId: string
    adminId: string
    mediaKind: MediaKind
    target: UploadTarget
    parentId: Types.ObjectId
    parentType: 'vod' | 'vod-trailer' | 'episode' | 'episode-trailer'
    session?: ClientSession | null
  }) => {
    if (!Types.ObjectId.isValid(videoUploadId)) throw new OperationalError('Invalid completed upload id', 400)
    const uploadSession = await MultipartUploadModel.findOneAndUpdate(
      {
        adminId,
        videoUploadId,
        status: 'completed',
        claimedAt: null,
        mediaKind,
        target,
      },
      { $set: { claimedAt: new Date(), claimedParentId: parentId } },
      { new: true, session },
    )
    if (!uploadSession) throw new OperationalError('Completed upload is invalid, already used, or belongs to another admin', 409)
    const upload = await VideoUploadModel.findOneAndUpdate(
      { _id: videoUploadId, parentId: { $exists: false } },
      { $set: { parentId, parentType } },
      { new: true, session },
    )
    if (!upload) throw new OperationalError('Completed upload has already been assigned', 409)
    return upload
  }
}
