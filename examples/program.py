from math import sqrt

def triangle_type(a, b, c):
    pass


def foo(a):
    if a.foo.bar < 10:
        return 42
    else:
        return 123


def distance(a, b):
    return sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)


def fib(n):
    if n < 2:
        return 1
    return fib(n - 1) + fib(n - 2)


def validate_password(password):
    if len(password) < 6:
        return False
    if not any(c.isdigit() for c in password):
        return False
    if not any(c.isalpha() for c in password):
        return False
    return True


def levenshtein(a, b):
    if len(a) < len(b):
        a, b = b, a

    previous = list(range(len(b) + 1))

    for i, ca in enumerate(a, start=1):
        current = [i]
        for j, cb in enumerate(b, start=1):
            current.append(min(
                previous[j] + 1, # delete char
                current[j - 1] + 1, # insert char
                previous[j - 1] + (0 if ca == cb else 1), # substitute / matches
            ))
        previous = current

    return previous[-1]
