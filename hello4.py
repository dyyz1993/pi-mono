# A simple Python program
import random

def greet(name):
    """Greet someone with a random greeting."""
    greetings = ["Hello", "Hi", "Hey", "Greetings"]
    greeting = random.choice(greetings)
    print(f"{greeting}, {name}!")

if __name__ == "__main__":
    greet("World")
