export default `import { ColumnType, Kysely } from "kysely"
import * as schema from "zapatos/schema"
import { Parameter, SQLFragment } from "zapatos/db"

type ZapatosInsertableTypeToPrimitive<T, Selectable> =
  | Exclude<T, symbol | Parameter | SQLFragment<any, any>>
  // Preserve custom data types that structurally resemble a Zapatos wrapper.
  | Extract<T, Selectable>

export type ZapatosTableNameToKyselySchema<T extends schema.Table> = {
  [K in keyof schema.SelectableForTable<T>]: ColumnType<
    schema.SelectableForTable<T>[K],
    K extends keyof schema.InsertableForTable<T>
      ? ZapatosInsertableTypeToPrimitive<
          schema.InsertableForTable<T>[K],
          schema.SelectableForTable<T>[K]
        >
      : never,
    K extends keyof schema.UpdatableForTable<T>
      ? ZapatosInsertableTypeToPrimitive<
          schema.UpdatableForTable<T>[K],
          schema.SelectableForTable<T>[K]
        >
      : never
  >
}

export type KyselySchema = {
  readonly [T in schema.Table]: ZapatosTableNameToKyselySchema<T>
}

export type KyselyDatabaseInstance = Kysely<KyselySchema>`
