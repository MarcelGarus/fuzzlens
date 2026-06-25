import { Value, Universe, Shape, GroupKey, SingleKey, CompositeKey, KeyPart } from '../types/state';
import { RunResult, RunResultInGroup } from '../types/state';

export interface ShapeValue {
    id?: { value: number };
    universe?: Universe;
}

/**
 * Format a Shape (new discriminated union format from Java serialization).
 */
export function formatShapeNew(shape: Shape, maxMembers: number = 10): string {
    switch (shape.type) {
        case 'Null':
            return 'null';
        case 'Boolean':
            return 'boolean';
        case 'Int':
            return 'int';
        case 'Double':
            return 'double';
        case 'String':
            return 'string';
        case 'Object': {
            const members = Object.entries(shape.members);
            if (members.length === 0) {
                return '{}';
            }
            if (members.length <= maxMembers) {
                const memberStrs = members.map(([key, val]) => {
                    return `${key}: ${formatShapeNew(val, maxMembers)}`;
                });
                return `{${memberStrs.join(', ')}}`;
            }
            const memberStrs = members.slice(0, maxMembers).map(([key, val]) => {
                return `${key}: ${formatShapeNew(val, maxMembers)}`;
            });
            return `{${memberStrs.join(', ')}, +${members.length - maxMembers}}`;
        }
    }
}

/**
 * Format a property shape union (Map<String, Set<Shape>>) from observedSignature aggregation.
 */
export function formatPropertyShapeUnion(inputShapes: Record<string, unknown>): string {
    const sortUnionTypes = (types: string[]): string[] => {
        const rank = (t: string): number => {
            const normalized = t.toLowerCase();
            if (normalized === 'null') { return 0; }
            if (normalized === 'boolean' || normalized === 'bool') { return 1; }
            if (normalized === 'int') { return 2; }
            if (normalized === 'double' || normalized === 'float') { return 3; }
            if (normalized === 'string' || normalized === 'str') { return 4; }
            if (normalized === 'crash') { return 999; }
            return 100;
        };

        return Array.from(new Set(types)).sort((a, b) => {
            const rankDiff = rank(a) - rank(b);
            if (rankDiff !== 0) {
                return rankDiff;
            }
            return a.localeCompare(b);
        });
    };

    // Handle the special __type__ key for primitives
    if (Object.keys(inputShapes).length === 1 && inputShapes['__type__']) {
        const shapes = inputShapes['__type__'] as Shape[];
        if (Array.isArray(shapes)) {
            return sortUnionTypes(shapes.map(s => formatShapeNew(s))).join(' | ');
        }
    }

    // Handle object properties
    const entries = Object.entries(inputShapes)
        .filter(([key]) => key !== '__type__')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, shapes]) => {
            if (Array.isArray(shapes)) {
                const shapeStrs = sortUnionTypes((shapes as Shape[]).map(s => formatShapeNew(s, 1))).join(' | ');
                return `${key}: ${shapeStrs}`;
            }
            return `${key}: unknown`;
        });

    if (entries.length === 0) {
        return 'any';
    }

    return `{${entries.join(', ')}}`;
}

/**
 * Format a shape value from a universe for display (legacy format).
 * 
 * @example
 * // id=1, universe: { objects: { $1: { members: { a: Int, b: Object#2 } }, $2: { members: { c: String } } } }
 * formatShape({ id: { value: 1 }, universe }) // => "{a: int, b: {c: str}}"
 */
export function formatShape(shape: ShapeValue, maxMembers: number = 10): string {
    if (!shape.id || !shape.universe) {
        return 'primitive';
    }

    const objDef = shape.universe.objects['$' + shape.id.value];
    if (!objDef || Object.keys(objDef.members).length === 0) {
        return '{}';
    }

    const members = Object.entries(objDef.members);
    if (members.length <= maxMembers) {
        const memberStrs = members.map(([key, val]) => {
            const typeStr = formatValueType(val, shape.universe!);
            return `${key}: ${typeStr}`;
        });
        return `{${memberStrs.join(', ')}}`;
    }

    const memberStrs = members.slice(0, maxMembers).map(([key, val]) => {
        const typeStr = formatValueType(val, shape.universe!);
        return `${key}: ${typeStr}`;
    });
    return `{${memberStrs.join(', ')}, +${members.length - maxMembers}}`;
}

