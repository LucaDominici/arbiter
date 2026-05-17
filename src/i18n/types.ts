// SPDX-License-Identifier: Apache-2.0

export type Catalog = ReadonlyMap<string, string>

export type CatalogRaw = { [key: string]: CatalogRaw | string }
