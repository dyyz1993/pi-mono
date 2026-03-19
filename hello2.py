#!/usr/bin/env python3
"""Hello World 2 - Another test file"""

def say_hello(name="Guest"):
    print(f"Hello, {name} from hello2.py!")

def add(a, b):
    return a + b

if __name__ == "__main__":
    say_hello()
    say_hello("World")
    print(f"1 + 2 = {add(1, 2)}")