/**
 * Format a value for display.
 * 
 * @example
 * // value: { type: "Object", id: { value: 1 } }
 * // universe: { objects: { $1: { members: { a: 42, b: "hello" } } } }
 * formatValue(value, universe) // => "{a: 42, b: "hello"}"
 */
export function formatValue(
    value: Partial<Value> & { type?: string } | null | undefined,
    universe: Universe,
    options: { maxStringLength?: number; maxMembers?: number } = {}
): string {
    const { maxStringLength = 80, maxMembers = 10 } = options;

    if (!value || Object.keys(value).length === 0) {
        return '{}';
    }

    // Handle object reference
    if ('id' in value && value.id) {
        const objDef = universe.objects['$' + value.id.value];
        if (objDef) {
            const members = Object.entries(objDef.members);
            if (members.length === 0) {
                return '{}';
            }
            if (members.length <= maxMembers) {
                const memberStrs = members.map(([key, val]) =>
                    `${key}: ${formatValue(val, universe, options)}`
                );
                return `{${memberStrs.join(', ')}}`;
            }
            const memberStrs = members.slice(0, maxMembers).map(([key, val]) =>
                `${key}: ${formatValue(val, universe, options)}`
            );
            return `{${memberStrs.join(', ')}, +${members.length - maxMembers}}`;
        }
        return `Object#${value.id.value}`;
    }

    // Handle primitive values
    if ('value' in value) {
        const v = value.value;
        if (typeof v === 'string') {
            if (v.length > maxStringLength) {
                return `"${v.substring(0, maxStringLength - 3)}..."`;
            }
            return `"${v}"`;
        }
        if (typeof v === 'number') {
            if (Number.isInteger(v)) {
                return String(v);
            }
            return v.toFixed(2);
        }
        if (typeof v === 'boolean') {
            return String(v);
        }
        return String(v);
    }

    // Handle null type
    if ('type' in value && value.type === 'Null') {
        return 'null';
    }

    return 'unknown';
}

/**
 * Format a value's type for display.
 * 
 * @example
 * // value: { type: "Object", id: { value: 1 } }
 * // universe: { objects: { $1: { members: { a: Int, b: String } } }
 * formatValueType(value, universe) // => "{a: int, b: str}"
 */
export function formatValueType(value: Value, universe: Universe): string {
    if ('type' in value) {
        switch (value.type) {
            case 'Null': return 'null';
            case 'Boolean': return 'bool';
            case 'Int': return 'int';
            case 'Double': return 'float';
            case 'String': return 'str';
            case 'Object':
                if (value.id) {
                    const objDef = universe.objects['$' + value.id.value];
                    if (objDef) {
                        return formatShape({ id: value.id, universe });
                    }
                }
                return 'object';
        }
    }
    return 'unknown';
}

/**
 * Format a function's argument list for display: a single argument is rendered
 * bare, several as a comma-separated list (so it reads naturally inside
 * `fn(...)`). Mirrors the backend's `Value.formatArgs`.
 */
export function formatArgs(
    args: (Partial<Value> & { type?: string })[] | null | undefined,
    universe: Universe,
    options: { maxStringLength?: number; maxMembers?: number } = {}
): string {
    if (!args || args.length === 0) {
        return '';
    }
    return args.map((arg) => formatValue(arg, universe, options)).join(', ');
}

/**
 * Format a run result as "input → output" for display.
 */
