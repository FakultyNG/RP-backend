import {InferSchemaType, Schema, model} from 'mongoose'

const schema = new Schema(
  {
    key: {
      type: String,
      default: 'home',
      unique: true,
      immutable: true,
    },
    videoIds: {
      type: [{type: Schema.Types.ObjectId, ref: 'videos'}],
      default: [],
      validate: {
        validator: (ids: unknown[]) => ids.length <= 10,
        message: 'Top 10 cannot contain more than 10 titles',
      },
    },
  },
  {timestamps: true, versionKey: false},
)

export const TopTenModel = model('top_ten', schema)
export type TopTenSchema = InferSchemaType<typeof schema>
