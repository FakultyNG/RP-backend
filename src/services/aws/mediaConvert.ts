import moment from 'moment'

import {
  CreateJobCommand,
  CreateJobCommandInput,
  CancelJobCommand,
  GetJobCommand,
  ListJobsCommand,
  Output,
} from '@aws-sdk/client-mediaconvert'

import { AwsUtils } from './utils'
import env from '../../env'

export const RAILWAY_HLS_PREFIX = 'railway-hls'
export const RAILWAY_HLS_MASTER_NAME = 'master.m3u8'

export const delay = (timeMS: number) => new Promise(res => setTimeout(res, timeMS))

type HlsRendition = {
  width: number
  height: number
  maxBitrate: number
  nameModifier: '_480p' | '_720p' | '_1080p'
}

export type HlsTranscodeProfile = 'adaptive' | 'single-480p' | 'single-720p'

const HLS_480P_RENDITION: HlsRendition = {
  width: 854,
  height: 480,
  maxBitrate: 1_500_000,
  nameModifier: '_480p',
}

const HLS_720P_RENDITION: HlsRendition = {
  width: 1280,
  height: 720,
  maxBitrate: 3_500_000,
  nameModifier: '_720p',
}

const HLS_ADAPTIVE_RENDITIONS: HlsRendition[] = [
  HLS_480P_RENDITION,
  HLS_720P_RENDITION,
  {
    width: 1920,
    height: 1080,
    maxBitrate: 6_500_000,
    nameModifier: '_1080p',
  },
]

const createHlsOutput = ({ width, height, maxBitrate, nameModifier }: HlsRendition): Output => ({
  ContainerSettings: {
    Container: 'M3U8',
    M3u8Settings: {
      AudioFramesPerPes: 4,
      PcrControl: 'PCR_EVERY_PES_PACKET',
      PmtPid: 480,
      PrivateMetadataPid: 503,
      ProgramNumber: 1,
      PatInterval: 0,
      PmtInterval: 0,
      Scte35Source: 'NONE',
      TimedMetadata: 'NONE',
      VideoPid: 481,
      AudioPids: [482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492],
    },
  },
  VideoDescription: {
    Width: width,
    Height: height,
    ScalingBehavior: 'FIT',
    Sharpness: 50,
    AntiAlias: 'ENABLED',
    CodecSettings: {
      Codec: 'H_264',
      H264Settings: {
        RateControlMode: 'QVBR',
        MaxBitrate: maxBitrate,
        QvbrSettings: {
          QvbrQualityLevel: 7,
        },
        QualityTuningLevel: 'SINGLE_PASS_HQ',
        CodecProfile: 'HIGH',
        CodecLevel: 'AUTO',
        InterlaceMode: 'PROGRESSIVE',
        FramerateControl: 'INITIALIZE_FROM_SOURCE',
        GopSize: 2,
        GopSizeUnits: 'SECONDS',
        GopClosedCadence: 1,
        NumberBFramesBetweenReferenceFrames: 2,
        NumberReferenceFrames: 3,
        SceneChangeDetect: 'TRANSITION_DETECTION',
        ParControl: 'INITIALIZE_FROM_SOURCE',
        EntropyEncoding: 'CABAC',
      },
    },
  },
  AudioDescriptions: [
    {
      AudioSourceName: 'Audio Selector 1',
      CodecSettings: {
        Codec: 'AAC',
        AacSettings: {
          Bitrate: 128000,
          CodingMode: 'CODING_MODE_2_0',
          SampleRate: 48000,
          RawFormat: 'NONE',
          Specification: 'MPEG4',
          AudioDescriptionBroadcasterMix: 'NORMAL',
        },
      },
      LanguageCodeControl: 'FOLLOW_INPUT',
    },
  ],
  NameModifier: nameModifier,
})

export class MediaConvert {
  static cancelJob = (jobId: string) =>
    AwsUtils.clients.mediaConvert.send(new CancelJobCommand({ Id: jobId }))

  private static _extractKey = (pathLike: string) => {
    const prefix = `s3://${AwsUtils.buckets.reeplay}/`
    return pathLike.startsWith(prefix) ? pathLike.slice(prefix.length) : pathLike
  }

  static getHlsPrefix = (inputKey: string) => `${RAILWAY_HLS_PREFIX}/${inputKey}`

  static getHlsMasterKey = (inputKey: string) =>
    `${this.getHlsPrefix(inputKey)}/${RAILWAY_HLS_MASTER_NAME}`