export function formatRunResult(
    result: RunResult | RunResultInGroup,
    options: { maxLength?: number } = {}
): string {
    const { maxLength = 80 } = options;

    const inputValue = formatArgs(result.args, result.universe);

    let output: string;
    if (result.didCrash) {
        const errorType = result.message?.split(':')[0] || 'Error';
        output = errorType;
    } else {
        output = result.value || 'void';
    }

    const full = `${inputValue} → ${output}`;

    if (full.length <= maxLength) {
        return full;
    }

    // Truncate intelligently
    const arrowPart = ' → ';
    const availableLength = maxLength - arrowPart.length - 3; // 3 for "..."
    const halfLength = Math.floor(availableLength / 2);

    const truncInput = inputValue.length > halfLength
        ? inputValue.substring(0, halfLength - 3) + '...'
        : inputValue;
    const truncOutput = output.length > halfLength
        ? output.substring(0, halfLength - 3) + '...'
        : output;

    return `${truncInput}${arrowPart}${truncOutput}`;
}

export function truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) {
        return str;
    }
    return str.substring(0, maxLength - 3) + '...';
}

/**
 * Format a property shape union (from AggregationSpec.propertyShapeUnion).
 * Handles the special `__type__` key for primitive types.
 * 
 * @example
 * // input: { "__type__": ["int", "str"], "bar": ["float"] }
 * formatPropertyShapeUnion(input) // => "int | str | {bar: float}"
 * 
 * @example  
 * // input: { "a": ["int"], "b": ["str", "null"] }
 * formatPropertyShapeUnion(input) // => "{a: int, b: str | null}"
 */
// export function formatPropertyShapeUnion(
//     shapeUnion: Record<string, unknown> | undefined,
//     options: { maxFields?: number; maxTypes?: number } = {}
// ): string {
//     if (!shapeUnion || typeof shapeUnion !== 'object') {
//         return 'unknown';
//     }

//     const { maxFields = 3, maxTypes = 3 } = options;
//     const parts: string[] = [];

//     const nested = buildNested(shapeUnion as Record<string, unknown>);

//     // Handle __type__ (primitive types) first
//     const primitiveTypes = nested['__type__'];
//     if (primitiveTypes) {
//         const types = extractTypeStrings(primitiveTypes);
//         if (types.length > 0) {
//             parts.push(...types.slice(0, maxTypes));
//             if (types.length > maxTypes) {
//                 parts.push(`+${types.length - maxTypes}`);
//             }
//         }
//     }

//     // Handle object fields (excluding __type__)
//     const fields = Object.entries(nested).filter(([key]) => key !== '__type__');
//     if (fields.length > 0) {
//         const fieldStrs: string[] = [];
//         for (const [key, val] of fields.slice(0, maxFields)) {
//             const typeStr = formatNode(val, maxTypes, maxFields);
//             fieldStrs.push(`${key}: ${typeStr}`);
//         }

//         let objStr = `{${fieldStrs.join(', ')}}`;
//         if (fields.length > maxFields) {
//             objStr = `{${fieldStrs.join(', ')}, +${fields.length - maxFields}}`;
//         }
//         parts.push(objStr);
//     }

//     return parts.length > 0 ? parts.join(' | ') : 'unknown';
// }

// Build nested structure from dotted keys (e.g. "foo.bar" -> { foo: { bar: [...] } })
function buildNested(flat: Record<string, unknown>): Record<string, unknown> {
    const root: Record<string, unknown> = {};

    // first copy non-dotted keys
    for (const [k, v] of Object.entries(flat)) {
        if (!k.includes('.')) {
            root[k] = v;
        }
    }

    // then place dotted keys into nested maps
    for (const [k, v] of Object.entries(flat)) {
        if (!k.includes('.')) { continue; }
        const partsKey = k.split('.');
        let cur: Record<string, unknown> = root;
        for (let i = 0; i < partsKey.length; i++) {
            const part = partsKey[i];
            const last = i === partsKey.length - 1;
            if (last) {
                // assign leaf
                const existing = cur[part];
                if (existing === undefined) {
                    cur[part] = v;
                } else if (Array.isArray(existing)) {
                    // merge arrays
                    cur[part] = Array.from(new Set([...existing, ...(Array.isArray(v) ? v : [v])] as any));
                } else {
                    // existing is object or primitive -> wrap into object with __type__ if needed
                    if (typeof existing === 'object' && existing !== null) {
                        // merge by converting to array under __type__
                        const arr = (existing as any).__type__ ? (existing as any).__type__ : [existing];
                        const newArr = Array.isArray(v) ? v : [v];
                        (existing as any).__type__ = Array.from(new Set([...arr, ...newArr] as any));
                        cur[part] = existing;
                    } else {
                        cur[part] = Array.from(new Set([existing, ...(Array.isArray(v) ? v : [v])] as any));
                    }
                }
            } else {
                if (cur[part] === undefined) {
                    cur[part] = {};
                } else if (!cur[part] || typeof cur[part] !== 'object' || Array.isArray(cur[part])) {
                    // convert existing leaf into nested object with __type__
                    const existing = cur[part];
                    cur[part] = {};
                    if (existing !== undefined) {
                        (cur[part] as any)['__type__'] = Array.isArray(existing) ? existing : [existing];
                    }
                }
                cur = cur[part] as Record<string, unknown>;
            }
        }
    }

    return root;
}

