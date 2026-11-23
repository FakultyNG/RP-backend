import { HydratedDocumentFromSchema, InferSchemaType, Schema, model } from 'mongoose'

const schema = new Schema(
  {
    name: {
      type: String,
      trim: true,
      unique: true,
      required: true,
    },

    position: {
      type: Number,
      required: true,
      min: 1,
    },

    location: {
      type: String,
      enum: [
        'Homepage',
        'Live/Channels',
        'Live/Events',
        'Live/Tv Shows',
        'Live/Sports',
        'Live/Podcast',
      ],
      default: 'Homepage',
      index: true,
    },

    feedType: {
      type: String,
      enum: ['standard', 'personalized'],
      default: 'standard',
      index: true,
    },

    active: {
      type: Boolean,
      default: true,
      index: true,
    },
  },

  {
    timestamps: true,
  },
)

// Positions describe ordering within a placement. Homepage position 1 and
// Live/Channels position 1 are therefore both valid.
schema.index({ location: 1, position: 1 }, { unique: true })

export const CategoryEnumModel = model('category_enums', schema)
export type CategoryEnumSchema = InferSchemaType<typeof schema>
export type CategoryEnum = HydratedDocumentFromSchema<typeof schema>