  static recentCompletedJobsKeyPairs = async () => {
    const response = await AwsUtils.clients.mediaConvert.send(
      new ListJobsCommand({
        Order: 'DESCENDING',
        Status: 'COMPLETE',
        Queue: env.RAILWAY_MEDIACONVERT_QUEUE_ARN || undefined,
      }),
    )

    if (!response.Jobs) return []

    const keys: Array<{ inputKey: string; outputKey: string }> = []

    for (const { Settings } of response.Jobs) {
      if (!Settings?.Inputs?.[0]?.FileInput) continue

      const destination =
        Settings.OutputGroups?.[0]?.OutputGroupSettings?.HlsGroupSettings?.Destination

      if (!destination) continue

      keys.push({
        inputKey: this._extractKey(Settings.Inputs[0].FileInput),
        outputKey: this._extractKey(destination),
      })
    }

    return keys
  }

  static waitForJobCompletion = async (jobId: string | undefined, maxWaitTimeMins = 30) => {
    if (typeof jobId !== 'string') return false

    const later = moment(new Date()).add(maxWaitTimeMins, 'm').toDate()

    while (later > new Date()) {
      const response = await AwsUtils.clients.mediaConvert.send(new GetJobCommand({ Id: jobId }))

      if (response.Job === undefined) break

      if (response.Job.Status === 'ERROR' || response.Job.Status === 'CANCELED') {
        console.error({
          'MediaConvert.waitForJobCompletion_error': {
            CreatedAt: response.Job.CreatedAt,
            ErrorCode: response.Job.ErrorCode,
            ErrorMessage: response.Job.ErrorMessage,
            inputKey: response.Job.Settings?.Inputs?.[0]?.FileInput,
          },
        })
        break
      }

      if (response.Job.Status === 'COMPLETE') return true

      await delay(5000)
    }

    return false
  }

  static getJob = async (jobId: string) => {
    const response = await AwsUtils.clients.mediaConvert.send(new GetJobCommand({ Id: jobId }))
    return response.Job
  }

  static transcode = async (key: string, profile: HlsTranscodeProfile = 'adaptive') => {
    const fileInput = AwsUtils.buckets.s3Input + key
    const destination = `${AwsUtils.buckets.railwayHlsOutput}${key}/master`
    const isSingle480p = profile === 'single-480p'
    const isSingle720p = profile === 'single-720p'
    const renditions = isSingle480p
      ? [HLS_480P_RENDITION]
      : isSingle720p
        ? [HLS_720P_RENDITION]
        : HLS_ADAPTIVE_RENDITIONS

    const params: CreateJobCommandInput = {
      Role: env.IAM_ROLE_ARN,
      Queue: env.RAILWAY_MEDIACONVERT_QUEUE_ARN || undefined,
      JobTemplate: env.RAILWAY_MEDIACONVERT_JOB_TEMPLATE || undefined,
      UserMetadata: {
        application: 'reeplay',
        backend: 'railway',
        pipeline: isSingle480p
          ? 'railway-hls-480p'
          : isSingle720p
            ? 'railway-hls-720p'
            : 'railway-hls-adaptive',
        profile,
        inputKey: key,
      },
      Settings: {
        TimecodeConfig: {
          Source: 'ZEROBASED',
        },
        Inputs: [
          {
            FileInput: fileInput,
            AudioSelectors: {
              'Audio Selector 1': {
                DefaultSelection: 'DEFAULT',
              },
            },
            VideoSelector: {},
            TimecodeSource: 'ZEROBASED',
          },
        ],
        OutputGroups: [
          {
            Name: isSingle480p
              ? 'railway-reeplay-hls-480'
              : isSingle720p
                ? 'railway-reeplay-hls-720'
                : 'railway-reeplay-hls-480-720-1080',
            Outputs: renditions.map(createHlsOutput),
            OutputGroupSettings: {
              Type: 'HLS_GROUP_SETTINGS',
              HlsGroupSettings: {
                Destination: destination,
                SegmentLength: 6,
                MinSegmentLength: 0,
                ManifestDurationFormat: 'INTEGER',
                OutputSelection: 'MANIFESTS_AND_SEGMENTS',
                SegmentControl: 'SEGMENTED_FILES',
                DirectoryStructure: 'SINGLE_DIRECTORY',
                ClientCache: 'ENABLED',
                CodecSpecification: 'RFC_4281',
                TimedMetadataId3Frame: 'PRIV',
                TimedMetadataId3Period: 10,
              },
            },
          },
        ],
      },
      StatusUpdateInterval: 'SECONDS_60',
      Priority: 0,
      AccelerationSettings: {
        Mode: 'DISABLED',
      },
    }

    return await AwsUtils.clients.mediaConvert.send(new CreateJobCommand(params))
  }

  static transcode480p = (key: string) => MediaConvert.transcode(key, 'single-480p')

  static transcode720p = (key: string) => MediaConvert.transcode(key, 'single-720p')
}