// Helper to format nested node (array of shapes or nested object)
function formatNode(node: unknown, maxTypes = 3, maxFields = 3): string {
    if (node === null || node === undefined) { return 'unknown'; }
    if (Array.isArray(node)) {
        const types = extractTypeStrings(node);
        if (types.length === 0) { return 'unknown'; }
        return types.length > 1 ? types.slice(0, maxTypes).join(' | ') + (types.length > maxTypes ? ` +${types.length - maxTypes}` : '') : types[0];
    }
    if (typeof node === 'object') {
        const obj = node as Record<string, unknown>;
        const keys = Object.keys(obj);
        // If this object looks like a shape object (id/universe/type/members), defer to formatShapeToTypeString
        if ('id' in obj || 'type' in obj || 'members' in obj) {
            return formatShapeToTypeString(obj);
        }

        // Otherwise it's a nested map of child fields (possibly with __type__)
        const prim = obj['__type__'];
        const childKeys = keys.filter(k => k !== '__type__');

        const primStr = prim ? (() => {
            const t = extractTypeStrings(prim);
            return t.length > 1 ? t.slice(0, maxTypes).join(' | ') + (t.length > maxTypes ? ` +${t.length - maxTypes}` : '') : (t[0] || 'unknown');
        })() : null;

        const childStrs = childKeys.map(k => `${k}: ${formatNode(obj[k], maxTypes, maxFields)}`);

        if (primStr && childStrs.length > 0) {
            return primStr + ' | ' + `{${childStrs.join(', ')}}`;
        }
        if (childStrs.length > 0) {
            return `{${childStrs.slice(0, maxFields).join(', ')}${childKeys.length > maxFields ? `, +${childKeys.length - maxFields}` : ''}}`;
        }
        return primStr || 'unknown';
    }
    return String(node);
}

/**
 * Extract type strings from a set/array of shape values.
 */
function extractTypeStrings(value: unknown): string[] {
    if (!value) { return []; }
    
    // Handle Set-like objects (from JSON they come as arrays or objects with values)
    if (Array.isArray(value)) {
        return value.map(v => formatShapeToTypeString(v));
    }
    
    // Handle Set serialized as object with entries
    if (typeof value === 'object' && value !== null) {
        const entries = Object.values(value);
        return entries.map(v => formatShapeToTypeString(v));
    }
    
    return [String(value)];
}

/**
 * Format a shape value to a type string (for union display).
 */
