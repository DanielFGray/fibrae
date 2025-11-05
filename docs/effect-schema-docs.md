# Effect Schema API - Quick Reference

**DO NOT manually validate. Schema = type-safe validation + transformation.**

`import * as S from "effect/Schema"`

## Primitives

**S.String** | **S.Number** | **S.Boolean** | **S.BigIntFromSelf** | **S.SymbolFromSelf** | **S.Object** | **S.Unknown** | **S.Any** | **S.Never** | **S.Void** | **S.Undefined** | **S.Null**

## Strings

**S.NonEmptyString** - must have length > 0
**S.Trim** - removes whitespace
**S.Lowercase** | **S.Uppercase** | **S.Capitalize** - transforms case
**S.Length(n)** | **S.length({ min, max })** | **S.minLength(n)** | **S.maxLength(n)** - length constraints
**S.startsWith(str)** | **S.endsWith(str)** | **S.includes(str)** - pattern matching
**S.pattern(regex)** - custom regex validation
**S.trimmed()** | **S.lowercased()** | **S.uppercased()** | **S.capitalized()** | **S.uncapitalized()** - validation (NOT transformation)
**S.Email** | **S.UUID** | **S.ULID** | **S.URL** - common formats
**S.TemplateLiteral(...)** - template literal types with schemas
**S.TemplateLiteralParser(...)** - parse template literal to tuple
**S.split(separator)** - split string into array

## Numbers

**S.Int** | **S.NonNaN** | **S.Finite** - number constraints
**S.Positive** | **S.Negative** | **S.NonNegative** | **S.NonPositive** - sign constraints  
**S.PositiveNumber** | **S.NegativeNumber** | **S.NonNegativeNumber** | **S.NonPositiveNumber** - aliases
**S.NonNegativeInt** | **S.Uint8** - specialized integers
**S.between(min, max)** | **S.greaterThan(n)** | **S.greaterThanOrEqualTo(n)** | **S.lessThan(n)** | **S.lessThanOrEqualTo(n)** - range
**S.int()** | **S.nonNaN()** | **S.finite()** | **S.positive()** | **S.negative()** | **S.nonNegative()** | **S.nonPositive()** - filters
**S.multipleOf(n)** - divisibility constraint
**S.NumberFromString** - "123" → 123
**S.clamp(min, max)** - clamp to range

## BigInt

**S.BigIntFromSelf** - BigInt type
**S.BigInt** - string ↔ bigint transformation
**S.PositiveBigIntFromSelf** | **S.NonNegativeBigIntFromSelf** | **S.NegativeBigIntFromSelf** | **S.NonPositiveBigIntFromSelf** - sign constraints
**S.greaterThanBigInt(n)** | **S.greaterThanOrEqualToBigInt(n)** | **S.lessThanBigInt(n)** | **S.lessThanOrEqualToBigInt(n)** | **S.betweenBigInt(min, max)** - range
**S.positiveBigInt()** | **S.negativeBigInt()** | **S.nonNegativeBigInt()** | **S.nonPositiveBigInt()** - filters

## BigDecimal

**S.BigDecimal** - Effect BigDecimal type
**S.PositiveBigDecimalFromSelf** | **S.NonNegativeBigDecimalFromSelf** | **S.NegativeBigDecimalFromSelf** | **S.NonPositiveBigDecimalFromSelf** - sign constraints
**S.greaterThanBigDecimal(n)** | **S.greaterThanOrEqualToBigDecimal(n)** | **S.lessThanBigDecimal(n)** | **S.lessThanOrEqualToBigDecimal(n)** | **S.betweenBigDecimal(min, max)** - range
**S.positiveBigDecimal()** | **S.negativeBigDecimal()** | **S.nonNegativeBigDecimal()** | **S.nonPositiveBigDecimal()** - filters

## Dates & Time

