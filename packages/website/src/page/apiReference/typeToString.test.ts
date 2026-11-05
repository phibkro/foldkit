import { Option, Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import { typeDefFromChildren, typeToString } from './typeToString.ts'
import { TypeDocItem, TypeDocTypeSchema } from './typedoc.ts'

const decodeType = Schema.decodeSync(Schema.fromJsonString(TypeDocTypeSchema))
const decodeItem = Schema.decodeSync(Schema.fromJsonString(TypeDocItem))

const props = `{
  "id": 1, "name": "__type", "variant": "declaration", "kind": 65536,
  "children": [
    {
      "id": 2, "name": "_tag", "variant": "declaration", "kind": 1024,
      "flags": { "isOptional": true },
      "type": { "type": "literal", "value": "Foldkit/Submodel/LoadError" }
    },
    {
      "id": 3, "name": "reason", "variant": "declaration", "kind": 1024,
      "type": { "type": "intrinsic", "name": "string" }
    }
  ]
}`

describe('TypeDoc tuple and property signatures', () => {
  test('decodes and renders labeled constructor props with optional fields', () => {
    const tuple = decodeType(`{
      "type": "tuple",
      "elements": [{
        "type": "namedTupleMember", "name": "props", "isOptional": false,
        "element": { "type": "reflection", "declaration": ${props} }
      }]
    }`)

    expect(typeToString(Option.some(tuple))).toBe(
      '[\n  props: {\n    _tag?: "Foldkit/Submodel/LoadError"\n    reason: string\n  }\n]',
    )
  })

  test('preserves optional and rest labels in a tuple', () => {
    const tuple = decodeType(`{
      "type": "tuple",
      "elements": [
        {
          "type": "namedTupleMember", "name": "options", "isOptional": true,
          "element": { "type": "intrinsic", "name": "boolean" }
        },
        {
          "type": "rest",
          "elementType": {
            "type": "namedTupleMember", "name": "extra", "isOptional": false,
            "element": { "type": "array", "elementType": { "type": "intrinsic", "name": "number" } }
          }
        }
      ]
    }`)

    expect(typeToString(Option.some(tuple))).toBe(
      '[options?: boolean, ...extra: Array<number>]',
    )
  })

  test('preserves optional fields in declaration type blocks', () => {
    expect(typeDefFromChildren(decodeItem(props).children)).toBe(
      '{\n  _tag?: "Foldkit/Submodel/LoadError"\n  reason: string\n}',
    )
  })
})