function formatShapeToTypeString(shape: unknown): string {
    if (!shape) { return 'null'; }
    if (typeof shape === 'string') { return shape; }
    
    // Handle shape objects from the fuzzer
    if (typeof shape === 'object' && shape !== null) {
        const s = shape as Record<string, unknown>;
        
        // Handle shape with id and universe (like ShapeValue)
        if ('id' in s && 'universe' in s && s.id && s.universe) {
            const id = s.id as { value: number };
            const universe = s.universe as Universe;
            const objDef = universe.objects['$' + id.value];
            if (objDef) {
                const keys = Object.keys(objDef.members);
                if (keys.length === 0) { return '{}'; }
                const parts = keys.map(k => {
                    const memberVal = objDef.members[k];
                    return `${k}: ${formatShapeToTypeString({ ...memberVal, universe })}`;
                });
                return `{${parts.join(', ')}}`;
            }
            return `obj#${id.value}`;
        }
        
        // Primitive shape types
        if ('type' in s) {
            switch (s.type) {
                case 'Null': return 'null';
                case 'Boolean': return 'bool';
                case 'Int': return 'int';
                case 'Double': return 'float';
                case 'String': return 'str';
                case 'Object': 
                    // If we have universe context, resolve the object
                    if (s.id && s.universe) {
                        const id = s.id as { value: number };
                        const universe = s.universe as Universe;
                        const objDef = universe.objects['$' + id.value];
                        if (objDef) {
                            const keys = Object.keys(objDef.members);
                            if (keys.length === 0) { return '{}'; }
                            const parts = keys.map(k => {
                                const memberVal = objDef.members[k];
                                return `${k}: ${formatShapeToTypeString({ ...memberVal, universe })}`;
                            });
                            return `{${parts.join(', ')}}`;
                        }
                    }
                    return s.id ? `obj#${(s.id as { value: number }).value}` : 'object';
            }
        }
        
        // Object shape with members
        if ('members' in s && typeof s.members === 'object') {
            const members = s.members as Record<string, unknown>;
            const keys = Object.keys(members);
            if (keys.length === 0) { return '{}'; }
            const parts = keys.map(k => `${k}: ${formatShapeToTypeString(members[k])}`);
            return `{${parts.join(', ')}}`;
        }
    }
    
    return String(shape);
}

// === Group Key Formatting ===

/**
 * Format a GroupKey for display.
 * Handles Root, Single, and Composite keys from Java GroupKeyAdapter serialization.
 */
export function formatGroupKey(key: GroupKey): string {
    if (!key || typeof key !== 'object') {
        return String(key);
    }

    switch (key.type) {
        case 'Root':
            return '<root>';
        case 'Single': {
            const single = key as SingleKey;
            return `${single.column}=${formatKeyValue(single.value)}`;
        }
        case 'Composite': {
            const composite = key as CompositeKey;
            if (!composite.parts || composite.parts.length === 0) {
                return '<empty>';
            }
            return composite.parts.map(p => formatKeyPart(p)).join(' | ');
        }
        default:
            return String(key);
    }
}

/**
 * Format a KeyPart (column + value) for display.
 */
export function formatKeyPart(part: KeyPart): string {
    if (!part || typeof part !== 'object') {
        return String(part);
    }
    return `${part.column}=${formatKeyValue(part.value)}`;
}

/**
 * Format a key value for display.
 * Handles various types: Shape, string, number, array, etc.
 */
export function formatKeyValue(value: unknown): string {
    if (value === null || value === undefined) {
        return 'null';
    }

    // Check if it's a Shape (has 'type' field matching Shape types)
    if (typeof value === 'object' && 'type' in value) {
        const typed = value as { type: string };
        if (['Null', 'Boolean', 'Int', 'Double', 'String', 'Object'].includes(typed.type)) {
            return formatShapeNew(value as Shape);
        }
    }

    // Handle arrays (e.g., OutputTypes=["float", "int"])
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return '[]';
        }
        if (value.length <= 4) {
            return value.map(v => formatKeyValue(v)).join(' | ');
        }
        return `[${value.length} items]`;
    }

    // Handle primitives
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number') {
        return String(value);
    }
    if (typeof value === 'boolean') {
        return String(value);
    }

    // Handle objects (could be a complex shape)
    if (typeof value === 'object') {
        // Check if it looks like an ObjectShape
        if ('members' in value) {
            return formatShapeNew(value as Shape);
        }
        // Generic object - show keys
        const keys = Object.keys(value);
        if (keys.length === 0) {
            return '{}';
        }
        return `{${keys.join(', ')}}`;
    }

    return String(value);
}