**S.Date** - Date ↔ ISO string
**S.DateFromString** - parse string to Date
**S.ValidDateFromSelf** - ensures valid date (not Invalid Date)
**S.validDate()** - filter for valid dates
**S.greaterThanDate(d)** | **S.greaterThanOrEqualToDate(d)** | **S.lessThanDate(d)** | **S.lessThanOrEqualToDate(d)** | **S.betweenDate(min, max)** - range
**S.DateTimeUtc** - UTC datetime string
**S.Duration** | **S.DurationFromSelf** | **S.DurationFromNanos** | **S.DurationFromMillis** - Effect Duration
**S.greaterThanDuration(d)** | **S.greaterThanOrEqualToDuration(d)** | **S.lessThanDuration(d)** | **S.lessThanOrEqualToDuration(d)** | **S.betweenDuration(min, max)** - duration range

## Collections

**S.Array(S)** - readonly array (use `.pipe(S.mutable(...))` for mutable)
**S.NonEmptyArray(S)** - at least one element
**S.Tuple(...schemas)** - fixed-length tuple
**S.Record({ key: K, value: V })** - record/map structure
**S.minItems(n)** | **S.maxItems(n)** | **S.itemsCount(n)** - array constraints
**S.ReadonlySetFromSelf(S)** | **S.ReadonlyMapFromSelf({ key, value })** - Set/Map
**S.HashSet(S)** | **S.HashMap({ key, value })** | **SortedSet(S)** - Effect collections
**S.ChunkFromSelf(S)** - Effect Chunk
**S.head** - get first array element (returns Option)
**S.pluck(field)** - extract single field from struct

## Structures

**S.Struct({ field: schema })** - object with typed fields
**S.pick(schema, ...keys)** - select fields
**S.omit(schema, ...keys)** - remove fields
**S.partial(schema)** - make all fields optional
**S.required(schema)** - make all fields required
**S.extend(base, extension)** - combine structs
**S.instanceOf(constructor)** - validate class instances (e.g., `instanceOf(File)`)
**S.attachPropertySignature(name, schema)** - attach computed property to struct
**S.pickLiteral(schema, ...literals)** - narrow literal union to specific values

## Unions & Intersections

**S.Union(...schemas)** - A | B | C
**S.Literal(...values)** - literal value types
**S.Enums(enumObj)** - TypeScript enum
**S.keyof(schema)** - union of struct keys

## Nullability & Optionality

**S.NullOr(S)** | **S.UndefinedOr(S)** | **S.NullishOr(S)** - T | null/undefined
**S.optional(schema)** - field?: T | undefined
**S.optional(schema, { default: () => val })** - field: T (with default)
**S.optional(schema, { exact: true })** - field?: T (no undefined)
**S.Option(S)** - Option transformation (encodes to union)
**S.OptionFromSelf(S)** - Option type (no transformation)
**S.OptionFromNullOr(S)** - null → None, value → Some
**S.OptionFromUndefinedOr(S)** - undefined → None, value → Some
**S.OptionFromNullishOr(S)** - null/undefined → None, value → Some
**S.OptionFromNonEmptyTrimmedString** - empty/whitespace → None, trimmed → Some

## Effect Types

**S.EitherFromSelf({ left: L, right: R })** - Effect Either (no transformation)
**S.EitherFromUnion({ left: L, right: R })** - union → Either transformation
**S.ExitFromSelf({ success: A, failure: E })** - Effect Exit
**S.CauseFromSelf(E)** - Effect Cause
**S.Data** - add Equal/Hash traits to struct
**S.Config(schema)** - validate Effect config values
**S.Redacted(S)** - sensitive data (hides value in logs)
**S.Secret** - alias for Redacted string (like API keys)

## Transformations

**S.transform(from, to, { strict: true, decode, encode })** - pure transform (ALWAYS strict: true)
**S.transformOrFail(from, to, { strict: true, decode, encode })** - effectful transform
**S.compose(schema1, schema2)** - chain transformations
**S.parseJson(schema)** - parse JSON + validate
**S.Not** - invert boolean
**S.mutable(schema)** - make readonly array/collection mutable

## Validation & Filters

**S.filter(predicate)** - runtime constraint
**S.filter(predicate, { message })** - with custom error
**S.filterEffect(predicateEffect)** - effectful predicate
**S.compose(base, filter)** - apply filter to schema

