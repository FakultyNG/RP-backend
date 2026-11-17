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
      unique: true,
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
  },

  {
    timestamps: true,
  },
)

export const CategoryEnumModel = model('category_enums', schema)
export type CategoryEnumSchema = InferSchemaType<typeof schema>
export type CategoryEnum = HydratedDocumentFromSchema<typeof schema>
