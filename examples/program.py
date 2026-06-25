
from math import sqrt

def triangle_type(a, b, c):
    pass

def foo(a):
    if a.foo.bar < 10:
        return 42
    else:
        return 123

def fib(n):
    if n < 2:
        return 1
    return fib(n - 1)


def distance(a, b):
    return sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)

def validate_password(password):
    if len(password) < 6:
        return False
    if not any(c.isdigit() for c in password):
        return False
    if not any(c.isalpha() for c in password):
        return False
    return True