## Branding

**S.brand(name)** - create branded type (e.g., `S.String.pipe(S.brand("UserId"))`)
**S.fromBrand(constructor)** - create schema from branded constructor

## Property Signatures & Annotations

**S.propertySignature(schema)** - annotate struct field
**S.fromKey(externalKey)** - map external key to internal (e.g., `external_name` → `internalName`)
**S.optional(schema)** - make field optional
**S.annotations({ identifier, description, title, examples, ... })** - attach metadata to schema (for docs, JSON Schema export)

## Recursive & Lazy

**S.suspend(() => schema)** - lazy evaluation for recursion
**S.declare(guard, options)** - custom type guards (e.g., `instanceof File`)

## Decoding (Validation)

**S.decodeUnknown(schema)(input)** - Effect<Type, ParseError> (DEFAULT in Effect programs)
**S.decodeUnknownSync(schema)(input)** - Type (throws) - tests only
**S.decodeUnknownEither(schema)(input)** - Either<ParseError, Type>
**S.decodeUnknownOption(schema)(input)** - Option<Type>
**S.decodeUnknownPromise(schema)(input)** - Promise<Type>
**S.decode(schema)(encoded)** - like decodeUnknown but typed input
**S.validate(schema)(input)** - alias for decodeUnknown
**S.is(schema)(value)** - type guard (boolean)
**S.asserts(schema)(value)** - assertion (throws)

## Encoding (Serialization)

**S.encode(schema)(value)** - Effect<Encoded, ParseError>
**S.encodeSync(schema)(value)** - Encoded (throws)
**S.encodeEither(schema)(value)** - Either<ParseError, Encoded>
**S.encodeOption(schema)(value)** - Option<Encoded>
**S.encodePromise(schema)(value)** - Promise<Encoded>

## Type Extraction

```typescript
import * as S from "effect/Schema"

// Long form using Schema namespace
type User = S.Schema.Type<typeof UserSchema>       // extract validated/output type
type UserInput = S.Schema.Encoded<typeof UserSchema> // extract input/encoded type
type UserDeps = S.Schema.Context<typeof UserSchema>  // extract required services

// Shorthand using schema instance properties
type User = typeof UserSchema.Type
type UserInput = typeof UserSchema.Encoded
type UserDeps = typeof UserSchema.Context
```

## Parsing Options

```typescript
S.decodeUnknown(schema, {
  errors: "first" | "all",           // error reporting
  onExcessProperty: "ignore" | "error" | "preserve"
})(input)
```

## Common Anti-Patterns

❌ `typeof x === "string"` → ✅ `S.String`
❌ `if (x == null)` → ✅ `S.NullOr(...)` or `S.OptionFromNullOr(...)`
❌ `parseFloat(str)` → ✅ `S.NumberFromString`
❌ `new Date(str)` → ✅ `S.DateFromString`
❌ `str.trim().toLowerCase()` → ✅ `S.String.pipe(S.Trim, S.Lowercase)`
❌ `JSON.parse(x)` → ✅ `S.parseJson(schema)`
❌ `data as User` → ✅ `yield* S.decodeUnknown(UserSchema)(data)`
❌ `S.decodeUnknownSync` in Effect → ✅ `S.decodeUnknown` (returns Effect)
❌ `type UserId = string` → ✅ `S.String.pipe(S.brand("UserId"))`
❌ `field?: T; use(x ?? default)` → ✅ `S.optional(T, { default: () => ... })`
❌ `if (validated.age < 18) fail(...)` → ✅ `S.Number.pipe(S.filter(n => n >= 18))`

## Rules

1. **Validate at boundaries** (component props, API responses, config)
2. **Use `S.decodeUnknown` in Effect** (NOT Sync variants)
3. **Always `strict: true`** in transforms
4. **Brand domain IDs** (UserId, PostId, etc.)
5. **Schema = source of truth** for types (use `S.Schema.Type<...>`)
6. **Defaults in schema** over `?? fallback` everywhere
