# Bugs and TODOs in GraalFuzz Fuzzer

## Empty Objects are not shown in table mapping
```python
    def rgb_to_hex(color):
        r, g, b = _validate_rgb_components(color.r, color.g, color.b)
        if color.a is not None:
            a = _normalize_alpha(color.a)
            a_int = int(round(a * 255))
            return f"#{r:02x}{g:02x}{b:02x}{a_int:02x}"
        return f"#{r:02x}{g:02x}{b:02x}"
```

Then type mapping is:
```
    {
        a: string, 
        b: null | boolean | int | double | string, 
        g: null | boolean | int | double | string, 
        r: null | boolean | int | double | string
    } → Crash (×361)
    {
        a: null | boolean | int | double, 
        b: boolean | int | double, 
        g: boolean | int | double, 
        r: boolean
    } → str (×294)
```
But this is missing `a: string | {}` which is found in the logs but disregarded during the union merging.

## Python Dictionary/List subscripting error

When running the fuzzer on the following code, the following error occurs:

```python
    def get_point_id(point):
        return f"lat<{point['lat']}>lon<{point['lon']}>"
```

```
    TypeError: 'polyglot.ForeignObject' object is not subscriptable
```

The problem is that python dictionaries are not accessed via "." but via "[]". The fuzzer currently does not seem to handle this case correctly.

Same problem occurs here for list subscripting:

```python
    def sum(some_list):
        return some_list[0] + some_list[1]
```

## Python dictionaries via iterators
When accessing dictionary keys via iterators, e.g. ``.values()``, the fuzzer currently does not handle this case correctly because it always inputs empty dictionaries and waits for the program to access keys directly. For example, the following code will always return 0:

```python
    def sum_dict_values(d):
        total = 0
        for value in d.values():
            total += value
        return total
```

This example also won't work because of the empty dictionary input:
```python
    def sum_dict_keys(d):
        if not d or len(d) == 0:
            return None
        return d["a"] + d["b"]
```

## Multi Argument Functions
When fuzzing functions with multiple arguments, the fuzzer currently only generates a single argument.

## Comparison Operations with Primitive Type suggest a type
When fuzzing functions that perform comparison operations (e.g., ==, <, >) with primitive types (like int, float, string), the fuzzer should suggest generating inputs of the same type to ensure meaningful comparisons. At least they have higher likelihood to not crash, or be a likely input.
Secondly, reading the values being compared to suggest fuzzing that value would be helpful. Otherwise it is hard to land in branches that expect a specific value. For more complex if statements this becomes harder.
e.g. 
```python
def answer(x):
    if x == "test":
        return 42
    else:
        return 0
```

## Optimizations
### Using knowledge from previous runs
The fuzzer could store information from previous runs to optimize future fuzzing sessions. For example, if certain input types consistently lead to crashes, the fuzzer should prioritize generating other input types in future runs. In reverse, if certain input types consistently lead to successful executions, the fuzzer could prioritize generating those types more frequently. e.g.:
1. { "a": 42 } → crash -> no need to try further ints
2. { "a": { "b": 42 } } → success -> generate more nested structures
3. { "a": { "b": "hello" } } → success

Maybe a Monte Carlo Tree Search (MCTS) approach could be used to guide the input generation process based on the outcomes of previous runs.